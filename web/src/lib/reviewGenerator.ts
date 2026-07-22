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

// 解析 LLM 输出为结构化评价
export function parseReviewResult(text: string): ParsedReview | null {
  if (!text) return null;
  // 尝试提取 JSON(可能包裹在 ```json ... ``` 中)
  let jsonStr = text.trim();
  const codeFenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeFenceMatch) {
    jsonStr = codeFenceMatch[1].trim();
  }
  // 找第一个 { 到最后一个 }
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      overallScore: Number(parsed.overallScore) || 0,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
      performance: parsed.performance || "",
      nextFocus: parsed.nextFocus || "",
    };
  } catch {
    return null;
  }
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
