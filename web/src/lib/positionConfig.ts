// 岗位配置 —— 纯函数,不碰 React
//
// 背景(W3-3):W3-2 已让会话能带 industry/position,但用户还没有选它的入口。
// 本模块负责两件事:
//   1. 把用户的选择映射为 API 字段(buildSessionPayload)
//   2. 在**开始面试之前**校验选择是否可用(validatePositionSelection)
//
// 为什么要前置校验:
//   W3-2 的 questionPlanner 在未设行业时返回 needsIndustry(不猜岗位)。
//   若前端不拦,用户会走进面试、答完几轮才发现题库用不上 ——
//   白等 LLM 调用,体验极差。必须在开始前拦,并给出可操作提示。

export type SessionDifficulty = "easy" | "normal" | "hard" | "extreme" | "hell";

export interface PositionSelection {
  /** 题库行业 id,如 "backend";空字符串 = 未选 */
  industry: string;
  /** 自由岗位名,可选 */
  position: string;
}

export interface BankStatsLike {
  total: number;
  industries: { id: string; count: number }[];
  /** 服务端标注题库是否真的加载成功(W3-1 的 available 字段) */
  available?: boolean;
}

export type ValidationFailure =
  | "noIndustry"
  | "bankUnavailable"
  | "noQuestionsForIndustry";

export interface ValidationResult {
  ok: boolean;
  reason?: ValidationFailure;
  /** 面向用户的中文提示;后续接入 i18n 时替换 */
  message?: string;
}

export function validatePositionSelection(
  sel: PositionSelection,
  stats: BankStatsLike
): ValidationResult {
  /*
   * ⚠️ 题库不可用时**放行**,不拦截 —— 且在设了行业时也放行。
   *
   * 理由:题库是**可选增强**,不是面试的前提条件。
   * 新 clone 的仓库默认没跑过 export:questionbank;若在此硬拦,
   * 相当于让"没生成题库"的用户完全无法使用面试功能 —— 把增强变成了门槛。
   * 降级后提问侧走 needsIndustry(不猜岗位),由 LLM 自由发挥,与 W3-1 之前一致。
   *
   * 只在一种情况下拦截:题库明明可用,用户却选了一个**确实没有题**的行业。
   * 那是明确的配置错误,提前提示比走到一半才发现好。
   */
  const industries = Array.isArray(stats?.industries) ? stats.industries : [];
  const bankReady = stats?.available !== false && industries.length > 0;

  if (!bankReady) {
    // 题库没就绪:不拦,但把 reason 传出去供 UI 提示(非阻断)
    return { ok: true, reason: "bankUnavailable" };
  }

  // 题库可用,但用户选了一个没有题的行业 —— 这是明确的配置错误
  if (sel.industry) {
    const hit = industries.find((x) => x.id === sel.industry);
    if (!hit || (hit.count ?? 0) <= 0) {
      return {
        ok: false,
        reason: "noQuestionsForIndustry",
        message: "该行业在题库中暂无题目,可换一个行业,或在资料中补充更多背景。",
      };
    }
  }
  return { ok: true };
}

/** 把 5 档会话难度翻译成用户看得懂的一句话(说明会命中题库哪一档) */
export function describeDifficulty(d: SessionDifficulty): string {
  switch (d) {
    case "easy":    return "初级 + 中级题,适合初次接触";
    case "normal":  return "初级 + 中级题,常规面试难度";
    case "hard":    return "中级 + 高级题,有一定经验要求";
    case "extreme": return "仅高级题,考察较深(资深/专家岗常见)";
    case "hell":    return "仅高级题,压力最大";
  }
}

export interface SessionPayloadInput {
  title: string;
  modelId: string;
  difficulty: SessionDifficulty;
}

/** 组装 createSession 的请求体 */
export function buildSessionPayload(
  sel: PositionSelection,
  base: SessionPayloadInput
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: base.title,
    modelId: base.modelId,
    difficulty: base.difficulty,
    // 显式 null 表示"用户明确没设行业" —— 与 undefined(从未涉及)语义不同,
    // 提问侧据此返回 needsIndustry 而非静默按自由发挥处理。
    industry: sel.industry ? sel.industry : null,
  };
  // 岗位名是可选的:为空时直接省略键,不要传空串
  const p = (sel.position || "").trim();
  if (p) payload.position = p;
  return payload;
}
