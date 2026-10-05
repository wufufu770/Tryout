// 题库存储(服务端)
//
// 为什么在服务端:题库原先只存在于前端 TS 模块(web/src/data/questionBank.*.ts,
// 合计 909 KB,全进 Vite 主 bundle),服务端读不到 referenceAnswer。
// 而"评技术正确性而非表达流畅度"这条产品主线恰恰依赖参考答案作客观基准 —
// 评估时必须由服务端注入 reference,同时列表接口必须剔除它(否则用户直接背答案)。
//
// 为什么不建表:题库是**静态参考数据**,没有写入路径、没有关系查询需求。
// 读一次 JSON、进程内建索引即可。建表会带来无收益的迁移与一致性负担。
//
// 落盘位置:server/data/questionbank.json(由 `npm run export:questionbank` 生成)。
// 缺失时不报错,退化为空题库 —— 首次 clone 后未跑导出脚本是正常状态。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/services/ -> server/
const SERVER_ROOT = path.resolve(__dirname, "..");

/**
 * 题库路径。
 *
 * R46:支持 `INTERVIEWX_QUESTIONBANK_PATH` 覆盖 —— **仅为可测试性**。
 * 此前 `getReferenceForScoring` 里"清洗后 keyPoints 为空 ⇒ 返回 null"这个分支
 * **没有任何测试能覆盖**:题库是 `export-questionbank` 的产物(不是测试夹具),
 * 808 题没有一道 keyPoints 为空 ⇒ 分支不可达 ⇒ 变异测试 V07 杀不死。
 * 与其把假题写进真题库(会污染运行时),不如让路径可注入,
 * 元测试在**临时题库**里造那道题。
 * 向后兼容:不设环境变量时与原来完全一致。
 */
const QUESTION_BANK_PATH = process.env.INTERVIEWX_QUESTIONBANK_PATH
  ? path.resolve(process.env.INTERVIEWX_QUESTIONBANK_PATH)
  : path.join(SERVER_ROOT, "data", "questionbank.json");

/** 内存缓存:题库是静态的,进程生命周期内只读一次 */
let cache = null;

export function getQuestionBankPath() {
  return QUESTION_BANK_PATH;
}

/**
 * 载入题库(带缓存)
 * @returns {{ total:number, meta:any, questions:any[], byId:Map<string,any> } | null}
 */
export function loadQuestionBank() {
  if (cache) return cache;
  if (!fs.existsSync(QUESTION_BANK_PATH)) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(QUESTION_BANK_PATH, "utf8"));
  } catch (e) {
    // JSON 损坏:不要让整个服务起不来,退化为空题库并在日志里留下线索
    console.warn(`[questionBank] 解析失败(${QUESTION_BANK_PATH}):${e.message} —— 退化为空题库`);
    return null;
  }
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  const byId = new Map();
  for (const q of questions) {
    if (q && typeof q.id === "string") byId.set(q.id, q);
  }
  cache = {
    total: questions.length,
    meta: parsed?.meta || null,
    version: parsed?.version || null,
    questions,
    byId,
  };
  return cache;
}

/** 仅供测试:清空缓存 */
export function resetQuestionBankCache() {
  cache = null;
}

/** 剔除参考答案 —— 任何面向前端的响应都必须走这一层 */
export function toLite(q) {
  if (!q) return null;
  const { referenceAnswer, ...rest } = q;
  void referenceAnswer; // 显式丢弃
  return rest;
}

/**
 * 按 id 取完整题目(**含** referenceAnswer),仅供服务端内部评估使用。
 * 找不到返回 null —— 不猜、不降级成"用题面当答案"。
 */
export function getQuestionById(id) {
  const bank = loadQuestionBank();
  if (!bank || !id) return null;
  return bank.byId.get(id) || null;
}

/**
 * 取出评估所需的参考块;题目不存在时返回 null(评估应跳过而不是用错的基准)
 *
 * R32(ISSUE-038):此前**零调用方** —— 注释声称"仅供服务端内部评估使用",
 * 但评分器(scoringEngine)整体跑在浏览器端,参考答案不到前端就进不了 prompt,
 * 于是 InterviewPage 一直传 undefined。R18 配对消融显示:注入题目级标准后
 * 命中率 40%→65%、偏移 −0.55→−0.05,缺的就是这块。
 *
 * 补 type:buildReferenceBlock 需按题型选判据(ISSUE-039),由服务端给出权威值,
 * 不采信前端自称的题型。
 */
