// Crypto 加解密测试(AES-256-GCM)
import test from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, isEncrypted } from "../crypto.js";

test("加密后含 ENC:: 前缀", () => {
  const enc = encryptSecret("sk-openai-xxxxxx");
  assert.ok(enc);
  assert.ok(enc.startsWith("ENC::"));
  assert.ok(isEncrypted(enc));
});

test("加密后内容不含明文", () => {
  const plain = "sk-super-secret-key-12345";
  const enc = encryptSecret(plain);
  assert.ok(!enc.includes(plain));
  assert.ok(!enc.slice(5).includes(plain)); // 去掉前缀后也不含
});

test("解密还原原文", () => {
  const plain = "my-api-key-12345";
  const enc = encryptSecret(plain);
  const dec = decryptSecret(enc);
  assert.equal(dec, plain);
});

test("明文(无前缀)解密原样返回(向后兼容)", () => {
  const plain = "sk-legacy-plain-key";
  const dec = decryptSecret(plain);
  assert.equal(dec, plain);
});

test("空值处理", () => {
  assert.equal(encryptSecret(null), null);
  assert.equal(encryptSecret(""), null);
  assert.equal(encryptSecret(undefined), null);
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(""), "");
});

test("重复加密产生不同密文(IV 随机)", () => {
  const plain = "same-key";
  const enc1 = encryptSecret(plain);
  const enc2 = encryptSecret(plain);
  assert.notEqual(enc1, enc2, "相同明文加密后应得到不同密文(随机 IV)");
  // 但都能解回原文
  assert.equal(decryptSecret(enc1), plain);
  assert.equal(decryptSecret(enc2), plain);
});

test("已加密数据不会重复加密", () => {
  const plain = "sk-test";
  const enc1 = encryptSecret(plain);
  const enc2 = encryptSecret(enc1);
  assert.equal(enc1, enc2, "已加密数据应原样返回,避免双重加密");
});

test("篡改密文后解密失败(返回 null)", () => {
  const enc = encryptSecret("sk-test");
  // 篡改:替换密文中部字符(确保 base64 解码后字节序列改变)
  // 注:仅追加末尾字符会被 base64 解析器忽略,无法触发 GCM 校验失败
  const base64Part = enc.slice(5); // 去除 ENC:: 前缀
  const mid = Math.floor(base64Part.length / 2);
  const replaced = base64Part[mid] === "A" ? "B" : "A";
  const tampered = "ENC::" + base64Part.slice(0, mid) + replaced + base64Part.slice(mid + 1);
  const dec = decryptSecret(tampered);
  // GCM 认证标签校验失败,应返回 null
  assert.equal(dec, null);
});

test("非字符串输入转换为字符串", () => {
  const enc = encryptSecret(12345);
  assert.ok(enc.startsWith("ENC::"));
  assert.equal(decryptSecret(enc), "12345");
});

test("长文本加解密(模拟真实 API Key)", () => {
  const long = "sk-" + "a".repeat(500);
  const enc = encryptSecret(long);
  assert.equal(decryptSecret(enc), long);
});

test("中文内容加解密", () => {
  const text = "这是密钥的内容-中文测试";
  const enc = encryptSecret(text);
  assert.equal(decryptSecret(enc), text);
});
