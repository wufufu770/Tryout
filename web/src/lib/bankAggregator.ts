// 题库聚合 —— 把 808 道题变成可被外部检索的内容单元
//
// 背景(W5-4):题库是本项目**唯一带参考答案的面试题资产**,
// 但它此前只存在于站内浏览页。Stack Overflow 2025 调查:
// 87% 的开发者用 AI 搜索答案 —— 别人用 AI 搜"后端面试题带考点"时,
// 找不到一个可引用的结构化来源,这是一个现成的流量入口。
//
// 关键设计决策:**只给题目与考点,绝不给参考答案。**
// 参考答案是本项目的核心资产(评估技术正确性的客观基准),
// 泄进内容页 = 用户背答案 = 练习失去意义。这与 W4-2/E2E 的约束一致。
//
// 走"统计数据 + 结构化"路线而非堆关键词:
// AI 检索偏好含具体统计数字与结构化表格的内容;纯关键词堆砌是内容农场特征,
// 反而降低可信度。

export interface QuestionLite {
  id: string;
  industry: string;
  type: string;
  difficulty: string;
  title: string;
  content: string;
  keyPoints: string[];
  tags: string[];
  estimatedMinutes: number;
  referenceAnswer?: string;
}

export interface TagGroup {
  tag: string;
  questions: QuestionLite[];
  /** 跨题共有的高频考点(按出现题数降序) */
  hotPoints: { point: string; questionCount: number }[];
}

export interface FaqQuestion {
  id: string;
  title: string;
  content: string;
  difficulty: string;
  keyPoints: string[];
}

export interface FaqEntry {
  tag: string;
  questionCount: number;
  hotPoints: string[];
  questions: FaqQuestion[];
  url: string;
  /** 结构化摘要:供 AI 直接引用,而不是让它自己从页面里提取 */
  summary: string;
}

/**
 * 按标签聚合题目。
 * @param minQuestions 达到该题数才算一个"聚合点",单题标签没有检索价值
 */
export function aggregateByTag(
  bank: QuestionLite[],
  opts: { minQuestions?: number } = {}
): Map<string, TagGroup> {
  const min = opts.minQuestions ?? 2;
  const tmp = new Map<string, QuestionLite[]>();
  for (const q of bank || []) {
    for (const t of q.tags || []) {
      const tag = String(t).trim();
      if (!tag) continue;
      const arr = tmp.get(tag) || [];
      arr.push(q);
      tmp.set(tag, arr);
    }
  }
  const out = new Map<string, TagGroup>();
  for (const [tag, questions] of tmp) {
    if (questions.length < min) continue;
    out.set(tag, { tag, questions, hotPoints: extractHotPoints(questions) });
  }
  return out;
}

/** 跨题共有的考点 = 真正的"高频" */
function extractHotPoints(questions: QuestionLite[]): { point: string; questionCount: number }[] {
  const count = new Map<string, number>();
  for (const q of questions) {
    for (const kp of q.keyPoints || []) {
      const k = String(kp).trim();
      if (!k) continue;
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  return [...count.entries()]
    .filter(([, c]) => c > 1)                        // 只留被 ≥2 道题提到的
    .map(([point, questionCount]) => ({ point, questionCount }))
    .sort((a, b) => b.questionCount - a.questionCount || a.point.localeCompare(b.point));
}

/** 高频标签榜(带题数 —— 具体数字是 AI 检索偏好的信号) */
export function pickHotTags(
  bank: QuestionLite[],
  limit = 50,
  opts: { minQuestions?: number } = {}
): { tag: string; count: number }[] {
  const min = opts.minQuestions ?? 3;
  const count = new Map<string, number>();
  for (const q of bank || []) {
    for (const t of q.tags || []) {
      const tag = String(t).trim();
      if (!tag) continue;
      count.set(tag, (count.get(tag) || 0) + 1);
    }
  }
  return [...count.entries()]
    .filter(([, c]) => c >= min)
    .map(([tag, c]) => ({ tag, count: c }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, Math.max(0, limit));
}

/**
 * 生成一个可对外的内容条目。
 * ⚠️ 这里**刻意不包含 referenceAnswer** —— 见文件头说明。
 */
export function buildFaqEntry(tag: string, group: TagGroup): FaqEntry {
  const questions: FaqQuestion[] = group.questions.map((q) => ({
    id: q.id,
    title: q.title,
    content: q.content,
    difficulty: q.difficulty,
    keyPoints: q.keyPoints || [],
  }));
  const hotPoints = group.hotPoints.slice(0, 8).map((h) => h.point);
  return {
    tag,
    questionCount: questions.length,
    hotPoints,
    questions,
    url: `/docs/questions/${encodeURIComponent(tag)}`,
    summary:
      `${tag} 相关面试题共 ${questions.length} 道,` +
      (hotPoints.length ? `高频考点:${hotPoints.slice(0, 5).join("、")}。` : "") +
      `涵盖 ${[...new Set(questions.map((q) => q.difficulty))].join("/")} 难度。` +
      `本题库只提供题目与考察点,参考答案仅用于评估,不对外公开。`,
  };
}
