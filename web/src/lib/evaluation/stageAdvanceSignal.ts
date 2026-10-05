// 阶段信号解析 —— 纯函数
//
// 面试官回复末尾可能带一个轻量信号,告诉前端"这个方向问够了,换下一个"。
// 为什么是"可能":LLM 不总是配合输出,而且我们**不强制要求它输出**
// ——信号缺失时退回轮数覆盖规则,行为依然可预期。
//
// 关键防护:必须**忽略 think 块内的内容**。
// 模型常在 <think> 里规划"我应该标记 [STAGE_STATUS:advance]",
// 若不剥离,会把推理草稿当成最终决定。

export interface StageSignal {
  /** true = 建议换方向;false = 建议继续深挖 */
  advance: boolean;
  /** 本阶段已覆盖的考察方向 */
  covered: string[];
  /** 尚未覆盖的考察方向 */
  uncovered: string[];
}

const STATUS_RE = /\[STAGE_STATUS:\s*(continue|advance)\s*\]/gi;
const COVERAGE_RE = /\[COVERAGE:\s*([^\]]*)\]/gi;

const VALID = new Set(["continue", "advance"]);

/** 去掉 think/思考块,避免把推理草稿当信号 */
export function stripThinkBlocks(text: string): string {
  return (text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    // 未闭合的尾部 think:不能用 ^...$ 锚定(多行模式下只匹配单行),
    // 必须无锚点匹配到末尾
    .replace(/<think>[\s\S]*/i, "");
}

export function parseStageSignal(raw: string): StageSignal | null {
  const text = stripThinkBlocks(raw);
  if (!text) return null;

  // 状态:后者覆盖前者(模型偶尔会输出两次)
  let advance: boolean | null = null;
  for (const m of text.matchAll(STATUS_RE)) {
    const v = m[1].toLowerCase();
    if (!VALID.has(v)) return null;      // 格式损坏 → 当作无信号
    advance = v === "advance";
  }

  // 覆盖方向
  let covered: string[] = [];
  let uncovered: string[] = [];
  // ⚠️ 不要用带 g 标志的正则调 .match() 取捕获组 —— 全局匹配下
  //    String.match 不保证返回捕获组(m[1] 可能是 undefined)。
  const covRe = /\[COVERAGE:\s*([^\]]*)\]/i;
  const cov = covRe.exec(text);
  if (cov && cov[1]) {
    const parse = (s: string) =>
      s.split(/[、,，|]/).map((x) => x.trim()).filter(Boolean);
    const m2 = /已问\s*([^|]*)/.exec(cov[1]);
    const m3 = /未问\s*(.*)$/.exec(cov[1]);
    if (m2) covered = parse(m2[1]);
    if (m3) uncovered = parse(m3[1]);
  }

  if (advance === null && covered.length === 0 && uncovered.length === 0) {
    return null;    // 什么都没解析出来
  }
  return { advance: advance ?? false, covered, uncovered };
}

/**
 * 从展示用文本中剥离阶段信号与 think 块。
 *
 * ⚠️ 必须在**渲染给用户之前**调用 —— 否则界面上会出现
 * "[STAGE_STATUS:advance]" 这类程序标记,把干净的面试回复弄脏。
 *
 * 面试官回复入库时也应存剥离后的版本,否则历史回看同样会看到标记。
 */
export function stripStageMarkers(text: string): string {
  return (text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*/i, "")
    .replace(/\n?\[STAGE_STATUS:\s*[a-z]+\s*\]/gi, "")
    .replace(/\n?\[COVERAGE:[^\]]*\]/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
