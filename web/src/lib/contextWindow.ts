// 上下文窗口治理 —— 纯函数
//
// 背景(W4-4):三处路径的长度约束互相矛盾——
//   predict-questions 端点:简历 20000 / JD 10000 字符
//   主链路 injectMaterials:无上限,简历 + JD 全文直拼
//   历史消息:无窗口,全量传
// 后果:长简历撑爆 context、稀释模型对关键信息的注意力、token 成本失控。
//
// 三条设计取舍(都有理由,不是随手):
//   1. **按行截断,不按字符硬切** —— 硬切会把词/字段劈成两半,
//      模型看到半句话会做出错误推断。宁可少给,不要给错。
//   2. **显式声明被截断** —— 不声明的话,模型会以为看到的是全文,
//      基于不完整信息下判断还不自知。这比给得少更危险。
//   3. **system 消息不占窗口配额** —— 它们承载角色设定,丢了面试就变形。

/** 各类资料的默认字符上限 */
export const DEFAULT_LIMITS = {
  material: 6000,   // 单份资料(简历/JD/补充)
  total: 14000,     // 所有资料合计
  historyChars: 12000, // 历史消息窗口的字符预算
};

export interface TruncateResult {
  text: string;
  truncated: boolean;
  /** 被省略的字符数 */
  omitted: number;
}

/**
 * 按行截断材料。
 * 截断点落在换行处,保证不会把一行劈成两半。
 */
export function truncateMaterial(content: string, max = DEFAULT_LIMITS.material): TruncateResult {
  const src = content || "";
  if (src.length <= max) {
    return { text: src, truncated: false, omitted: 0 };
  }
  const lines = src.split("\n");
  const kept: string[] = [];
  let len = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const add = l.length + (kept.length > 0 ? 1 : 0);
    if (len + add > max) break;
    kept.push(l);
    len += add;
  }
  // 极端情况:连第一行都放不下 → 硬切第一行(总比什么都不给强)
  if (kept.length === 0) {
    return {
      text: `${src.slice(0, Math.max(0, max - 20))}…(已截断,共 ${src.length} 字符)`,
      truncated: true,
      omitted: src.length,
    };
  }
  const omitted = src.length - len;
  return {
    text: `${kept.join("\n")}\n…(内容较长,已省略 ${omitted} 字符;完整内容见资料中心)`,
    truncated: true,
    omitted,
  };
}

/**
 * 估算 token 占用。
 * 中文约 1 字 ≈ 1 token,英文约 1 字符 ≈ 0.25 token。
 * 这是粗估,用于**预算前置检查**,不是精确计费。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x303f) ||
        (c >= 0xff00 && c <= 0xffef)) cjk++;
  }
  const other = text.length - cjk;
  // ⚠️ 不要对整体 ceil:"中"→1、"a"→1,分辨率全丢,粗估就失去意义。
  // 改为保留一位小数,只做预算判断不需要整数精度。
  const est = cjk * 1.0 + other * 0.25;
  return Math.round(est * 10) / 10;
}

export interface ChatMsg { role: "user" | "assistant" | "system"; content: string; [k: string]: unknown }

export interface ContextWindowResult<T extends ChatMsg = ChatMsg> {
  /** 实际发送的消息(system 消息恒在) */
  recent: T[];
  /** 被移出窗口的消息条数 */
  summarizedCount: number;
  /** 旧消息的提炼摘要(由调用方用 LLM 填充,此处只给占位) */
  summary: string | null;
  /** 预计 token 占用 */
  estimatedTokens: number;
}

/**
 * 构建历史消息窗口。
 *
 * @param keepRecent 保留最近多少条**非 system** 消息
 * @param maxChars   字符预算;超出时继续向更早裁剪
 */
export function buildContextWindow<T extends ChatMsg>(
  messages: T[],
  opts: { keepRecent?: number; maxChars?: number; summary?: string | null } = {}
): ContextWindowResult<T> {
  const keepRecent = Math.max(1, opts.keepRecent ?? 12);
  const maxChars = opts.maxChars ?? DEFAULT_LIMITS.historyChars;
  const list = Array.isArray(messages) ? messages : [];

  const systems = list.filter((m) => m.role === "system");
  const others = list.filter((m) => m.role !== "system");

  // 1) 先按条数取最近 N 条
  let kept = others.slice(-keepRecent);
  let summarizedCount = others.length - kept.length;

  // 2) 再按字符预算收紧(逐条从最旧的开始丢,直到预算内)
  const budget = (arr: T[]): number =>
    arr.reduce((a, m) => a + (m.content || "").length, 0);
  while (kept.length > 1 && budget(kept) > maxChars) {
    kept.shift();
    summarizedCount++;
  }

  const recent = [...systems, ...kept] as T[];
  return {
    recent,
    summarizedCount,
    summary: opts.summary ?? null,
    estimatedTokens: estimateTokens(recent.map((m) => m.content || "").join("\n")),
  };
}
