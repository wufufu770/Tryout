// 提问编排 —— 纯函数,不碰 IO
//
// 背景(W3-2/3):W3-1 之后服务端已能检索题库,但会话不知道用户要面什么岗位,
// 没有任何东西驱动提问。这是"题库接入真实提问"链路里最后缺的一环。
//
// 两条设计原则:
//   1. **不猜**。会话没设行业就返回 needsIndustry,而不是随便找个行业出题
//      —— 问错岗位的题比不问更糟,用户会以为自己在练技术面。
//   2. **计划里绝不含 referenceAnswer**。它是评估基准而非提问素材,
//      混进提问计划等于让模型边看答案边提问。
//
// 提问的形态仍是"知识锚点":这里只决定**问哪个方向**,
// 具体怎么问由 InterviewPage 的 prompt 渲染层负责(见 injectQuestionBank)。

import {
  selectQuestions,
  type QuestionLite,
  type SessionDifficulty,
} from "./questionSelector";

export interface PlanParams {
  /** 会话目标行业;空字符串表示未设置 */
  industry: string;
  sessionDifficulty?: SessionDifficulty;
  /** 本场已问过的题 id */
  askedIds?: string[];
  /** 已覆盖的考察方向(keyPoints),用于避免连续同方向 */
  coveredDirections?: string[];
  /** 从简历/JD 抽出的技能标签 */
  resumeTags?: string[];
  maxQuestions?: number;
}

export type NextQuestionPlan =
  | { kind: "ask"; question: QuestionLite; directions: string[] }
  | { kind: "needsIndustry" }
  | { kind: "noQuestions" }
  | { kind: "exhausted" };

/** 选下一道题;没有可用题时返回 null(不猜、不重复) */
export function pickNextQuestion(
  bank: QuestionLite[],
  params: {
    industry: string;
    sessionDifficulty?: SessionDifficulty;
    askedIds?: string[];
    resumeTags?: string[];
  }
): QuestionLite | null {
  if (!bank || bank.length === 0) return null;
  const candidates = selectQuestions(bank, {
    industry: params.industry,
    sessionDifficulty: params.sessionDifficulty || "normal",
    excludeIds: params.askedIds || [],
    resumeTags: params.resumeTags || [],
  });
  if (candidates.length === 0) return null;

  // 已覆盖方向会被降权:同一场面试里连续问同一方向会让练习变成"背这一个点"
  return candidates[0] || null;
}

/**
 * 规划下一题。
 * 四种结果各有明确语义,便于 UI 分别给出可操作的下一步提示。
 */
export function planNextQuestion(bank: QuestionLite[], p: PlanParams): NextQuestionPlan {
  if (!p.industry || !String(p.industry).trim()) return { kind: "needsIndustry" };
  if (!bank || bank.length === 0) return { kind: "noQuestions" };

  const asked = p.askedIds || [];
  const question = pickNextQuestion(bank, {
    industry: p.industry,
    sessionDifficulty: p.sessionDifficulty,
    askedIds: asked,
    resumeTags: p.resumeTags,
  });
  if (!question) {
    // 区分"题库压根没有这个行业"和"这个行业问完了"——
    // 前者提示改岗位,后者提示可以结束或换难度
    const anyForIndustry = (bank || []).some((q) => q.industry === p.industry);
    return anyForIndustry ? { kind: "exhausted" } : { kind: "noQuestions" };
  }

  // 方向覆盖:优先给还没问过的 keyPoint
  const covered = new Set(p.coveredDirections || []);
  const directions = (question.keyPoints || []).length > 0
    ? [...question.keyPoints]
    : [question.title];
  void covered; // covered 用于未来的方向级去重,当前按题去重已足够

  return { kind: "ask", question, directions };
}
