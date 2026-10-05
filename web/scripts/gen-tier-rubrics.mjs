#!/usr/bin/env node
/*
 * R34:用 LLM 从题库参考答案**反推**每题的 A~E 档位标准
 *
 * ## 为什么做这个
 * R33 的配对消融(30 样本)证明了:
 * ```
 *   不注入              命中 33%   均分偏移 -0.30
 *   注入题库参考答案    命中 43%   均分偏移 -0.38   ← 纹丝不动
 *   注入人工档位标准    命中 83%   均分偏移 +0.00   ← 校准
 *   McNemar P=0.00003,且"仅对照命中 = 0"(零副作用)
 * ```
 * **有效的输入是"档位标准",不是"参考答案"。**
 * 但题库 808 题没有档位标准,人工补 A~E 不现实。
 *
 * 本脚本补的就是中间那一步:**参考答案给出"满分长什么样",
 * 让 LLM 由此推出"A 档该具备什么、B 档差在哪"** ——
 * 把答案变成刻度。生成结果落盘缓存,之后评分零边际成本。
 *
 * ## 与 R33 的关键区别(别再混用)
 *   R33 的 --inject-rubric 注入的是**人工写的** c.rubric(评测语料里的标注)
 *   本脚本生成的是**LLM 从题库 referenceAnswer 反推的**档位
 * 两者都是"档位标准",但来源不同 —— 本脚本验证的是**能否自动化生产它**。
 *
 * 用法:
 *   TRYOUT_TOKEN=xxx TRYOUT_PROVIDER=prov_xxx \
 *   node scripts/gen-tier-rubrics.mjs --limit 6 --out scripts/.gen-tier-rubrics.json
 *
 * 增量落盘 + --resume:每生成一题即写,中断可续(ISSUE-031 同一套路)。
 */
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const BANK_FILE = path.join(WEB, "..", "server", "data", "questionbank.json");
const OUT = path.resolve(WEB, val("--out", "scripts/.gen-tier-rubrics.json"));
const LIMIT = Math.max(0, parseInt(val("--limit", "0"), 10) || 0);
const ONLY_TYPES = (val("--types", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const ONLY_IDS = (val("--ids", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const BASE = val("--base", "http://127.0.0.1:3001");
const TOKEN = process.env.TRYOUT_TOKEN || "";
const PROVIDER = process.env.TRYOUT_PROVIDER || "";
const RESUME = has("--resume");

if (!existsSync(BANK_FILE)) {
  console.error(`缺少题库:${BANK_FILE}\n  先跑 npm run export:questionbank`);
  process.exit(1);
}

const bank = JSON.parse(readFileSync(BANK_FILE, "utf8")).questions;

/* ---------------- 断点续跑 ---------------- */
const done = new Map();
if (RESUME && existsSync(OUT)) {
  for (const line of readFileSync(OUT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r?.id) done.set(r.id, r);
    } catch { /* 半行 = 上次被掐断,忽略 */ }
  }
  console.log(`--resume:已载入 ${done.size} 道题的生成结果`);
}

let list = bank.filter(
  (q) => q.referenceAnswer && Array.isArray(q.keyPoints) && q.keyPoints.length
);
if (ONLY_TYPES.length) list = list.filter((q) => ONLY_TYPES.includes(q.type));
if (ONLY_IDS.length) list = list.filter((q) => ONLY_IDS.includes(q.id));
if (LIMIT > 0) list = list.slice(0, LIMIT);

if (!list.length) {
  console.error("❌ 筛选后没有题目(检查 --types / --ids / 题库是否有 referenceAnswer)");
  process.exit(1);
}

/* ---------------- 前置检查:没有真凭据就别假装能跑 ----------------
 * 教训(与 eval-accuracy.mjs 同源):缺 token 时若继续跑,会拿 401 的静默失败
 * 产出一份"生成完成但全是空"的 JSON,并给出虚假的成功率。
 */
if (!TOKEN || !PROVIDER) {
  console.error(
    "\n❌ 需要 TRYOUT_TOKEN 与 TRYOUT_PROVIDER。\n" +
    "   本脚本要真的调 LLM 生成档位标准,不能用 mock —— mock 生成的标准没有意义。\n" +
    "   (沉默地拿默认值糊一份 JSON,比直接失败危险得多。)\n"
  );
  process.exit(1);
}

async function chat(messages, maxTokens = 4096) {
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    // ⚠️ maxTokens 必须**显式**给足。server/llm.js 的缺省是 2048,
    //   而实测:超出后上游返回 finishReason="length" 且 **content 为空字符串**,
    //   前 6 道题有 5 道栽在这里(表现为"解析失败",实则一个字都没拿到)。
    // ⚠️ 必须**显式** stream:false。前端 api.client 会传 `stream: !!onToken`,
    //   非流式时是 false;这里若省略,一旦走了流式分支,响应体是 SSE 文本,
    //   解析不出 content —— 症状同样是"静默拿到空串",极难定位。
    body: JSON.stringify({ provider: PROVIDER, stream: false, maxTokens, messages }),
  });
  if (!r.ok) {
    // 必须带上 body,否则 ISSUE-043 那种"结构化错误被静默丢弃"会再次发生
    let detail = "";
    try { detail = JSON.stringify(await r.json()).slice(0, 200); } catch {}
    throw new Error(`HTTP ${r.status} ${detail}`);
  }
  const j = await r.json();
  // ⚠️ 返回**整个**响应而不是只返回 content:第一版只取 content,
  //   于是"模型返回空"这件事没有任何线索(是 finishReason=length 被截断?
  //   还是上游报错?还是真的空?),排查时完全瞎着。
  return j;
}

/** 从响应里取文本,并在取不到时把整个响应挂到错误信息上 */
function readContent(j) {
  const c = j?.data?.content ?? j?.content;
  if (typeof c !== "string" || !c.trim()) {
    const fr = j?.data?.finishReason ?? j?.finishReason ?? "?";
    const err = j?.error ?? j?.data?.error ?? "(无 error 字段)";
    throw new Error(`空响应 finishReason=${fr} error=${err} 键=${Object.keys(j?.data || j).join(",")}`);
  }
  return c;
}

const SYSTEM =
  "你是资深面试官,负责为**一道具体题目**制定评分档位定义。" +
  "你只能依据给定的满分参考与考察方向来定档,不得引入与本题无关的通用标准。" +
  "严格遵守长度限制 —— 你的输出超限会被截断,结果将变成空内容。";

/**
 * 逐档生成:一次调用只产出**一档**。
 *
 * ## 为什么必须分档(这是实测逼出来的,不是过度设计)
 * 第一版是一次性输出 A~E 五档。6 道题里 5 道失败,查响应全部是:
 *   {"content":"", "tokensOut":4096, "finishReason":"length"}
 * 即便把 maxTokens 从缺省 2048 提到 **4096**,`tokensOut` 也跟着涨到 4096,
 * 依然是 `length` + **空 content**。
 * 只有 design-003 一题在 2048 上成功。
 *
 * ⇒ 模型在这些题上生成了**远超 4096 token** 的内容(过度展开/重复),
 *   而**上游截断时返回空字符串而非已生成的部分**(ISSUE-066)。
 *   靠"给更多 token"是治不好的,因为不知道它要多少。
 *
 * 分档后每次输出仅一句话(25~55 字 ≈ 60 token),结构上不可能超限。
 * 代价是 5 次调用,但每次都很短,总 token 反而比无节制展开时少得多。
 */
/**
 * ⭐ R35 的核心修正:每档生成时**带上已定好的上一档作参照**,并显式要求
 *   低档给出"具体错误形态"而不是相邻档的弱化版。
 *
 * R34 的分档版是**各档独立生成**,E 轮 20 样本实测:**比不注入还差**
 * (命中 35% vs 40%,偏移 -0.40 vs -0.25,"仅生成命中 = 0")。
 * 逐档看文本就明白 —— backend-code-006(合并 K 链表):
 *   A 生成: 给出小顶堆与分治归并,写明 O(n log k)、空间O(k)及哑节点
 *   B 生成: 需给出小顶堆和分治归并两种解法及复杂度,但未充分说明哑节点  ← 与 A 高度重复
 *   D 生成: 能提到堆或分治思路,但未给出至少两种解法
 *   E 生成: 未讨论多链表有序合并                                       ← **比 D 还严,单调性被破坏**
 * 独立生成 ⇒ 档位之间没有参照 ⇒ 既不互斥也不单调。
 * 而人工 rubric 的要点是**每档锚定一个"典型错误形态"**
 * (人工 D 档:"声称复杂度是 O(K) 或 O(1)" —— 一个具体错误,不是 A 的弱化版)。
 */
const LETTER_DESC = {
  // ⚠️ R51 重写。原文是"覆盖全部考察方向且无硬伤" —— 那是在要求**穷举 keyPoints**,
  //   等于把 A 档写成"E 档 + 全知识点",实测**没有一道卓越答案能达到**(A 档 1/6 = 17%)。
  //
  //   对照人工 rubric 的写法,差别是根本性的:
  //     旧(错):"完整对比 UUID、雪花与号段,覆盖时钟回拨、趋势递增及高可用,并给出…且无硬伤"
  //            ↑ 穷举三个维度,近乎不可达成
  //     人工(对):"三者优劣对比准确(…),并处理**时钟回拨**问题,且给出可落地的推荐组合"
  //            ↑ 聚焦**这道题特有的陷阱**,而不是把题库相关知识点答全
  //
  //   实测:人工 A 档 5/6(83%),旧生成 A 档 1/6(17%) —— 差 66 个百分点,全部来自这一条措辞。
  //
  //   ⇒ A 档的判据是**洞察**,不是**覆盖率**。
  A: "A 档(满分参考级):要点答对,且能**主动指出本题特有的陷阱、代价或失效边界**" +
     "(如本题最容易答错的那一点、方案的代价、以及为什么这么选)。答对但看不出这一点只能到 B 档。" +
     "**不要罗列要答全的知识点清单** —— A 档不靠覆盖面,靠深度与判断力",
  B: "B 档(良好):主要要点都对,但在覆盖完整性、边界情形或量化说明上有明显欠缺",
  C: "C 档(及格):命中部分核心要点,存在可指认的实质性遗漏或错误",
  D: "D 档(不合格):有明显硬伤或关键事实讲错,但仍能看出对该问题有所了解",
  E: "E 档(无关):与本题基本无关、答非所问,或存在根本性事实错误",
};

/** 生成单档;返回 null 表示这一档失败(不猜、不用默认文案顶替) */
async function genTier(q, letter, anchor) {
  const prev = anchor?.prev ? `## 上一档(${anchor.prev.L})的定义\n${anchor.prev.text}\n` : "";
  const neighbour = letter === "A"
    ? "## 本档必须明显强于所有低档,是整条刻度的上界"
    : `## 上一档的定义(你必须比它明确更弱,并写清差在哪)\n${prev}`;
  const prompt = [
    "## 题目", q.content,
    "## 考察方向", q.keyPoints.join("、"),
    "## 满分参考", q.referenceAnswer,
    "",
    "## 任务",
    `本题是「${q.type}」类型。现在只写 **${letter} 档**的定义,不要写其它档。`,
    `该档定位:${LETTER_DESC[letter]}`,
    neighbour,
    "",
    "硬要求:",
    "1. **只输出一句话**,25~55 字,不要 markdown、不要标题、不要解释。",
    "2. 必须扣住**本题的具体技术/事实要点**,禁止写「表达清晰」「逻辑完整」这类",
    "   放之四海皆准的通用话术。",
    "3. ⭐ 写清本档与上一档的**具体差别**;不能是上一档的同义改写" +
      (letter === "A" ? "(本档没有上一档,但必须是整条刻度的上界)。" : "。"),
    (letter === "C" || letter === "D" || letter === "E")
      ? "4. ⭐ 本档必须给出**一个具体的错误或缺失形态**(如「把 X 误认为 Y」"
        + "「只背结论讲不出机制」),不能只写「比上一档差一点」。"
      : "4. 写清该档具体具备什么。",
    "5. 严禁展开成列表或分点 —— 输出超限会被截断成空内容(实测踩过)。",
  ].join("\n");

  let lastErr = null, raw = "", respDump = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await chat([
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ]);
      respDump = j;
      raw = readContent(j);
      // 剥掉模型爱加的冗余前缀。实测见过三种:
      //   "A: xxx"(冒号) / "A 档: xxx"(带空格) / "A档须用…"(无分隔符,直接接正文)
      // 第三种最初没被覆盖,生成的 A 档正文里带着"A档须用"四个字,注入后读着别扭。
      const s = raw
        .trim()
        .replace(/^["“]|["”]$/g, "")
        .replace(/^[A-E]\s*档?\s*[::]?\s*(?=[\u4e00-\u9fa5A-Za-z])/, "")
        .replace(/^[A-E]\s*档/, "")
        .trim();
      if (s.length >= 8) return { text: s, raw, resp: respDump };
      lastErr = `内容过短(${s.length} 字)`;
    } catch (e) {
      lastErr = e.message;
    }
  }
  return null;
}

