// v5:整场面试回顾评价生成器
// 调用 LLM 对整场面试做回顾,产出优势/不足/改进建议/下次重点

export const SESSION_REVIEW_PROMPT = `你是一位资深面试官,请对以下整场面试做出回顾评价。

面试主题方向:{{focusDirection}}
面试流程阶段:{{stages}}
参与面试官:{{agents}}
会话难度:{{difficulty}}

完整对话记录:
{{conversation}}

请严格输出以下 JSON 格式(不要输出其他内容):
{
  "overallScore": 7.5,
  "strengths": ["候选人表现出的优势 1", "优势 2"],
  "weaknesses": ["不足之处 1", "不足之处 2"],
  "improvements": [
    {"area": "需要改进的方面", "suggestion": "具体改进建议", "priority": "high"}
  ],
  "performance": "整体表现的综合性叙述,3-5 句话",
  "nextFocus": "下次面试建议重点训练的方向,2-3 条"
}`;

export interface ParsedReview {
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  improvements: Array<{ area: string; suggestion: string; priority: "high" | "medium" | "low" }>;
  performance: string;
  nextFocus: string;
}

/**
 * 解析 LLM 输出为结构化评价。
 *
 * ⚠️ R24:此前是 `Number(parsed.overallScore) || 0`。
 *   LLM 漏掉 overallScore 或返回非数字时,**静默变成 0 分** ——
 *   用户看到"本次面试 0 分",而真相是"我没解析出来"。
 *   这是"假数据"模式的第五次出现(前四次:PEER_BENCHMARK / expressionScore /
 *   matchScore / radarData)。
 *
 * 现在的规则:
 *   - 必需字段缺失/类型错误 → 返回 null,让调用方走"解析失败"分支
 *   - overallScore 为 0 本身是**有效值**(真的 0 分),不能被当成缺失
 *   - improvements[].priority 非法值做**归一**而非丢弃整个结果
 *     (内容仍可用,只是优先级未知)
 */
export function parseReviewResult(text: string): ParsedReview | null {
  if (!text) return null;
  // 尝试提取 JSON(可能包裹在 ```json ... ``` 或 <think> 块中)
  let jsonStr = text.trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/i, "")
    .trim();
  const codeFenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeFenceMatch) {
    jsonStr = codeFenceMatch[1].trim();
  }
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  // overallScore 必须是有限数字(0 是合法值,不能用 || 判定)
  if (typeof parsed.overallScore !== "number" || !Number.isFinite(parsed.overallScore)) return null;

  // 必需数组字段:必须是字符串数组
  for (const key of ["strengths", "weaknesses", "improvements"] as const) {
    if (!Array.isArray(parsed[key])) return null;
  }
  if (!parsed.strengths.every((x: unknown) => typeof x === "string")) return null;
  if (!parsed.weaknesses.every((x: unknown) => typeof x === "string")) return null;

  // improvements 元素必须完整;priority 非法则归一为 medium
  const PRIORITIES = new Set(["high", "medium", "low"]);
  for (const it of parsed.improvements) {
    if (!it || typeof it !== "object") return null;
    if (typeof it.area !== "string" || typeof it.suggestion !== "string") return null;
  }
  const improvements = parsed.improvements.map((it: any) => ({
    area: it.area,
    suggestion: it.suggestion,
    priority: PRIORITIES.has(it.priority) ? it.priority : ("medium" as const),
  }));

  return {
    overallScore: parsed.overallScore,
    strengths: parsed.strengths,
    weaknesses: parsed.weaknesses,
    improvements,
    performance: typeof parsed.performance === "string" ? parsed.performance : "",
    nextFocus: typeof parsed.nextFocus === "string" ? parsed.nextFocus : "",
  };
}

// 构建评价 prompt
export function buildReviewPrompt(params: {
  focusDirection?: string;
  stages: string[];
  agentNames: string[];
  difficulty?: string;
  conversation: string;
}): string {
  return SESSION_REVIEW_PROMPT
    .replace("{{focusDirection}}", params.focusDirection || "(未指定)")
    .replace("{{stages}}", params.stages.join(" → ") || "(未指定)")
    .replace("{{agents}}", params.agentNames.join(", ") || "(未指定)")
    .replace("{{difficulty}}", params.difficulty || "normal")
    .replace("{{conversation}}", params.conversation);
}
