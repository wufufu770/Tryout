// JD 匹配度计算
//
// ⭐ 本模块存在的唯一理由:修一个**假数据**。
//
// 此前 MaterialPage 的写法:
//   `parsed.skills.length ? round(matched/skills*100) : 0`
//
// 简历解析失败(技能 0 条)时直接给 **0 分**。用户看到「匹配度 0%」
// 会以为是自己能力差 —— 而真相是「我没读懂你的简历」。
//
// 0 分和"无法计算"是两件完全不同的事:
//   0 分      = 我读懂了,你和 JD 不匹配 → 这是结论
//   无法计算 = 我没读懂              → 这是失败,必须暴露
//
// 这与 P2-4(W5-1 删除假基准)、expressionScore 弃用是同一个问题的第三次出现:
// **用看起来合理的数字掩盖"我不知道"**。

export type MatchFailureReason = "noSkillsInResume" | "emptyJd";

export interface MatchInput {
  /** 从简历解析出的技能 */
  skills: string[];
  /** 其中命中 JD 的技能 */
  matchedSkills: string[];
  /** JD 为空(可选,用于区分失败原因) */
  jdEmpty?: boolean;
}

export interface MatchResult {
  /** 0-100;null = 无法计算(不是 0 分!) */
  score: number | null;
  reason?: MatchFailureReason;
  /** 实际参与计算的分母,便于 UI 说明 */
  denominator?: number;
}

export function computeMatchScore(input: MatchInput): MatchResult {
  const skills = Array.isArray(input?.skills) ? input.skills : [];
  const matched = Array.isArray(input?.matchedSkills) ? input.matchedSkills : [];

  if (skills.length === 0) {
    return { score: null, reason: input?.jdEmpty ? "emptyJd" : "noSkillsInResume" };
  }
  if (input?.jdEmpty) {
    return { score: null, reason: "emptyJd" };
  }
  // matched 是 skills 的子集时长度不会超出;防御性夹紧避免数据异常导致 >100
  const hit = Math.min(matched.length, skills.length);
  return {
    score: Math.round((hit / skills.length) * 100),
    denominator: skills.length,
  };
}

export type MatchQuality = "unknown" | "high" | "medium" | "low";

export interface MatchQualityDesc {
  kind: MatchQuality;
  label: string;
}

/** 给分数一个语义标签;无法计算时明确说明"是没读懂"而不是"分数低" */
export function describeMatchQuality(input: MatchInput): MatchQualityDesc {
  const r = computeMatchScore(input);
  if (r.score === null) {
    return {
      kind: "unknown",
      label:
        r.reason === "emptyJd"
          ? "岗位描述为空,无法计算匹配度"
          : "未能从简历中识别出技能,匹配度无法计算 —— 这不代表你不符合该岗位",
    };
  }
  if (r.score >= 70) return { kind: "high", label: "技能匹配度较高" };
  if (r.score >= 40) return { kind: "medium", label: "技能部分匹配" };
  return { kind: "low", label: "识别出的技能与 JD 匹配较少" };
}
