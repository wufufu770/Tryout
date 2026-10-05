// 参考答案适配 —— 在评估链路上裁剪过长的参考答案
//
// 背景(V7 抽样发现):808 题中 **226 题(28%)的参考答案超过 500 字符**,
// 集中在 coding 题(126 条,因为塞了完整代码实现),最长 1818 字符。
// 这在评估时是有害的:A1 的评估 prompt 要同时装 问题 + 回答 + 参考答案 + 锚点,
// 参考答案是最占地方的部分之一,过长会挤压其他内容并推高 token 成本。
//
// 为什么不在生成题库时直接删内容:
//   题库内容本身没有错 —— 完整代码对**人**是有价值的学习材料,
//   站内浏览也仍然展示全文。问题只在于**评估时**不需要那么长。
//   所以裁剪只发生在评估链路,不动原始资产。
//
// 裁剪策略:按句子边界保留前 N 字符,而不是硬切。
// 硬切会把代码/句子劈成两半,模型看到半句代码会做出错误推断。

const DEFAULT_MAX = 500;

export interface AdaptResult {
  text: string;
  truncated: boolean;
  originalLength: number;
}

/** 在最近的句读边界处截断,避免劈开半句 */
function cutAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  // 中文句读直接按字符找
  for (const m of ["。", "！", "？", "\n"]) {
    const i = slice.lastIndexOf(m);
    // 必须切在标点**之后**,否则句末标点会被丢掉
    if (i > max * 0.5) return slice.slice(0, i + 1).trimEnd();
  }
  /*
   * 英文句号判定:只看**后面**。
   *   - 后面是空格/行尾/引号 → 正常句末("here. Next")
   *   - 后面是字母/数字 → 小数(0.75)、域名、版本号
   * 前面不需要判断:英文句号本来就跟在一个词之后("e" + "."),
   * 拿"前面是词字符"当排除条件会把所有正常句号都排除掉。
   */
  for (let i = Math.min(slice.length, max) - 1; i > max * 0.5; i--) {
    if (slice[i] !== ".") continue;
    const next = slice[i + 1] ?? " ";     // 末尾视作空格
    if (/[A-Za-z0-9]/.test(next)) continue;
    return slice.slice(0, i + 1).trimEnd();
  }
  return slice.trimEnd();
}

/**
 * 为评估裁剪参考答案。
 * @param ref   原始参考答案
 * @param kind  题型;coding 类允许更短(代码本身自解释,判分靠锚点)
 * @param max   最大字符数
 */
export function adaptReference(
  ref: string | null | undefined,
  kind?: string,
  max: number = DEFAULT_MAX
): AdaptResult {
  const src = ref || "";
  if (!src) return { text: "", truncated: false, originalLength: 0 };

  /*
   * 上限解析顺序:**显式 max 优先**,未显式给时才用题型默认值。
   * (早先写成 min(max, 300),导致调用方传 800 仍被卡到 300 —— 显式参数形同虚设)
   */
  let limit = max;
  if (max === DEFAULT_MAX && kind === "coding") {
    // coding 题的参考答案多为完整实现,评估时只需判分要点
    limit = 300;
  }
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_MAX;

  if (src.length <= limit) {
    return { text: src, truncated: false, originalLength: src.length };
  }
  const cut = cutAtBoundary(src, limit);
  return {
    text: `${cut}\n…(参考答案较长,已裁剪;完整内容见题库)`,
    truncated: true,
    originalLength: src.length,
  };
}

/**
 * 从参考答案里抽取"判分要点"——用于给锚点补充具体技术锚。
 * 取包含数字/阈值/专有名词的句子,这些通常是判分关键。
 */
export function extractScoringHints(ref: string | null | undefined, maxHints = 5): string[] {
  const src = ref || "";
  if (!src) return [];
  const sentences = src
    .split(/[。；;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 80);
  const scored = sentences
    .map((s) => {
      // 含数字、阈值或代码标识符的句子更可能是判分要点
      let w = 0;
      if (/\d/.test(s)) w += 2;
      if (/[>=<]|阈值|因子|倍|以上|以下/.test(s)) w += 2;
      if (/[A-Z][a-zA-Z]*\(|::|\.[a-z]+\(/.test(s)) w += 1;
      return { s, w };
    })
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w);
  const out: string[] = [];
  for (const x of scored) {
    if (out.length >= maxHints) break;
    if (!out.includes(x.s)) out.push(x.s);
  }
  return out;
}
