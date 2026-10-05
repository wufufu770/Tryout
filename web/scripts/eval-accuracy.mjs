#!/usr/bin/env node
/*
 * 评分器**准确性**评估 —— 与 `eval-ab.mjs`(一致性)互补
 *
 * ## 补的是什么缺口
 * - `eval-ab.mjs` 测的是**一致性**:同一输入多次评分,分数是否稳定。
 *   一致性高只能说明「不抖动」,**完全不能说明「分数对不对」** ——
 *   一个永远给 3 分的评分器一致性是 100%,但毫无用处。
 * - 项目此前的 155 个评分单测全是**函数级**:映射对不对、缺失维度记 0、
 *   提示词有没有包 XML。这些保证"实现符合规格",但不验证"规格是否合理"。
 * - `v7-question-bank-audit.md` 的 24 题人工核对验的是**参考答案本身对不对**,
 *   不是**评分器给分是否合理**。
 * → 于是从头到尾**没有任何一个数字能回答"这个评分器准不准"**。
 *
 * 本脚本用 `eval-ground-truth.json` 的人工标注语料,度量:
 *   - 档位命中率(expectedLetter vs 实际 A–E)
 *   - 分数平均绝对误差(expectedScore 1–5 vs 实际)
 *   - 混淆矩阵:看是"整体偏松"还是"整体偏严"还是"分不清档位"
 *   - 按答案质量档位拆开看(最关键:好答案能不能被识别成 A?)
 *
 * ## 两种运行模式
 *   1) `--mock`(无需 API key):用**确定性 mock LLM** 跑通全流程,
 *      验证脚本自身与语料结构正确。**此模式产出的 accuracy 数字没有意义**
 *      —— 它衡量的是我的 mock,不是真实模型。脚本会显式打印该警告。
 *   2) 真实模式:需在应用里配置供应商并导出 key。
 *      TRYOUT_TOKEN=xxx TRYOUT_PROVIDER=deepseek node scripts/eval-accuracy.mjs \
 *        --base http://127.0.0.1:3001 --runs 3
 *
 * 用法:
 *   node scripts/eval-accuracy.mjs --mock
 *   node scripts/eval-accuracy.mjs --base http://127.0.0.1:3001 --runs 3
 */
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const WEB = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const USE_MOCK = has("--mock");
const BASE = val("--base", "http://127.0.0.1:3001");
const TOKEN = process.env.TRYOUT_TOKEN || "";
const PROVIDER = process.env.TRYOUT_PROVIDER || "deepseek";
const RUNS = Math.max(1, parseInt(val("--runs", "1"), 10));

/* ---------------- ISSUE-031:增量落盘 + 断点续跑 ----------------
 * 一轮 100 样本真实评测要 600 次 LLM 调用、约 40–70 分钟,中途被限流/预算/网络
 * 打断是常态。原实现把结果只存在内存 `rows` 里,**跑完才打印** ——
 * 一旦中断,几十次真金白银的调用结果全部蒸发(不接受重跑,要再烧一遍 token)。
 * 这里改成:每完成一个样本就 append 一行 JSONL,进程随时可死。
 *   --resume  : 读入已有 JSONL,跳过已完成的样本,只补缺口
 *   --out     : 指定落盘路径
 *   --fresh   : 忽略已有结果重新开始
 */
const RESULTS_FILE = path.resolve(WEB, val("--out", "scripts/.eval-accuracy-results.jsonl"));
const RESUME = has("--resume");
const FRESH = has("--fresh");

/* ---------------- R18:消融实验开关 ----------------
 * R17 的结论卡在一个问题上:`expectedLetter` 来自**每题专属 rubric**
 * (「A = 含明确时间线、定位手段、止血动作优先级…」),而评分器用的是
 * **6 个通用胜任力维度**独立打分取均值。两套标准从未被设计成一致,
 * 所以「评分器偏严」里有多少是标定问题、多少是标准本身不同,**无法分离**。
 *
 * 本开关把每题 rubric 通过评分器**既有的** reference 通道注入,不改任何生产代码。
 * 关键设计:**配对比较** —— 同一批样本跑"注入 / 不注入"两轮,
 * 只让 rubric 这个变量变化,避免拿两批不同样本的数字互相比。
 *   --inject-rubric : 把 c.rubric 映射成 QuestionReference 注入 prompt
 *   --inject-bank   : 改用**题库的真实参考答案**注入(R32 生产接线的语义)
 *   --limit N       : 只跑前 N 道题(用于把成本压到可接受,且保证两轮题目完全相同)
 *
 * ⚠️ `--inject-rubric` 与 `--inject-bank` **不是一回事**,别混用结论:
 *   inject-rubric 注入的是**人工写的 A 档描述**("含明确时间线、定位手段、止血动作优先级…")
 *   inject-bank   注入的是**题库里的 referenceAnswer + keyPoints**,也就是
 *     R32(ISSUE-038)刚接线的**生产实现**实际喂的东西。
 *   R18 的配对消融(40%→65%)用的是 inject-rubric,测的是"人工 rubric 有没有用";
 *   R32 改的是生产路径,想知道"这次改动到底有没有效"必须跑 inject-bank。
 *   两者结论不可互相代入。
 */