export function getReferenceForScoring(id) {
  const q = getQuestionById(id);
  if (!q) return null;
  if (!q.referenceAnswer) return null;
  // R44 变异测试 V07 存活变异:原先是 `q.keyPoints.length === 0` 的**长度检查**,
  //   去掉它测试照样绿 —— 因为当前题库 808 题没有一道是空 keyPoints,
  //   **这个分支在现有数据下根本走不到**,写什么测试都杀不掉它。
  //   与其为"造一道空 keyPoints 的题"去污染生产代码,不如让实现对**含空项**也健壮:
  //   先逐项清洗(去 null/去空白),清洗后为空才判无参考块。
  //   如此该变异自然变成**等价变异**(杀不死,但也不改变行为)。
  const kp = (Array.isArray(q.keyPoints) ? q.keyPoints : [])
    .map((k) => String(k == null ? "" : k).trim())
    .filter((k) => k.length > 0);
  if (kp.length === 0) return null;
  return {
    referenceAnswer: String(q.referenceAnswer),
    keyPoints: kp,
    type: typeof q.type === "string" ? q.type : undefined,
  };
}

/** 题库统计(行业/题型/难度分布),供前端筛选器渲染 */
export function getBankStats() {
  const bank = loadQuestionBank();
  const industries = new Map();
  const types = new Map();
  const difficulties = new Map();
  if (bank) {
    for (const q of bank.questions) {
      industries.set(q.industry, (industries.get(q.industry) || 0) + 1);
      types.set(q.type, (types.get(q.type) || 0) + 1);
      difficulties.set(q.difficulty, (difficulties.get(q.difficulty) || 0) + 1);
    }
  }
  const toArr = (m) => [...m.entries()].map(([id, count]) => ({ id, count }));
  return {
    total: bank?.total || 0,
    version: bank?.version || null,
    available: !!bank,
    path: QUESTION_BANK_PATH,
    industries: toArr(industries),
    types: toArr(types),
    difficulties: toArr(difficulties),
  };
}

/**
 * 检索候选题(供提问决策使用)
 * 逻辑与前端 questionSelector 保持一致 —— 但实现在服务端,
 * 因为提问决策最终要由后端驱动(避免前端伪造题目 id)。
 */
export function selectQuestions(params) {
  const bank = loadQuestionBank();
  if (!bank) return [];
  const {
    industry,
    sessionDifficulty = "normal",
    type,
    excludeIds = [],
    resumeTags = [],
    limit,
  } = params || {};

  const DIFF = {
    easy: ["junior", "mid"],
    normal: ["junior", "mid"],
    hard: ["mid", "senior"],
    extreme: ["senior"],
    hell: ["senior"],
  };
  // 高难度提高行为题权重 —— 依据 Huffcutt et al. 2001/2004:
  // 高级岗位的情境题效度下降,行为描述题不降。
  const W = {
    easy: { technical: 1.3, design: 1.2, coding: 1, behavioral: 0.8, questions: 1 },
    normal: { technical: 1.2, design: 1.1, coding: 1, behavioral: 0.9, questions: 1 },
    hard: { technical: 1, design: 1, coding: 0.9, behavioral: 1.2, questions: 1 },
    extreme: { technical: 1, design: 0.8, coding: 0.8, behavioral: 1.5, questions: 1 },
    hell: { technical: 1, design: 0.8, coding: 0.8, behavioral: 1.5, questions: 1 },
  };
  const norm = (tags) =>
    (Array.isArray(tags) ? tags : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const normSet = new Set(norm(resumeTags));
  const excluded = new Set(Array.isArray(excludeIds) ? excludeIds : []);
  const allowed = new Set(DIFF[sessionDifficulty] || DIFF.normal);
  const weights = W[sessionDifficulty] || W.normal;

  const scored = [];
  for (const q of bank.questions) {
    if (q.industry !== industry) continue;
    if (!allowed.has(q.difficulty)) continue;
    if (type && q.type !== type) continue;
    if (excluded.has(q.id)) continue;
    let s = (weights[q.type] ?? 1) * 10;
    if (normSet.size > 0) {
      const hits = norm(q.tags).filter((t) => normSet.has(t)).length;
      if (hits > 0) s += 25 * Math.min(hits / 3, 1);
    }
    scored.push({ q, s });
  }
  scored.sort((a, b) => b.s - a.s || a.q.id.localeCompare(b.q.id));
  const out = scored.map((x) => x.q);
  return typeof limit === "number" && limit > 0 ? out.slice(0, limit) : out;
}
