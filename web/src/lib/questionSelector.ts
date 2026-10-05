// 题库检索 —— 纯函数,无 IO
//
// 背景:808 道题此前只在前端内存里(w: 909 KB 全进主 bundle),
// 服务端读不到 referenceAnswer —— 而"评技术正确性"这条产品主线
// 恰恰依赖参考答案做客观基准。本模块负责纯检索逻辑,IO 在 questionStore。
//
// 两条产品规则都有实证支撑,不是拍脑袋:
//   1. 难度映射 —— 高难度时行为题加权。
//      依据 Huffcutt et al. 2001/2004:高复杂度岗位的情境题效度显著下降,
//      而行为描述类问题依然有效。
//   2. 同分必须稳定排序 —— 否则同一场面试两次运行会问出不同的顺序,
//      练习不可复现,也无法回归测试。

export type QuestionType = "technical" | "design" | "behavioral" | "coding" | "questions";
export type QuestionDifficulty = "junior" | "mid" | "senior";
export type SessionDifficulty = "easy" | "normal" | "hard" | "extreme" | "hell";

/** 前端消费用的题库条目(不含 referenceAnswer —— 那是"正确答案",会给用户作弊) */
export interface QuestionLite {
  id: string;
  industry: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  title: string;
  content: string;
  keyPoints: string[];
  tags: string[];
  estimatedMinutes: number;
}

/** 服务端内部使用:含参考答案 */
export interface QuestionFull extends QuestionLite {
  referenceAnswer: string;
}

// ---- 难度映射 ----
/** 5 档会话难度 → 允许的题库难度 */
export const DIFFICULTY_MAP: Record<SessionDifficulty, QuestionDifficulty[]> = {
  easy: ["junior", "mid"],
  normal: ["junior", "mid"],
  hard: ["mid", "senior"],
  extreme: ["senior"],
  hell: ["senior"],
};

/**
 * 题型权重。
 * 高难度提高 behavioral 权重 —— 依据 Huffcutt et al.:
 * 高级岗位的情境题预测力下降,行为题不降。
 */
export const TYPE_WEIGHTS: Record<SessionDifficulty, Record<QuestionType, number>> = {
  easy: { technical: 1.3, design: 1.2, coding: 1, behavioral: 0.8, questions: 1 },
  normal: { technical: 1.2, design: 1.1, coding: 1, behavioral: 0.9, questions: 1 },
  hard: { technical: 1, design: 1, coding: 0.9, behavioral: 1.2, questions: 1 },
  extreme: { technical: 1, design: 0.8, coding: 0.8, behavioral: 1.5, questions: 1 },
  hell: { technical: 1, design: 0.8, coding: 0.8, behavioral: 1.5, questions: 1 },
};

export function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// ---- 统计 ----
export interface FacetCount { id: string; count: number }
export interface BankStats {
  total: number;
  industries: FacetCount[];
  types: FacetCount[];
  difficulties: FacetCount[];
}
export function questionStats(bank: QuestionLite[]): BankStats {
  const industries = new Map<string, number>();
  const types = new Map<string, number>();
  const difficulties = new Map<string, number>();
  for (const q of bank || []) {
    industries.set(q.industry, (industries.get(q.industry) || 0) + 1);
    types.set(q.type, (types.get(q.type) || 0) + 1);
    difficulties.set(q.difficulty, (difficulties.get(q.difficulty) || 0) + 1);
  }
  // 保持题库中的**首次出现顺序**,不按 id 字母序重排。
  // 理由:用户浏览题库时看到的就是这个顺序;按字母序排会让
  // "technical" 跑到 "coding" 后面,与产品内其他列表的呈现不一致。
  const toArr = (m: Map<string, number>): FacetCount[] => [...m.entries()].map(([id, count]) => ({ id, count }));
  return {
    total: (bank || []).length,
    industries: toArr(industries),
    types: toArr(types),
    difficulties: toArr(difficulties),
  };
}

// ---- 倒排索引 ----
export interface SearchIndex {
  byId: Map<string, QuestionLite>;
  byFacet: Map<string, QuestionLite[]>;
  byTag: Map<string, QuestionLite[]>;
}
export function buildSearchIndex(bank: QuestionLite[]): SearchIndex {
  const byId = new Map<string, QuestionLite>();
  const byFacet = new Map<string, QuestionLite[]>();
  const byTag = new Map<string, QuestionLite[]>();
  const push = <K>(m: Map<K, QuestionLite[]>, k: K, q: QuestionLite) => {
    const arr = m.get(k);
    if (arr) arr.push(q);
    else m.set(k, [q]);
  };
  for (const q of bank || []) {
    byId.set(q.id, q);
    push(byFacet, `${q.industry}|${q.type}|${q.difficulty}`, q);
    for (const t of normalizeTags(q.tags)) push(byTag, t, q);
  }
  return { byId, byFacet, byTag };
}

// ---- 检索 ----
export interface SelectParams {
  industry: string;
  sessionDifficulty?: SessionDifficulty;
  type?: QuestionType;
  /** 本场已问过的题 id */
  excludeIds?: string[];
  /** 从简历/JD 抽取的技能标签,命中的题优先 */
  resumeTags?: string[];
  limit?: number;
}

export function selectQuestions(bank: QuestionLite[], params: SelectParams): QuestionLite[] {
  const { industry, type, excludeIds, resumeTags, limit } = params;
  const diff = params.sessionDifficulty || "normal";
  const allowed = new Set(DIFFICULTY_MAP[diff] || DIFFICULTY_MAP.normal);
  const excluded = new Set(excludeIds || []);
  const wanted = new Set(normalizeTags(resumeTags));
  const weights = TYPE_WEIGHTS[diff] || TYPE_WEIGHTS.normal;

  const scored: Array<{ q: QuestionLite; s: number }> = [];
  for (const q of bank || []) {
    if (q.industry !== industry) continue;
    if (!allowed.has(q.difficulty)) continue;
    if (type && q.type !== type) continue;
    if (excluded.has(q.id)) continue;

    // 难度是硬过滤,不参与打分(否则"稍低难度"会压过"命中简历技能")
    let s = (weights[q.type] ?? 1) * 10;
    if (wanted.size > 0) {
      const tags = normalizeTags(q.tags);
      const hits = tags.filter((t) => wanted.has(t)).length;
      if (hits > 0) s += 25 * Math.min(hits / 3, 1);
    }
    scored.push({ q, s });
  }

  // 同分按 id 稳定排序 —— 保证可复现
  scored.sort((a, b) => (b.s - a.s) || a.q.id.localeCompare(b.q.id));
  const out = scored.map((x) => x.q);
  return typeof limit === "number" && limit > 0 ? out.slice(0, limit) : out;
}
