// PII 脱敏与还原:抽取到独立文件,避免 db.js 与 llm.js 之间的循环依赖
// v2:增强手机号正则(支持 +86、空格、连字符等变形),并新增 restorePii 反向替换
// v10:占位符随机化(不可预测 token),防止攻击者注入可预测占位符触发 restorePii 还原他人 PII
//
// 安全背景:旧版占位符 [PHONE_1] 可预测,攻击者可在自己消息中放入 [PHONE_1],
// 当 LLM 在回复中复用该占位符时,restorePii 会用"上一个用户的 PII"替换,
// 导致 PII 泄露给攻击者。随机占位符使攻击者无法预知占位符形态,从而无法构造攻击。

import crypto from "crypto";

const PII_PATTERNS = [
  // 边界锚定 (?<!\d) ... (?!\d) 防止从身份证号等长数字串中间误匹配手机号
  { type: "phone", regex: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/g },
  { type: "email", regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { type: "idcard", regex: /(?<!\d)\d{17}[\dXx](?!\d)/g },
];

// v10:生成不可预测的占位符 token(8 位 hex),每次调用都不同
function genPlaceholder(type) {
  const suffix = crypto.randomBytes(4).toString("hex"); // 8 hex chars
  return `[${type.toUpperCase()}_${suffix}]`;
}

export function redactPii(text) {
  let result = text;
  const matches = [];
  for (const { type, regex } of PII_PATTERNS) {
    result = result.replace(regex, (m) => {
      const placeholder = genPlaceholder(type);
      matches.push({ type, value: m, placeholder });
      return placeholder;
    });
  }
  return { redacted: result, matches };
}

export function restorePii(text, matches) {
  let result = text;
  // 逆序替换(保持与旧版行为一致,虽然随机占位符已唯一)
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    // v10:优先用 matches 中存储的 placeholder(随机);兼容旧格式 [TYPE_i+1]
    const placeholder = m.placeholder || `[${m.type.toUpperCase()}_${i + 1}]`;
    result = result.split(placeholder).join(m.value);
  }
  return result;
}
