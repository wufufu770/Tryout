// brief() 的单元测试(R56)
//
// 关键用例就是 R52 踩到的那个:
//   JSON.stringify(undefined) 返回 **undefined 而不是字符串**,`.slice` 直接崩。
import { test } from "node:test";
import assert from "node:assert/strict";
import { brief } from "../scripts/lib/brief.mjs";

test("brief(undefined) 不崩(R52 的真实踩点)", () => {
  // 旧写法在这一行会抛 TypeError
  assert.doesNotThrow(() => brief(undefined, 120));
  assert.equal(typeof brief(undefined, 120), "string");
});

test("brief(null) / brief(无参) 不崩", () => {
  assert.doesNotThrow(() => brief(null));
  assert.doesNotThrow(() => brief());
});

test("brief(对象/数组) 正常序列化并截断", () => {
  assert.equal(brief({ a: 1 }, 120), '{"a":1}');
  const long = brief({ a: "x".repeat(500) }, 50);
  assert.ok(long.length <= 51, `应被截断到 50 字(+省略号),实得 ${long.length}`);
  assert.ok(long.endsWith("…"));
});

test("brief(字符串) 必须与 JSON.stringify 行为一致,不得省掉引号", () => {
  // ⚠️ R56 自审:第一版 brief 对字符串直接返回原文,于是
  //   brief("hello") === "hello"   而被替换的代码给的是 '"hello"'
  //   brief("")      === ""(空!)   而被替换的代码给的是 '""'
  // 我当时还把 "hello"（不带引号）写成了测试期望 —— **测试锁定了错误实现**。
  // ⇒ 替换必须是纯粹的健壮性加固:输出格式与原代码**逐字一致**,只把"崩"换成"不崩"。
  assert.equal(brief("hello", 120), '"hello"');
  assert.equal(brief("", 120), '""',
    "空串必须与 undefined/null 可区分 —— e2e 诊断恰恰要靠这个区分");
});

test("brief(空串/空值) 三者互不相等 —— 诊断不能把'空'和'无'混为一谈", () => {
  const vals = [brief("", 50), brief(undefined, 50), brief(null, 50)];
  assert.equal(new Set(vals).size, 3, `三值应互不相同,实得 ${JSON.stringify(vals)}`);
  assert.notEqual(brief("", 50), "", "brief('') 不得返回空串(那是'没有信息')");
});

test("brief(循环引用) 不崩 —— stringify 抛错也不能连诊断都失败", () => {
  const a = {}; a.self = a;
  assert.doesNotThrow(() => brief(a, 120));
  assert.equal(typeof brief(a, 120), "string");
});

test("brief 不修改入参", () => {
  const o = { a: 1 };
  brief(o, 10);
  assert.deepEqual(o, { a: 1 });
});
