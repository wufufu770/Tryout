// expressionScorer:表达能力评分
// 从第一原理:表达能力 = 语速 + 填充词频率 + 句子结构 + 逻辑连接词
// 纯文本分析,零依赖,无需 LLM

export interface ExpressionMetrics {
  /** 语速:字/分钟(中文按字,英文按词) */
  speakingSpeed: number;
  /** 语速评级:slow/normal/fast */
  speedLevel: "slow" | "normal" | "fast";
  /** 填充词出现次数 */
  fillerCount: number;
  /** 填充词频率:次/百字 */
  fillerFrequency: number;
  /** 平均句长(字/句) */
  avgSentenceLength: number;
  /** 句子数量 */
  sentenceCount: number;
  /** 逻辑连接词数量 */
  connectorCount: number;
  /** 综合表达能力评分(0-100) */
  expressionScore: number;
  /** 评分维度细分 */
  breakdown: {
    fluency: number;      // 流畅度(填充词越少越高)
    pace: number;         // 语速适宜度
    structure: number;    // 句子结构(句长适宜 + 多样性)
    logic: number;        // 逻辑性(连接词)
  };
}

// 中英文填充词
const FILLER_WORDS = [
  // 中文
  "嗯", "啊", "呃", "那个", "这个", "就是", "然后", "其实", "我觉得",
  // 英文
  "um", "uh", "like", "you know", "i mean", "actually", "basically", "literally", "sort of", "kind of",
];

// 逻辑连接词
const CONNECTORS = [
  // 中文
  "首先", "其次", "最后", "因此", "所以", "因为", "由于", "然而", "但是", "不过", "另外", "此外", "综上", "总之", "也就是说", "换句话说",
  // 英文
  "first", "second", "finally", "therefore", "so", "because", "however", "but", "moreover", "furthermore", "in conclusion", "in summary", "additionally",
];

// 句子分隔符
const SENTENCE_DELIMITERS = /[。！？.!?;；\n]+/;

/**
 * 计算表达能力指标
 * @param text 用户回答文本
 * @param durationSeconds 说话时长(秒),用于精确计算语速;无则按字数估算
 */
export function scoreExpression(text: string, durationSeconds?: number): ExpressionMetrics {
  const trimmed = (text || "").trim();
  const charCount = trimmed.length;

  // 句子分割
  const sentences = trimmed.split(SENTENCE_DELIMITERS).filter((s) => s.trim().length > 0);
  const sentenceCount = Math.max(1, sentences.length);
  const avgSentenceLength = charCount / sentenceCount;

  // 填充词统计
  const lowerText = trimmed.toLowerCase();
  let fillerCount = 0;
  for (const w of FILLER_WORDS) {
    const matches = lowerText.split(w.toLowerCase()).length - 1;
    fillerCount += Math.max(0, matches);
  }
  const fillerFrequency = charCount > 0 ? (fillerCount / charCount) * 100 : 0;

  // 连接词统计
  let connectorCount = 0;
  for (const c of CONNECTORS) {
    const matches = lowerText.split(c.toLowerCase()).length - 1;
    connectorCount += Math.max(0, matches);
  }

  // 语速:中文按字,英文按词(粗略:空格少则按字,空格多则按词)
  const wordCount = lowerText.includes(" ") && (lowerText.split(" ").length - 1) > charCount * 0.1
    ? lowerText.split(/\s+/).filter(Boolean).length
    : charCount;
  const durationMin = durationSeconds ? durationSeconds / 60 : (charCount / 200); // 默认 200 字/分钟
  const speakingSpeed = durationMin > 0 ? Math.round(wordCount / durationMin) : 0;

  // 语速评级(中文 150-250 字/分为正常)
  let speedLevel: "slow" | "normal" | "fast" = "normal";
  if (speakingSpeed > 0 && speakingSpeed < 120) speedLevel = "slow";
  else if (speakingSpeed > 300) speedLevel = "fast";

  // 各维度评分(0-100)
  // 流畅度:填充词频率越低越高(0次/百字=100,5次/百字=0)
  const fluency = Math.max(0, Math.min(100, 100 - fillerFrequency * 20));

  // 语速适宜度:120-250 为最佳(100),偏离递减
  let pace = 100;
  if (speakingSpeed > 0) {
    if (speakingSpeed < 120) pace = Math.max(0, (speakingSpeed / 120) * 100);
    else if (speakingSpeed > 250) pace = Math.max(0, 100 - (speakingSpeed - 250) * 0.5);
  }

  // 句子结构:8-25 字/句为最佳,过短过长扣分
  let structure = 100;
  if (avgSentenceLength < 5) structure = 40;
  else if (avgSentenceLength < 8) structure = 70;
  else if (avgSentenceLength > 40) structure = 60;
  else if (avgSentenceLength > 25) structure = 80;

  // 逻辑性:每 50 字 1 个连接词为最佳
  const expectedConnectors = Math.max(1, charCount / 50);
  const logic = Math.max(0, Math.min(100, (connectorCount / expectedConnectors) * 100));

  // 综合:加权平均
  const expressionScore = Math.round(
    fluency * 0.3 + pace * 0.2 + structure * 0.25 + logic * 0.25,
  );

  return {
    speakingSpeed,
    speedLevel,
    fillerCount,
    fillerFrequency: Math.round(fillerFrequency * 10) / 10,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    sentenceCount,
    connectorCount,
    expressionScore,
    breakdown: {
      fluency: Math.round(fluency),
      pace: Math.round(pace),
      structure: Math.round(structure),
      logic: Math.round(logic),
    },
  };
}
