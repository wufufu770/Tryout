// 题库客户端(前端)
//
// 背景(W3-1):题库原为前端静态 import(web/src/data/questionBank.*.ts,合计 909 KB),
// 全部打进 Vite 主 bundle —— 首屏白白下载 900 KB 用不上的数据。
// 现在改为按需从服务端拉取,主 bundle 不再包含题库。
//
// 降级策略(必须存在):
//   1. 优先 GET /api/questionbank(服务端权威副本)
//   2. 服务端不可达 → 回退到 public/questionbank.json(静态副本,支持 file:// 直开)
//   3. 两处都失败 → 返回空题库并带上 error,让 UI 降级渲染而不是崩溃
//
// 🔴 安全:即使回退到静态文件,也必须剔除 referenceAnswer。
//    它是"正确答案",发给前端等于让用户背答案,评估随即失去意义。

import type { QuestionLite, QuestionType, QuestionDifficulty, SessionDifficulty } from "./questionSelector";
import type { BankStats } from "./questionSelector";

export type { QuestionLite };

export interface Query {
  industry: string;
  sessionDifficulty?: SessionDifficulty;
  type?: QuestionType;
  excludeIds?: string[];
  resumeTags?: string[];
  limit?: number;
}

export interface FetchResult {
  questions: QuestionLite[];
  stats?: BankStats;
  /** 实际数据来源:api / static(兜底) / empty(全失败) */
  source: "api" | "static" | "empty";
  error?: string;
}

const STATIC_FALLBACK = "/questionbank.json";

/** 构造查询 URL */
export function questionBankUrl(q: Query): string {
  const p = new URLSearchParams();
  p.set("industry", q.industry);
  if (q.sessionDifficulty) p.set("sessionDifficulty", q.sessionDifficulty);
  if (q.type) p.set("type", q.type);
  if (q.excludeIds?.length) p.set("exclude", q.excludeIds.join(","));
  if (q.resumeTags?.length) p.set("tags", q.resumeTags.join(","));
  if (typeof q.limit === "number" && q.limit > 0) p.set("limit", String(q.limit));
  return `/api/questionbank?${p.toString()}`;
}

/** 剔除参考答案 —— 任何进入前端状态的对象都必须过这一层 */
function stripReference<T>(q: T): QuestionLite {
  const { referenceAnswer, ...rest } = (q || {}) as Record<string, unknown>;
  void referenceAnswer;
  return rest as unknown as QuestionLite;
}

export async function fetchQuestionBank(q: Query): Promise<FetchResult> {
  // 1) 服务端
  try {
    const r = await fetch(questionBankUrl(q));
    if (r.ok) {
      const j = await r.json();
      const data = j?.data;
      const list = Array.isArray(data) ? data : [];
      if (list.length > 0 || Array.isArray(data)) {
        return { questions: list.map(stripReference), stats: undefined, source: "api" };
      }
    }
  } catch {
    // 网络异常:继续走兜底,不向上抛
  }

  // 2) 静态兜底(全部题,不按查询过滤 —— 前端可自行 filter)
  try {
    const r = await fetch(STATIC_FALLBACK);
    if (r.ok) {
      const j = await r.json();
      const list = Array.isArray(j?.questions) ? j.questions : [];
      if (list.length > 0) {
        return { questions: list.map(stripReference), source: "static" };
      }
      return { questions: [], source: "empty", error: "静态题库为空,请重新生成" };
    }
    return { questions: [], source: "empty", error: `静态题库不可用(HTTP ${r.status})` };
  } catch (e) {
    return { questions: [], source: "empty", error: (e as Error)?.message || "题库加载失败" };
  }
}

/** 题库统计(供筛选器渲染) */
export async function fetchQuestionBankStats(): Promise<BankStats | null> {
  try {
    const r = await fetch("/api/questionbank/stats");
    if (!r.ok) return null;
    const j = await r.json();
    const d = j?.data;
    if (!d || typeof d.total !== "number") return null;
    return {
      total: d.total,
      industries: Array.isArray(d.industries) ? d.industries : [],
      types: Array.isArray(d.types) ? d.types : [],
      difficulties: Array.isArray(d.difficulties) ? d.difficulties : [],
    };
  } catch {
    return null;
  }
}

// ---- R32(ISSUE-038):单题参考答案 ----
//
// 背景:buildReferenceBlock/scoringEngine 早就支持按题型注入题目级判据,
// 但 InterviewPage / HistoryPage 两处都传 undefined —— 评分器从来没有基准可依。
// R18 的配对消融证明注入后命中率 40%→65%、偏移 −0.55→−0.05。
//
// ⚠️ 这里的 referenceAnswer 与 stripReference() 剔除的是同一个字段,
//    区别在于:列表接口一次给 808 题(可整库背答案),这里一次只给当前这一题,
//    且必须需 token 才能取。详见 server/index.js 中该端点的安全权衡注释。
//
// 失败一律返回 null:调用方据此降级为"无基准评估"并如实告知用户,
// 绝不静默假装有基准。

export interface QuestionReferenceBlock {
  referenceAnswer: string;
  keyPoints: string[];
  /** 服务端给的权威题型;buildReferenceBlock 按它选判据(ISSUE-039) */
  type?: string;
}

/** 同一题的 reference 只取一次 —— 现场评估每轮都会用到 */
const refCache = new Map<string, QuestionReferenceBlock | null>();
/** 同 id 的并发请求复用同一个 promise,避免一轮评估里 6 个维度各拉一次 */
const inflight = new Map<string, Promise<QuestionReferenceBlock | null>>();

export async function fetchQuestionReference(id: string): Promise<QuestionReferenceBlock | null> {
  const key = String(id || "");
  if (!key) return null;
  if (refCache.has(key)) return refCache.get(key) ?? null;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async (): Promise<QuestionReferenceBlock | null> => {
    try {
      const r = await fetch(`/api/questionbank/${encodeURIComponent(key)}/reference`);
      if (!r.ok) return null;
      const j = await r.json();
      const d = j?.data;
      if (!d || typeof d.referenceAnswer !== "string" || !d.referenceAnswer.trim()) return null;
      const kp = Array.isArray(d.keyPoints)
        ? d.keyPoints.filter((k: unknown): k is string => typeof k === "string" && k.trim().length > 0)
        : [];
      // keyPoints 为空时 buildReferenceBlock 会输出"考察方向:"空行,退化为无基准
      if (kp.length === 0) return null;
      return {
        referenceAnswer: d.referenceAnswer,
        keyPoints: kp,
        type: typeof d.type === "string" ? d.type : undefined,
      };
    } catch {
      return null;
    }
  })();

  inflight.set(key, p);
  const result = await p;
  inflight.delete(key);
  refCache.set(key, result);
  return result;
}

/** 仅供测试:清空 reference 缓存 */
export function __resetReferenceCache(): void {
  refCache.clear();
  inflight.clear();
}