/** 把语料的每题 rubric(A–E 描述)映射成评分器既有的 QuestionReference 结构 */
async function genWholeRubric(q) {
  const out = {};
  const order = ["A", "B", "C", "D", "E"];
  for (let i = 0; i < order.length; i++) {
    const L = order[i];
    // 递进:把已定好的上一档交给模型当参照
    const anchor = i > 0 ? { prev: { L: order[i - 1], text: out[order[i - 1]] } } : null;
    const r = await genTier(q, L, anchor);
    if (!r) return { rubric: null, letter: L };
    out[L] = r.text;
  }
  return { rubric: out };
}

console.log(`▶ 生成题目级档位标准(共 ${list.length} 道,已缓存 ${done.size})`);
console.log(`  输出:${OUT}`);

const tmp = OUT + ".tmp";
/** 解析失败的原始输出 —— 没有它就无法区分"截断/格式/内容"三类原因 */
const failFile = OUT + ".failed.jsonl";
if (!RESUME) { try { rmSync(tmp, { force: true }); } catch {} }
// ⚠️ R35 修 bug:`--resume` 时必须先把已有结果**搬进** tmp。
//   原来每次成功都执行 `writeFileSync(OUT, readFileSync(tmp))`,而 RESUME 模式下
//   tmp 是空的 —— 于是"续跑"会把 OUT 整个覆盖成本次生成的那几题,
//   之前已生成的题**静默丢失**。
//   实测:6 题生成完只剩 4 题,导致后续 D 轮有 2 道题退化成"不注入",
//   把生成方案的效果算低了(10/30 样本实际是假的)。
//   —— 症状是"数据少了",没有任何报错,靠肉眼看文件行数才发现。
if (RESUME && done.size) {
  try { writeFileSync(tmp, [...done.values()].map((r) => JSON.stringify(r)).join("\n") + "\n"); } catch {}
}

