// PII 占位符前端还原
//
// 背景:后端在调用 LLM 前对消息做 PII 脱敏(手机号/邮箱/身份证 → [PHONE_xxxxxxxx]),
// 以防敏感信息经过第三方模型。但流式响应无法回填(内容已逐块写出),
// 因此面试主链路(流式)下用户看到的是占位符而非真实值。
//
// 设计选择:由前端持有一份"占位符 → 真实值"映射,渲染时还原。
//   - 不牺牲流式体验(流式中途回填在物理上不可行)
//   - 映射只存在于当前会话内存,不落库、不外传
//   - 后端仍然不会把明文 PII 写进 SSE 的 delta 之外的地方
//
// 注意:这份映射包含明文 PII,只能在浏览器内存中短暂存在,
//      不得写入 localStorage / sessionStorage / 任何日志。

export const PII_PLACEHOLDER_RE = /\[(PHONE|EMAIL|IDCARD)_([0-9A-Fa-f]{8})\]/g;

export type PiiType = "PHONE" | "EMAIL" | "IDCARD";

export interface PiiMapping {
  /** 占位符全文,例如 [PHONE_A1B2C3D4] */
  placeholder: string;
  /** 原始明文 */
  value: string;
  type: PiiType;
}

/** 从任意文本中提取占位符及类型(不还原,仅识别) */
export function findPlaceholders(text: string): { placeholder: string; type: PiiType }[] {
  const out: { placeholder: string; type: PiiType }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(PII_PLACEHOLDER_RE)) {
    const placeholder = m[0];
    if (seen.has(placeholder)) continue;
    seen.add(placeholder);
    out.push({ placeholder, type: m[1].toUpperCase() as PiiType });
  }
  return out;
}

/**
 * 在文本中建立占位符 → 明文 的还原函数
 * @param text 原始文本(可能含占位符)
 * @param mapping 已知的映射表(可来自后端下发的 pii_mapping)
 * @returns 一个替换函数
 */
export function makeRestorer(mapping: PiiMapping[]) {
  const map = new Map(mapping.map((m) => [m.placeholder, m.value]));
  return (text: string): string => {
    if (map.size === 0) return text;
    return text.replace(PII_PLACEHOLDER_RE, (whole) => map.get(whole) ?? whole);
  };
}

/** 类型对应的展示标签(用于 UI 提示,与 i18n key 对齐) */
export function piiDisplayHint(type: PiiType): string {
  switch (type) {
    case "PHONE": return "手机号";
    case "EMAIL": return "邮箱";
    case "IDCARD": return "身份证号";
  }
}