const INJECT_RUBRIC = has("--inject-rubric");
const INJECT_BANK = has("--inject-bank");
const INJECT_GEN = has("--inject-gen-rubric");
const _modes = [INJECT_RUBRIC && "--inject-rubric", INJECT_BANK && "--inject-bank", INJECT_GEN && "--inject-gen-rubric"].filter(Boolean);
if (_modes.length > 1) {
  console.error(`❌ ${_modes.join(" 与 ")} 互斥(它们注入的是不同的东西)`);
  process.exit(1);
}
const LIMIT = Math.max(0, parseInt(val("--limit", "0"), 10) || 0);
/** R33:按题型筛选,如 --types technical,coding */
const ONLY_TYPES = (val("--types", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
/** R33:按题号筛选,如 --ids gt-tech-001,gt-code-002 */
const ONLY_IDS = (val("--ids", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
/** R37:按答案档位筛选,如 --levels A —— 只跑 A 档可把成本压到 1/5,
 *  用于"某个档位能不能被识别"这类定向验证(如 ISSUE-068 的高分档问题)。 */
const ONLY_LEVELS = (val("--levels", "") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

/* ---------------- R34:LLM 生成的档位标准 ----------------
 * 来自 `gen-tier-rubrics.mjs`(用题库 referenceAnswer + keyPoints 反推 A~E)。
 * 与 `--inject-rubric` 的区别:RUBRIC 是**人工标注**,GEN 是**模型生成** ——
 * 两者都是"档位标准",但生产可用性取决于后者能否替代前者。
 *
 * ⚠️ 关键纪律:某题若**没有**生成结果,**绝不能静默当作"不注入"**继续跑 ——
 *   那会让这一轮变成"部分注入",数字与其它轮不可比,却看不出任何异常。
 *   这里显式记进 missingGenRubric 并在报告里打印。
 */
const GEN_RUBRIC_FILE = path.resolve(WEB, val("--gen-file", "scripts/.gen-tier-rubrics.json"));
const GEN_RUBRIC = new Map();
if (INJECT_GEN) {
  if (!existsSync(GEN_RUBRIC_FILE)) {
    console.error(
      `❌ --inject-gen-rubric 需要生成结果:${GEN_RUBRIC_FILE}\n` +
      `   先跑:npm run gen:tier-rubrics`
    );
    process.exit(1);
  }
  for (const line of readFileSync(GEN_RUBRIC_FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r?.id && r.rubric) GEN_RUBRIC.set(r.id, r.rubric);
    } catch { /* 半行忽略 */ }
  }
  console.log(`  已载入生成的档位标准:${GEN_RUBRIC.size} 题`);
  if (GEN_RUBRIC.size === 0) {
    console.error("❌ 生成结果为空。拿一份空标准去做评测,等于「什么都没注入」却看不出来。");
    process.exit(1);
  }
}
/** 本轮会用到、但**没有**生成结果的新题 —— 报告时必须点名列出来 */
const missingGenRubric = [];

/* ---------------- 题库(权威的题干与题型)----------------
 *
 * ⚠️ R33:原先语料里存了一份**手抄的 question 字段**,与题库 content 措辞完全不同
 *   (20/20 全不一致,例:语料"讲一次你处理重大线上故障的经历" vs
 *    题库"描述一次你亲身经历的 P0 级线上故障,你是如何应急指挥和事后改进的")。
 *   评测用的是语料那份,于是**评测的题目不是生产实际会出的题**。
 *   现在以题库为权威:题干与题型都从题库取,语料只提供人工标注(rubric + 各档答案)。
 */
const BANK_FILE = path.join(WEB, "..", "server", "data", "questionbank.json");
if (!existsSync(BANK_FILE)) {
  console.error(`缺少题库:${BANK_FILE}\n  先跑 npm run export:questionbank`);
  process.exit(1);
}
const BANK = new Map(
  JSON.parse(readFileSync(BANK_FILE, "utf8")).questions.map((q) => [q.id, q])
);

/** 语料 case → 评分器用的题目(题干与题型一律以题库为准) */
function caseQuestion(c) {
  const q = BANK.get(c.questionId);
  if (!q) {
    // 显式失败优于静默用错题干
    throw new Error(`题目 ${c.id} 的 questionId "${c.questionId}" 不在题库里,已中止`);
  }
  return { text: q.content, type: q.type, bank: q };
}

/** 把语料的每题 rubric(A–E 描述)映射成评分器既有的 QuestionReference 结构 */
function rubricToReference(c) {
  if (!c.rubric) return undefined;
  // ⚠️ 必须用 "ABCDE".split("") 而不是 ["ABCDE"] ——
  //   后者是**含单个字符串**的数组,`r["ABCDE"]` 恒为 undefined,filter 后得到空数组,
  //   于是注入的 reference 里 `考察方向:` 是空的 —— 消融**静默退化成"什么都没注入"**,
  //   两轮跑出几乎相同的数字,还会被误读成"注入 rubric 没用"。
  //   (与本项目 R8/R13「跑通了但结果是空」同类,靠肉眼极难发现。)
  const letters = "ABCDE".split("");
  const lines = letters.filter((L) => c.rubric[L]).map((L) => `${L} 档(需具备):${c.rubric[L]}`);
  if (!lines.length) {
    // 显式失败优于静默空注入:空 reference 会让消融结论彻底无效
    throw new Error(`题目 ${c.id} 的 rubric 映射为空,消融将退化为无注入,已中止`);
  }
  const { type } = caseQuestion(c);
  return {
    keyPoints: lines,
    // 满分参考 = A 档要求,即「达到什么程度算满分」
    referenceAnswer: c.rubric.A || "",
    // ⚠️ R33:原先这里**硬编码** "behavioral"。语料只有行为题时它恰好是对的,
    //   但语料加入 technical/design/coding 后就会把非行为题也按行为题判据评判 ——
    //   buildReferenceBlock 会对着技术题发「请判断描述的事实、应对动作与事后复盘是否成立」,
    //   正是 ISSUE-039 修过的那类判据错配。现从题库取真实题型。
    questionType: type,
  };
}

/** R32(ISSUE-038)生产语义:注入题库的真实参考答案 + keyPoints */
function bankToReference(c) {
  const { bank, type } = caseQuestion(c);
  if (!bank.referenceAnswer || !Array.isArray(bank.keyPoints) || !bank.keyPoints.length) {
    throw new Error(`题库题目 ${c.questionId} 没有 referenceAnswer/keyPoints,无法注入,已中止`);
  }
  return {
    keyPoints: bank.keyPoints.map(String),
    referenceAnswer: String(bank.referenceAnswer),
    questionType: type,
  };
}

/**
 * R34:注入**模型生成**的档位标准。
 * 结构与 rubricToReference 一致(都是 A~E 描述),但来源不同:
 *   --inject-rubric → 人工标注(c.rubric)
 *   --inject-gen-rubric → gen-tier-rubrics.mjs 从题库参考答案反推
 * 比较这两轮,才能回答"能不能把人工标注自动化掉"。
 */
function genRubricToReference(c) {
  const { type } = caseQuestion(c);
  const g = GEN_RUBRIC.get(c.questionId);
  if (!g) {
    // 显式记账,交给报告点名列出来 —— 静默退化成"不注入"会让数字不可比
    if (!missingGenRubric.includes(c.id)) missingGenRubric.push(c.id);
    return undefined;
  }
  const letters = "ABCDE".split("");
  const lines = letters.filter((L) => g[L]).map((L) => `${L} 档(需具备):${g[L]}`);
  if (!lines.length) {
    throw new Error(`生成结果 ${c.questionId} 映射为空,已中止(不能当成"没注入"混进统计)`);
  }
  return { keyPoints: lines, referenceAnswer: g.A || "", questionType: type };
}


/** 基础设施级失败(预算耗尽/服务不可达):必须让整轮中止,不能降级成"该维度 0 分" */
class FatalEvalError extends Error {
  constructor(msg) { super(msg); this.name = "FatalEvalError"; this.fatal = true; }
}

/** 读入已落盘结果,返回 Map<"caseId/level", row> */
function loadResults() {
  const map = new Map();
  if (!RESUME || !existsSync(RESULTS_FILE)) return map;
  const lines = readFileSync(RESULTS_FILE, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (r && r.caseId && r.level) map.set(`${r.caseId}/${r.level}`, r);
    } catch { /* 半行(进程写到一半被杀)直接跳过,不影响其它行 */ }
  }
  return map;
}

/* ---------------- 读取语料 ---------------- */
const GT_FILE = path.join(WEB, "scripts", "eval-ground-truth.json");
if (!existsSync(GT_FILE)) {
  console.error(`缺少 ground-truth 语料:${GT_FILE}`);
  process.exit(1);
}
const GT = JSON.parse(readFileSync(GT_FILE, "utf8"));
const CASES = GT.cases || [];

// ⚠️ 必须定义在**打印语料统计之前**(const 暂时性死区:用前不可见,会 ReferenceError)。
// R18 的配对比较要求注入/不注入两轮用**同一个 --limit**,否则样本集不同、数字不可比。
const RUN_CASES = (() => {
  let list = LIMIT > 0 ? CASES.slice(0, LIMIT) : CASES;
  // ⚠️ R33:语料扩展后 --limit 不够用了 —— 新题 append 在末尾,slice(0,N) 永远取不到它们。
  //   而"按题型跑"正是本轮要回答的问题(行为题之外的题型从未验证过)。
  if (ONLY_TYPES.length) {
    const keep = list.filter((c) => {
      const q = BANK.get(c.questionId);
      return q && ONLY_TYPES.includes(q.type);
    });
    list = keep;
  }
  if (ONLY_IDS.length) {
    list = list.filter((c) => ONLY_IDS.includes(c.id));
  }
  return list;
})();
if (RUN_CASES.length === 0) {
  console.error("❌ 筛选后没有可跑的题目(--types / --ids 是否与语料匹配?)");
  process.exit(1);
}

/* ---------------- 前置检查(真实模式必须有可用后端 + token)----------------
 * 教训:没有这道检查时,真实模式在"无 key / 后端不可达"的情况下会**静默**
 * 把所有维度判成 0 分,输出一个"accuracy = 0%"的表格 ——
 * 看起来像个真实测量结果,实际毫无意义。这正是 eval-ab.mjs 里记过的
 * "跑通了但结果是空"的自欺,这里必须显式拦住。
 */
if (!USE_MOCK) {
  if (!TOKEN) {
    console.error(
      "\n❌ 真实模式需要 API token。\n" +
      "   TRYOUT_TOKEN=xxx TRYOUT_PROVIDER=deepseek node scripts/eval-accuracy.mjs \\\n" +
      "       --base http://127.0.0.1:3001 --runs 3\n" +
      "   或先用 --mock 跑通流程(但 mock 的数字不可用于判断评分器质量)。",
    );
    process.exit(2);
  }
  let reachable = false;
  try {
    const r = await fetch(`${BASE}/api/health`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    reachable = r.ok;
  } catch { /* 不可达 */ }
  if (!reachable) {
    console.error(`\n❌ 无法连接后端 ${BASE}/api/health(需鉴权)。请先启动服务并导出 TRYOUT_TOKEN。`);
    process.exit(2);
  }
  console.log(`  前置检查通过:后端 ${BASE} 可达,token 已提供。\n`);
}

/* ---------------- 打包被测模块 ---------------- */
const esbuild = path.join(WEB, "node_modules", ".bin", "esbuild");
if (!existsSync(esbuild)) {
  console.error("找不到 esbuild(它在 Vite 依赖链里),请先 npm install");
  process.exit(1);
}
const bundleDir = mkdtempSync(path.join(tmpdir(), "tryout-acc-"));
const bundle = path.join(bundleDir, "scoring.mjs");
// 用一个入口文件把 scoringEngine 及其依赖(含 starEvaluator 的维度定义)一起打包
const entry = path.join(bundleDir, "entry.ts");
writeFileSync(entry, `
export * from ${JSON.stringify(path.join(WEB, "src/lib/evaluation/scoringEngine.ts"))};
export { EVALUATION_DIMENSIONS } from ${JSON.stringify(path.join(WEB, "src/lib/evaluation/starEvaluator.ts"))};
export { createLimit } from ${JSON.stringify(path.join(WEB, "src/lib/limit.ts"))};
`, "utf8");
execFileSync(esbuild, [entry, "--bundle", "--format=esm", "--platform=node", `--outfile=${bundle}`],
  { stdio: ["ignore", "ignore", "inherit"] });

const { scoreAllDimensions, scoreWithRetry, createLimit, aggregateScores, sanitizeForScoring, EVALUATION_DIMENSIONS } = await import(bundle);
if (!Array.isArray(EVALUATION_DIMENSIONS) || EVALUATION_DIMENSIONS.length === 0) {
  console.error("未能加载 EVALUATION_DIMENSIONS,无法评测");
  process.exit(1);
}

/**
 * 按**生产路径**给一组维度打分。
 *
 * ⚠️ R18 最重要的一处修正(方法论缺陷,不是产品缺陷):
 * 原实现调用 `scoreAllDimensions`,而它**没有重试**;而生产 UI
 * (`InterviewPage.tsx:437` / `HistoryPage.tsx:300`)调用的是 **`scoreWithRetry`(默认 2 次尝试)**。
 * `scoreAllDimensions` 在整个 src/ 里**零生产调用方** —— 只有评测脚本在用它。
 *
 * 后果是 R17 那轮 100 样本评测测的是**生产根本不走的代码路径**:
 *   解析失败率在无重试路径下高达 ~37%,而 `aggregateScores` 对缺失维度记 **0 分**
 *   (有意的 fail-closed 设计,`aggregate.test.ts:58` 有断言守护)。
 *   于是"评分器偏严一档"实际上大部分是**解析失败被记 0 分**造出来的假象。
 * R18 用同一批样本实测:无缺失维度时平均偏移 **0.00**,有缺失维度时 **-1.00**。
 *
 * 所以评测必须走生产路径,否则量出来的不是产品行为。
 */
async function scoreViaProductionPath(question, answer, reference, concurrency, scoreDeps) {
  const limit = createLimit(concurrency);
  // R54:收集每次维度调用的 finishReason / 输出长度。
  //   R53 卡在死结上:观察到"A 档解析失败率 27%"是真的,
  //   但**链路上没有任何字段能回答"是不是被 max_tokens 截断"** ——
  //   llm.js 明明返回了 finishReason,评分层却只取 content 把它丢了。
  //   ⇒ 落盘这两个字段,先建立基线,再谈修法(详见 qa/ISSUES.md R53/R54)。
  const diag = [];
  const depsWithDiag = {
    ...scoreDeps,
    onDiag: (d) => { diag.push(d); },
  };
  const scores = await Promise.all(
    EVALUATION_DIMENSIONS.map((d) =>
      // ⚠️ deps **必须**透传。漏掉它时 scoreWithRetry 会退回默认的 `{ chat: api.chat }`,
      // 于是 --mock 模式照样发真实 HTTP:因为没凭据而鉴权失败,又被 scoreWithRetry 的
      // try/catch 静默吞掉 → 6 个维度全 null → 全落到 E → 报告"跑完了"但数字全假。
      // (token 计数还是 0,因为请求根本没到 LLM —— **只有实测才抓得到**。)
      limit(() => scoreWithRetry(d, question, answer, reference, PROVIDER, 2, depsWithDiag))
    )
  );
  scores.__diag = diag;
  return scores;
}

const LETTER_OF = { 5: "A", 4: "B", 3: "C", 2: "D", 1: "E" };
const SCORE_OF = { A: 5, B: 4, C: 3, D: 2, E: 1 };
/**
 * 把 1–5 量纲的均分取整到档位。
 * AggregateResult 只有 1–10 制 overallScore(6 个维度均分 ×2),没有 overallLetter,
 * 所以这里自己换算 —— 口径写在函数名里,避免"哪来的字母"这种含糊。
 */
function letterOfAvg5(avg5) {
  return LETTER_OF[Math.min(5, Math.max(1, Math.round(avg5)))];
}

/* ---------------- deps:mock 或真实 HTTP ---------------- */
/**
 * mock 必须**按格式**返回结果,而不是随便塞个对象 ——
 * 否则会得到"跑通了但结果是空"的自欺(eval-ab.mjs 里有同类教训)。
 * 这里让 mock 依据"答案里是否含技术性词汇"给一个确定的档位,
 * 目的是让脚本全链路可跑、可自检,而**不是**模拟真实模型能力。
 */
function makeDeps(mode) {
  return {
    // ScoreDeps 的真实签名:chat(provider, body) → { content }
    async chat(_provider, body) {
      const prompt = String(body?.messages?.[0]?.content || "");
      // 按 buildDimensionPrompt 的固定结构取答案:
      //   "## 候选人回答" 之后,到下一个 "## " 之前
      const m = prompt.split("## 候选人回答")[1];
      const answer = m
        ? m.split(/\n## /)[0].replace(/^\s+|\s+$/g, "")
        : prompt;
      if (mode === "mock") {
        // 确定性的假评分:长度越长 + 含技术词 → 档位越高。仅供跑通流程。
        const tech = /(数组|链表|红黑树|扩容|负载因子|词法作用域|回收|IIFE|柯里化|let|var)/.test(answer);
        const len = answer.length;
        let s = 3;
        if (tech && len > 200) s = 5;
        else if (tech) s = 4;
        else if (len > 150) s = 3;
        else if (len > 40) s = 2;
        else s = 1;
        // ⚠️ 输出格式必须遵循 parseDimensionScore 的约定:
        //   给 matched_anchor_id,**不要**给 score(分数由系统映射)。
        //   之前给 score 的写法会被解析器忽略,导致全部落到 0 分 —— 正是
        //   "跑通了但结果是空"的自欺(eval-ab.mjs 里有同类教训)。
        return { content: JSON.stringify({
          reasoning: "(mock) 依据答案长度与关键词命中",
          matched_anchor_id: LETTER_OF[s],
          evidence: [],
          confidence: "low",
        }) };
      }
      // ⚠️ 真实模式:必须**原样转发被测模块生成的 prompt**。
      //   之前这里自己拼 prompt 并引用了 mock 分支才有的 `dimensionName`/`answer` 变量,
      //   结果 ReferenceError → 所有维度评分失败 → 全部落到 E 分,
      //   报出"准确率 20%"的**完全虚假**结论。
      //   正确做法:直接把第 133 行已解析出的 `prompt`
      //   (即 buildDimensionPrompt 的产物)发给真实模型,保证评测的就是线上那套 prompt。
      // ⚠️ /api/chat 的限流是 20 次/分钟(chat label)。大语料评测会成百上千次调用,
      //   必然触发 429。**限流**要等窗口恢复后重试。
      // ⚠️ ISSUE-031:但 429 有**两种**,语义相反,必须分开处理:
      //   RATE_LIMITED         → 等 60s 就能过,重试有意义
      //   TOKEN_BUDGET_EXCEEDED → 日预算耗尽,当天不可能恢复,重试 100% 必然失败
      //   原实现对两者一律 sleep(62s) 重试 20 次,撞上预算熔断后会**无限空转**:
      //   每个样本白等 20 分钟,而且 (a) 不落盘 → 中断即全丢,(b) 监控只看进程存活,
      //   会把"被 kill"误报成"跑完了"。R16 实测空转 14 分钟、78 个样本结果全丢。
      const reqBody = JSON.stringify({
        provider: PROVIDER,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      });
      for (let attempt = 0; attempt < 20; attempt++) {
        const r = await fetch(`${BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
          body: reqBody,
        });
        const j = await r.json().catch(() => null);
        if (r.status === 429) {
          // 预算耗尽:重试毫无意义,**立即失败**并给出可执行的补救指引
          if (j?.code === "TOKEN_BUDGET_EXCEEDED") {
            const ra = Number(r.headers.get("retry-after"));
            const hrs = Number.isFinite(ra) ? (ra / 3600).toFixed(1) : "?";
            throw new FatalEvalError(
              `日 token 预算已耗尽(TOKEN_BUDGET_EXCEEDED,约 ${hrs} 小时后重置)。` +
              `这不是限流,继续等待不会恢复。` +
              `请提高后端 DAILY_TOKEN_BUDGET 后重启,再用 --resume 从已完成处续跑。` +
              `已完成结果已落盘:${RESULTS_FILE}`,
            );
          }
          // 真限流:优先按服务端给的 Retry-After 等待,不硬编码 62s
          const ra = Number(r.headers.get("retry-after"));
          const waitMs = Number.isFinite(ra) && ra > 0 ? (ra + 2) * 1000 : 62000;
          process.stderr.write(`  [限流] 等待 ${Math.round(waitMs / 1000)}s 后重试(第 ${attempt + 1}/20 次)\n`);
          await new Promise((res) => setTimeout(res, waitMs));
          continue;
        }
        if (j?.ok === false) {
          throw new Error(`LLM 调用失败:${j.code || ""} ${j.message || ""}`.trim());
        }
        // ⛔ R63:原先是 `return { content: j?.data?.content || "" };` ——
        //   **只取 content,把上游返回的 finishReason / model / tokens 全丢了**。
        //   后果不是"少几个字段",而是**让 R54 的结论无效**:
        //     R54 看到落盘里 `finishReasons = {}`,据此写下
        //     "没有一次 finishReason==='length' ⇒ 不存在截断" ——
        //     **而那个空是因为这个包装函数根本没把字段传上来**。
        //     观测不到 ≠ 没发生。
        //
        // ⇒ 改为**原样透传** `j.data`,只把 content 兜底成字符串
        //   (保住 finishReason/model/tokensIn/tokensOut,它们都是诊断信息)。
        const d = j?.data || {};
        return { ...d, content: d.content || "" };
      }
      throw new Error("连续 20 次被限流,评测中止(可加 --resume 续跑)");
    },
  };
}

const deps = makeDeps(USE_MOCK ? "mock" : "real");

/* ---------------- 跑评测 ---------------- */
console.log(`\n${"=".repeat(62)}`);
console.log("  评分器准确性评估 (ground truth)");
console.log(`${"=".repeat(62)}`);
console.log(`  语料:${RUN_CASES.length} 题 × ${RUN_CASES[0]?.answers.length ?? 0} 档 = ${RUN_CASES.reduce((s, c) => s + c.answers.length, 0)} 个样本${INJECT_RUBRIC ? "  【消融:已注入每题 rubric】" : ""}${LIMIT ? `  (--limit ${LIMIT})` : ""}`);
console.log(`  模式:${USE_MOCK ? "MOCK(无 API key —— 数字无意义,仅验证流程)" : `真实 (${PROVIDER} @ ${BASE},${RUNS} 次/样本)`}`);
if (USE_MOCK) {
  console.log("\n  ⚠️ 警告:mock 模式的 accuracy 衡量的是这个 mock,不是真实评分器。");
  console.log("     真实数字需要配置 API key 后用真实模式跑。\n");
}

// ⚠️ R55 修复:**默认行为原本是"追加到已有文件"**,只有 --fresh 才清空。
//   于是连续跑两次(哪怕筛选条件完全不同)的结果会**静默混在一起**,
//   脚本照样跑完、照样打印一份漂亮的汇总、exit 0。
//   R54 我为此白分析了 10 行,其中 8 行是无埋点的旧数据 ——
//   **"跑完了"不等于"数据是这一轮的"**(与 R-024 同源)。
//
// 正确语义:
//   默认          → 覆盖(这是一次全新的评测)
//   --fresh       → 覆盖,并把旧文件备份成 .bak(显式重来)
//   --resume      → 保留并跳过已跑完的样本(ISSUE-031)
if (!RESUME && existsSync(RESULTS_FILE)) {
  if (FRESH) {
    const bak = `${RESULTS_FILE}.bak`;
    writeFileSync(bak, readFileSync(RESULTS_FILE, "utf8"));
    console.log(`  --fresh:旧结果已备份到 ${path.basename(bak)}`);
  } else {
    console.log(`  已存在 ${path.basename(RESULTS_FILE)},本次运行将**覆盖**它(要保留请用 --resume)`);
  }
  writeFileSync(RESULTS_FILE, "");
}

// ⚠️ 顺序很重要:必须在上面的清空**之后**才读。
//   否则非 --resume 模式下 done 仍含上一轮的行,会被当成"已跑过"而跳过。
const done = loadResults();
// 逐样本展开为「要跑的工作项」,这样 --levels 才能生效。
// ⚠️ R37:之前 TOTAL 与主循环都直接按 c.answers.length 算/跑,
//   于是 --ids 只能筛到题、筛不到档 —— 想只跑 A 档(6 个样本)却被迫跑满 30 个。
const RUN_ITEMS = RUN_CASES.flatMap((c) =>
  c.answers
    .filter((a) => !ONLY_LEVELS.length || ONLY_LEVELS.includes(String(a.level).toUpperCase()))
    .map((a) => ({ c, a }))
);
const TOTAL = RUN_ITEMS.length;
if (RESUME && done.size) {
  console.log(`  --resume:已载入 ${done.size}/${TOTAL} 个历史样本,只补缺口`);
  console.log(`  (每完成一个样本即落盘,再次中断可继续 --resume)\n`);
}

const rows = [];
let n = 0;
// 基础设施级失败在这里统一收口:打印可操作指引 + 非零退出,**不打印任何指标**。
// 打印指标 = 给出"这轮数据可用"的暗示,而实际上它是被中途掐断的。
let aborted = null;
try {
for (const { c, a } of RUN_ITEMS) {
  {
    n++;
    const key = `${c.id}/${a.level}`;

    // 已完成:直接复用,不再烧 token
    if (done.has(key)) {
      rows.push(done.get(key));
      console.log(`  [${String(n).padStart(3)}/${TOTAL}] ${key.padEnd(20)} ${done.get(key).actualLetter}     (复用)`);
      continue;
    }

    const perRun = [];
    // R33:题干以题库为权威(语料里那份是手抄的,20/20 与题库措辞不同)
    const cq = caseQuestion(c);
    const reference = INJECT_BANK ? bankToReference(c)
      : INJECT_GEN ? genRubricToReference(c)
      : INJECT_RUBRIC ? rubricToReference(c)
      : undefined;
    for (let run = 0; run < RUNS; run++) {
      // 走生产路径(scoreWithRetry,2 次尝试),与 InterviewPage/HistoryPage 一致
      const dims = await scoreViaProductionPath(
        cq.text,
        sanitizeForScoring(a.text),
        reference,
        3,
        deps,
      ).catch((e) => {
        // ⚠️ 基础设施级失败必须**冒泡**,不能在这里降级成 dims=[]。
        //   降级后 aggregateScores 会算出接近 0 的均分,脚本照样跑完并打印
        //   一份"看起来正常"的报告 —— 这正是本文件头部注释里点名的
        //   「跑通了但结果是空」的自欺(R8 踩过一次,这次差点重蹈)。
        if (e?.fatal) throw e;
        console.error(`  评分异常:${e.message}`);
        return [];
      });
      const agg = aggregateScores(dims, EVALUATION_DIMENSIONS);
      // R54:把诊断数据一起存下来。⚠️ 第一版我只挂了 `dims.__diag`,
      //   却在下一行 `perRun.push({ dims, agg })` 里**没把它带进来** ——
      //   于是落盘的 finishReasons/outLengths 全是空对象,而脚本**照样跑完并打印报告**。
      //   这正是 R-024 教训:加了埋点不等于埋点生效,**必须验证字段真的有值**。
      perRun.push({ dims, agg, diag: dims.__diag });
    }
    // RUNS>1 时取众数档位(一致性已在 eval-ab 里单独度量,这里只看准确性)
    // overallScore 是 1–10 制(6 维度均分 ×2),换算回 1–5 再取档位
    const letters = perRun.map((p) => letterOfAvg5((p.agg?.overallScore ?? 0) / 2)).filter((x) => x !== "?");
    const counts = {};
    for (const l of letters) counts[l] = (counts[l] || 0) + 1;
    const finalLetter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "?";
    const row = {
      // ⚠️ R60:必须有 runAt。R60 实测发现:同一批样本相隔几轮,失败率从 38% 变成 0%
      //   (而本地解析代码未变 ⇒ 指向 provider 侧行为漂移)。
      //   **没有时间戳,"跨轮次比较"这件事在方法上就不成立** ——
      //   我此前反复比较的那些百分比,底层分布可能早就变了而我完全不知道。
      //   ⇒ 从此每条落盘都带 runAt + provider,任何跨轮次结论都必须先看它。
      runAt: new Date().toISOString(),
      provider: PROVIDER,
      caseId: c.id, level: a.level,
      expectedLetter: a.expectedLetter, actualLetter: finalLetter,
      expectedScore: a.expectedScore, actualScore: SCORE_OF[finalLetter] ?? null,
      allLetters: letters,
      // ⚠️ 必须落盘这两个计数,否则**无法区分**"评分器偏严"和"某维度解析失败被记 0 分"。
      // aggregateScores 对缺失维度记 score:0(低于 E 锚点的 1 分),且 sum 不累加但 n 仍为 6,
      // 一次解析失败足以把整条样本拉低一档。没有这两个字段,偏严结论就是**无法证伪**的。
      missingDims: perRun[0]?.agg?.missingCount ?? null,
      noEvidenceDims: perRun[0]?.agg?.noEvidenceCount ?? null,
      dimScores: perRun[0]?.agg?.dimensions?.map((d) => d.score) ?? null,
      // R54:截断诊断基线(见 qa/ISSUES.md R53/R54)
      //   finishReasons 形如 { "技术深度": "length", ... }
      //   outLengths    形如 { "技术深度": 1832, ... } —— LLM 实际输出长度
      finishReasons: (() => {
        const g = perRun[0]?.diag;
        if (!Array.isArray(g)) return null;
        const o = {};
        for (const x of g) if (x?.finishReason) o[x.dim] = x.finishReason;
        return Object.keys(o).length ? o : null;
      })(),
      outLengths: (() => {
        const g = perRun[0]?.diag;
        if (!Array.isArray(g)) return null;
        const o = {};
        for (const x of g) o[x.dim] = x.contentLength;
        return Object.keys(o).length ? o : null;
      })(),
      // R59:解析失败时的输出片段(前 300 字)。
      //   A 档失败率 38% vs C 档 15% 的差异 Fisher P=0.08 不显著、且随机性极强,
      //   所以**堆样本不是好路径** —— 看清一次失败长什么样才快。
      failHeads: (() => {
        const g = perRun[0]?.diag;
        if (!Array.isArray(g)) return null;
        const o = {};
        for (const x of g) if (x?.contentHead) o[x.dim] = x.contentHead;
        return Object.keys(o).length ? o : null;
      })(),
      // R62:失败现场。⚠️ `failHeads` 抓不到空 content(`"".slice()` 仍是 `""`),
      //   所以必须另外记**失败原因本身**。
      //   `field-missing` vs `empty-string` 的区别决定修法完全不同:
      //   前者=上游响应没有 content 字段(结构/过滤),后者=字段在但值为空串(内容)。
      // R64 ⭐ 三个字段必须来自**同一次尝试**。
      //   此前用 `o[x.dim] = ...` 各自覆盖,而 scoreWithRetry 最多调 3 次 ——
      //   于是 reason 与 length 可能来自不同调用,配对断裂。
      //   R64 实测:`failReason=empty-string`(某次空)配 `outLength=277`(另次成功),
      //   看起来像"上游 stop 却有内容",差点得出完全错误的结论。
      //   ⇒ 全部按 `dim#attempt` 为键成对记录,不再按 dim 各取最后一个。
      failReasons: (() => {
        const g = perRun[0]?.diag;
        if (!Array.isArray(g)) return null;
        const o = {};
        for (const x of g) if (x?.failReason) o[`${x.dim}#${x.attempt ?? 0}`] = x.failReason;
        return Object.keys(o).length ? o : null;
      })(),
      /** R64:哪些维度**最终**仍失败(重试耗尽)——这才是该统计的口径 */
      finalFailures: (() => {
        const g = perRun[0]?.diag;
        if (!Array.isArray(g)) return null;
        // 同一 dim 取 attempt 最大的一次
        const last = {};
        for (const x of g) {
          const a = x.attempt ?? 0;
          if (!(x.dim in last) || a >= last[x.dim].attempt) last[x.dim] = x;
        }
        const o = {};
        for (const [dim, x] of Object.entries(last)) {
          if (!x.ok) o[dim] = { failReason: x.failReason, finishReason: x.finishReason, contentLength: x.contentLength };
        }
        return Object.keys(o).length ? o : null;
      })(),
      /** R64:每维度总尝试次数(用于判断"重试救回来了多少") */
      attemptsByDim: (() => {
        const g = perRun[0]?.diag;
        if (!Array.isArray(g)) return null;
        const n = {};
        for (const x of g) n[x.dim] = Math.max(n[x.dim] ?? 0, (x.attempt ?? 0) + 1);
        return Object.keys(n).length ? n : null;
      })(),
      resKeys: (() => {
        const g = perRun[0]?.diag;
        if (!Array.isArray(g)) return null;
        const o = {};
        for (const x of g) if (x?.resKeys) o[x.dim] = x.resKeys;
        return Object.keys(o).length ? o : null;
      })(),
      overallRaw: perRun[0]?.agg?.overallScore ?? null,
    };
    rows.push(row);
    // ISSUE-031:跑完立刻落盘。appendFileSync 单行写,进程被杀最多丢当前这一个样本。
    appendFileSync(RESULTS_FILE, JSON.stringify(row) + "\n");
    const mark = finalLetter === a.expectedLetter ? "✓" : "✗";
    console.log(`  [${String(n).padStart(3)}/${TOTAL}] ${key.padEnd(20)} ${finalLetter} (期望 ${a.expectedLetter}) ${mark}`);
  }
}
} catch (e) {
  aborted = e;
}
console.log(`\n  结果已落盘:${RESULTS_FILE}`);

if (aborted) {
  console.error(`\n${"=".repeat(62)}`);
  console.error(`  ✖ 评测中断:${aborted.message}`);
  console.error(`  已完成 ${rows.length}/${TOTAL} 个样本并落盘。`);
  console.error(`  排除原因后重跑并加 --resume 续跑即可,不会重复消耗已完成的样本。`);
  console.error(`${"=".repeat(62)}\n`);
  process.exit(3);
}

/* ---------------- 指标 ---------------- */
const total = rows.length;
const hits = rows.filter((r) => r.actualLetter === r.expectedLetter).length;
const accuracy = total ? hits / total : 0;
const scored = rows.filter((r) => r.actualScore !== null);
const mae = scored.length
  ? scored.reduce((s, r) => s + Math.abs(r.actualScore - r.expectedScore), 0) / scored.length
  : 0;

console.log("\n── 逐样本结果 ──");
console.log("  " + "样本".padEnd(22) + "预期  实际  命中");
for (const r of rows) {
  const mark = r.actualLetter === r.expectedLetter ? "✅" : "❌";
  console.log(`  ${(r.caseId + "/" + r.level).padEnd(22)} ${r.expectedLetter}     ${r.actualLetter}     ${mark}`);
}

console.log("\n── 指标 ──");
console.log(`  档位命中率(accuracy): ${hits}/${total} = ${(accuracy * 100).toFixed(1)}%`);
console.log(`  分数平均绝对误差(MAE): ${mae.toFixed(2)} / 4`);

// ⚠️ R34:部分注入会让这一轮的数字与其它轮**不可比**,而报告里看不出任何异常。
//   所以必须在这里显式点名,而不是让它混在总数里蒙混过去。
if (missingGenRubric.length) {
  console.log(
    `\n  ⚠️ 有 ${missingGenRubric.length} 道题**没有生成档位标准**,本轮对它们实际是"不注入":`
  );
  for (const id of missingGenRubric) console.log(`     - ${id}`);
  console.log(
    `     ⇒ 本轮是**部分注入**,与 --inject-rubric / --inject-bank 的数字不可直接比较。\n` +
    `       请先补生成(gen:tier-rubrics --resume)再重跑,否则结论会建立在错的前提上。`
  );
}

console.log("\n── 混淆矩阵(行=预期,列=实际)──");
const L = ["A", "B", "C", "D", "E"];
process.stdout.write("        " + L.map((x) => x.padStart(4)).join("") + "\n");
for (const exp of L) {
  const cells = L.map((act) => String(rows.filter((r) => r.expectedLetter === exp && r.actualLetter === act).length).padStart(4));
  process.stdout.write(`  ${exp}(${SCORE_OF[exp]}) ` + cells.join("") + "\n");
}

console.log("\n── 按答案质量档位拆解(最关键)──");
console.log("  高质量答案能否被识别为 A,决定了评分器有没有区分度");
for (const lvl of ["A", "B", "C", "D", "E"]) {
  const sub = rows.filter((r) => r.expectedLetter === lvl);
  if (!sub.length) continue;
  const h = sub.filter((r) => r.actualLetter === lvl).length;
  const avgAct = (sub.reduce((s, r) => s + (r.actualScore ?? 0), 0) / sub.length).toFixed(1);
  console.log(`  预期 ${lvl}:命中 ${h}/${sub.length}  实际均分 ${avgAct}`);
}

const biases = rows.filter((r) => r.actualScore !== null);
const tooLenient = biases.filter((r) => r.actualScore > r.expectedScore).length;
const tooStrict = biases.filter((r) => r.actualScore < r.expectedScore).length;
console.log(`\n  偏差方向:偏松 ${tooLenient} 例 / 偏严 ${tooStrict} 例 / 持平 ${biases.length - tooLenient - tooStrict} 例`);

if (USE_MOCK) {
  console.log("\n  再次提醒:以上数字来自 mock,不可用于判断评分器质量。");
}

rmSync(bundleDir, { recursive: true, force: true });
process.exit(0);
