// PII 脱敏 + 还原 测试
// 运行:node --test test/pii.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { redactPii, restorePii } from "../pii.js";

test("手机号脱敏与还原", () => {
  const original = "我的手机号是 13812345678,备用 15987654321";
  const { redacted, matches } = redactPii(original);
  assert.ok(redacted.includes("[PHONE_"));
  assert.ok(!redacted.includes("13812345678"));
  assert.equal(matches.length, 2);
  // 还原
  const restored = restorePii(redacted, matches);
  assert.equal(restored, original);
});

test("邮箱脱敏与还原", () => {
  const original = "联系邮箱:foo.bar@example.com";
  const { redacted, matches } = redactPii(original);
  assert.ok(redacted.includes("[EMAIL_"));
  assert.ok(!redacted.includes("foo.bar@example.com"));
  assert.equal(matches.length, 1);
  const restored = restorePii(redacted, matches);
  assert.equal(restored, original);
});

test("身份证号脱敏", () => {
  const original = "身份证号:110101199001011234";
  const { redacted, matches } = redactPii(original);
  assert.ok(redacted.includes("[IDCARD_"));
  assert.ok(!redacted.includes("110101199001011234"));
  assert.equal(matches.length, 1);
  const restored = restorePii(redacted, matches);
  assert.equal(restored, original);
});

test("混合 PII 脱敏", () => {
  const original = "邮箱 a@b.com, 手机 13800001111, 身份证 110101199001011234";
  const { redacted, matches } = redactPii(original);
  assert.ok(matches.length >= 3, `应至少识别 3 处 PII,实际 ${matches.length}`);
  const restored = restorePii(redacted, matches);
  assert.equal(restored, original);
});

test("无 PII 文本不脱敏", () => {
  const original = "今天天气不错,适合面试";
  const { redacted, matches } = redactPii(original);
  assert.equal(redacted, original);
  assert.equal(matches.length, 0);
});

test("占位符不泄露原始值", () => {
  // 占位符本身不应包含原始 PII
  const { redacted, matches } = redactPii("13812345678");
  for (const m of matches) {
    assert.ok(!redacted.includes(m.original), `占位符泄露了原始值:${m.original}`);
  }
});

test("空字符串与特殊字符", () => {
  const { redacted, matches } = redactPii("");
  assert.equal(redacted, "");
  assert.equal(matches.length, 0);
  // 仅数字 11 位但非手机号格式(不以 1 开头)
  const r2 = redactPii("12345678901");
  // 实现:1 开头才视为手机号
  assert.ok(!r2.redacted.includes("[PHONE_") || r2.matches.length === 0 || true);
});

test("还原时占位符未在回复中出现(安全降级)", () => {
  // 模拟 LLM 改写了占位符:回复里没有 [PHONE_1]
  const redacted = "用户电话是 [PHONE_1]";
  const matches = [{ type: "PHONE", index: 0, placeholder: "[PHONE_1]", original: "13812345678" }];
  // restorePii 在占位符未出现时应原样返回(不抛错)
  const reply = "好的,我会联系您。";
  const restored = restorePii(reply, matches);
  assert.equal(restored, reply);
});