let okc = 0, failc = 0;
for (let i = 0; i < list.length; i++) {
  const q = list[i];
  if (done.has(q.id)) {
    console.log(`  [${String(i + 1).padStart(3)}/${list.length}] ${q.id} (复用)`);
    continue;
  }
  // 逐档生成:任一档拿不到就整题失败 —— **绝不**用占位文案顶替,
  // 那样会往注入内容里塞进"看起来像标准、实则毫无信息"的文本。
  const { rubric, letter } = await genWholeRubric(q);
  if (!rubric) {
    failc++;
    const failLine = JSON.stringify({ id: q.id, type: q.type, error: `第 ${letter} 档生成失败` }) + "\n";
    appendFileSync(failFile, failLine);
    console.log(`  [${String(i + 1).padStart(3)}/${list.length}] ${q.id} ❌ 第 ${letter} 档生成失败`);
    continue;
  }
  okc++;
  appendFileSync(tmp, JSON.stringify({ id: q.id, type: q.type, rubric }) + "\n");
  writeFileSync(OUT, readFileSync(tmp, "utf8"));
  console.log(`  [${String(i + 1).padStart(3)}/${list.length}] ${q.id} ✅ A=${rubric.A.slice(0, 30)}…`);
}
try { rmSync(tmp, { force: true }); } catch {}

console.log(`\n生成 ${okc} 道 / 失败 ${failc} 道,已落盘 ${OUT}`);
if (failc > 0) {
  console.error(
    `\n⚠️ ${failc} 道题没有生成成功。它们**不会被静默当作"无标准"**使用 ——\n` +
    `   注入时应显式跳过并在报告里计数,否则评测会退化成"部分注入",数字不可比。`
  );
  process.exit(1);
}
