// STAR 评估 + 6 维度能力雷达 + 表达能力 prompt 生成

// 评估维度常量:单一数据源,所有消费方复用,避免名称不一致
// 同时作为 i18n key 后缀:前端用 t(`report.dim.${key}`) 渲染本地化名称
//
// v2(ADR-002):每个维度增加行为锚点(Behaviorally Anchored Rating Scale)。
// 为什么:形容词量表的致命缺陷是——两个评分者打"4 分"时心里想的完全不是一回事。
// 给每个分值锚定一个具体、可观察的行为后,判断才有可对照的依据。
//
// 为什么只写两端(1 分与 5 分),不摊到 1/3/5:
//   Choi et al. 2025(*Journal of AI in Education*)的定量对照显示,
//   只锚两端时人机一致性 QWK = 0.59,优于把锚点摊到 1/3/6 档的 0.39。
//   且每档 1 个锚点 ≈ 每档 3 个(QWK 0.65),中间档用梯度插值即可。
//   ⚠️ 勿改回三档锚点,该错误已记录在 STATE.md「本轮教训」。
export const EVALUATION_DIMENSIONS = [
  {
    key: "technical", name: "技术深度",
    anchors: {
      1: "只背诵结论,无法解释为什么,被追问后转向复述定义",
      5: "能主动指出方案的技术前提和失效边界,讨论替代方案的成本权衡",
    },
  },
  {
    key: "communication", name: "沟通表达",
    anchors: {
      1: "长时间停留在症状描述,不给结论,被追问后组织语言困难",
      5: "能用非本领域听众听得懂的话解释复杂问题,并主动确认对方是否跟上",
    },
  },
  {
    key: "logic", name: "逻辑思维",
    anchors: {
      1: "结论先行但推导过程无法还原,被追问时改口",
      5: "结论与推导过程一致,能自己指出论证中的薄弱环节",
    },
  },
  {
    key: "problemSolving", name: "问题解决",
    anchors: {
      1: "描述问题多于解决问题,遇到追问转为讨论技术名词",
      5: "能拆解问题、说明取舍依据,并说明放弃了什么方案及原因",
    },
  },
  {
    key: "resilience", name: "抗压能力",
    anchors: {
      1: "被追问技术细节时回避或改变话题",
      5: "承认不知道的部分,明确说明会如何验证,并回到问题本身",
    },
  },
  {
    key: "culture", name: "文化匹配",
    anchors: {
      1: "只给口号式回答(如\"我很有责任心\"),无具体事例",
      5: "用具体事例说明如何在冲突中达成共识或让步",
    },
  },
] as const;

// ADR-003:分档 ID 用降序字母表。
//   量表用 0-5 而非 1-10/1-100 —— arXiv:2601.03444 实测人机 ICC:
//   0-5 为 0.853,0-100 为 0.840,0-10 为 0.805。
//   降序排列提升裁判准确率(arXiv:2506.22316);随机打乱会全面拉低。
export const ANCHOR_IDS = ["A", "B", "C", "D", "E"] as const;
export type AnchorId = (typeof ANCHOR_IDS)[number];

/** A..E → 5..1。非法输入返回 null,让调用方决定降级策略。 */
export function anchorIdToScore(id: string): number | null {
  const idx = ANCHOR_IDS.indexOf(id.trim().toUpperCase() as AnchorId);
  if (idx < 0) return null;
  return 5 - idx;
}

export const DIMENSION_NAME_LIST = EVALUATION_DIMENSIONS.map(d => d.name);

/** 评估维度的结构类型(供函数参数使用;数组本身为 as const 字面量类型) */
export interface EvaluationDimension {
  key: string;
  name: string;
  anchors: { 1: string; 5: string };
}

/**
 * 为**单个**维度生成评分标准块,注入 prompt 供裁判做锚点匹配。
 *
 * 关键约束(ADR-001):块内只含该维度的锚点。
 * 把多个维度塞进同一次调用会产生系统性 rubric 干扰
 * —— arXiv:2608.14684 实测 Qwen3-32B 联合评估仅 36% 样本级完全一致,
 * 且仅仅重排 rubric 顺序就能翻转判定。独立评分由 scoringEngine 负责。
 */
export function buildRubricBlock(dim: EvaluationDimension): string {
  return [
    `【${dim.name}】`,
    `A(5) = ${dim.anchors[5]}`,
    `B(4) = 接近 A,明显超过 E`,
    `C(3) = 介于 A 与 E 之间`,
    `D(2) = 接近 E,明显弱于 A`,
    `E(1) = ${dim.anchors[1]}`,
    `中间档按上述两端做梯度插值,不另设独立标准。`,
    `评分纪律:本维度不因回答长度得分;50 字的完整回答与 500 字的完整回答同分。`,
  ].join("\n");
}

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
