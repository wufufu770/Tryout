// STAR 评估 + 6 维度能力雷达 + 表达能力 prompt 生成

// 评估维度常量:单一数据源,所有消费方复用,避免名称不一致
// 同时作为 i18n key 后缀:前端用 t(`report.dim.${key}`) 渲染本地化名称
export const EVALUATION_DIMENSIONS = [
  { key: "technical", name: "技术深度" },
  { key: "communication", name: "沟通表达" },
  { key: "logic", name: "逻辑思维" },
  { key: "problemSolving", name: "问题解决" },
  { key: "resilience", name: "抗压能力" },
  { key: "culture", name: "文化匹配" },
] as const;

export const DIMENSION_NAME_LIST = EVALUATION_DIMENSIONS.map(d => d.name);

// 根据维度中文名查 key(用于 i18n 查找)
export function getDimensionKey(name: string): string | undefined {
  return EVALUATION_DIMENSIONS.find(d => d.name === name)?.key;
}

export function generateEvaluationPrompt(question: string, answer: string): string {
  // prompt 中明确要求 dimensionName 必须是这 6 个值之一,确保 LLM 输出可被下游匹配
  const dimList = DIMENSION_NAME_LIST.map(n => `"${n}"`).join("、");
  return `请分析以下用户回答,从 6 个维度进行评估,并基于 STAR 法则做行为分析。

用户问题: ${question}
用户回答: ${answer}

请严格输出以下 JSON 格式(不要输出其他内容,不要用 markdown 代码块包裹):
{
  "dimensions": [
    {"dimensionName": "技术深度", "score": 1-5, "comment": "对技术原理的理解深度"},
    {"dimensionName": "沟通表达", "score": 1-5, "comment": "表达清晰度与逻辑性"},
    {"dimensionName": "逻辑思维", "score": 1-5, "comment": "推理与问题拆解能力"},
    {"dimensionName": "问题解决", "score": 1-5, "comment": "解决方案的可行性与创新性"},
    {"dimensionName": "抗压能力", "score": 1-5, "comment": "面对追问/压力的应对"},
    {"dimensionName": "文化匹配", "score": 1-5, "comment": "价值观与团队契合度"}
  ],
  "starAnalysis": {
    "situation": {"present": true/false, "comment": "是否清晰描述了情境"},
    "task": {"present": true/false, "comment": "是否明确了任务目标"},
    "action": {"present": true/false, "comment": "行动步骤是否详实"},
    "result": {"present": true/false, "comment": "结果是否量化"}
  },
  "weaknesses": ["薄弱点1", "薄弱点2"],
  "overallScore": 7.5,
  "report": "整体评价...",
  "improvementAdvice": "具体改进建议...",
  "betterAnswerSample": "优化后的回答示例..."
}

重要:dimensions 数组的 dimensionName 必须严格使用以下值之一:${dimList}。不得变体(如"沟通能力""文化契合")。`;
}

export interface EvaluationResult {
  dimensions: { dimensionName: string; score: number; comment: string }[];
  starAnalysis?: {
    situation: { present: boolean; comment: string };
    task: { present: boolean; comment: string };
    action: { present: boolean; comment: string };
    result: { present: boolean; comment: string };
  };
  weaknesses?: string[];
  overallScore: number;
  report: string;
  improvementAdvice: string;
  betterAnswerSample: string;
}

export function parseEvaluationResult(content: string): EvaluationResult | null {
  let jsonStr = content.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    // 结构校验:防止 LLM 返回异常 JSON 导致下游崩溃
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.dimensions)) return null;
    for (const d of parsed.dimensions) {
      if (typeof d.dimensionName !== "string" || typeof d.score !== "number") return null;
    }
    return parsed as EvaluationResult;
  } catch {
    return null;
  }
}

// 同岗位平均水平基准(内置,非用户数据)
export const PEER_BENCHMARK = EVALUATION_DIMENSIONS.map(d => ({
  dimensionName: d.name,
  score: 3.5,
}));
