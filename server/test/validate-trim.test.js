// 单元测试:字符串 schema 必须**先 trim 再校验**(守卫 ISSUE-045)
//
// ## 缺陷
// `StringSchema._parse` 原先的顺序是「按**原值**判 min/max/pattern/url/enum
// → 全部通过后才 trim」。于是纯空白串能同时骗过两层:
//
//   ProviderSchema.parse({ name: "   ", baseUrl: "https://x.com" })
//     → ok = true, value.name === ""
//
// 因为 `"   ".length === 3 >= min(1)` 先过了,trim 之后才变成空串被**原样返回**。
//
// ## 为什么这是 P1
// 中招的是全项目 8 个必填字段:
//   ProviderSchema.name / baseUrl、AgentSchema.name / promptTemplate、
//   SessionSchema.title、MessageSchema.content、
//   EvaluationSchema.report、MaterialSchema.rawText
// 其中 **`promptTemplate` 最严重**:空的 prompt 模板让 LLM 完全自由发挥,
// 产出不可控,而从请求到入库**没有任何一处报错**。
//
// 空白形态不止半角空格:全角空格 \u3000 与 NBSP \u00A0 同样会被 trim 掉,
// 所以只测 `" "` 会漏掉一半的攻击面。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderSchema, AgentSchema, s } from "../validate.js";

test("纯空白不得绕过 min(1)", () => {
  for (const [label, blank] of [
    ["半角空格", "   "],
    ["单个空格", " "],
    ["制表符", "\t\t"],
    ["换行", "\n"],
    ["全角空格", "\u3000\u3000"],
    ["NBSP", "\u00A0"],
    ["混合", " \u3000\u00A0\t "],
  ]) {
    const r = ProviderSchema.safeParse({ name: blank, baseUrl: "https://x.com" });
    assert.equal(r.ok, false, `name=${JSON.stringify(blank)}(${label})竟被接受`);
    assert.ok(r.issues.some((i) => i.path === "name"), `${label} 的报错应指向 name`);
  }
});

test("baseUrl 的纯空白同样必须被拒", () => {
  for (const blank of ["   ", "\u3000", "\u00A0"]) {
    const r = ProviderSchema.safeParse({ name: "x", baseUrl: blank });
    assert.equal(r.ok, false, `baseUrl=${JSON.stringify(blank)} 竟被接受`);
  }
});

test("trim 行为本身不能被这次修复破坏", () => {
  const r = ProviderSchema.parse({ name: "  OpenAI  ", baseUrl: "  https://x.com  " });
  assert.equal(r.name, "OpenAI", "首尾空白仍应被去掉");
  assert.equal(r.baseUrl, "https://x.com");
});

test("非空白输入不受影响", () => {
  assert.equal(ProviderSchema.safeParse({ name: "OpenAI", baseUrl: "https://x.com" }).ok, true);
  assert.equal(ProviderSchema.safeParse({ name: "中 通 讯", baseUrl: "https://x.com" }).ok, true,
    "字符串**内部**的空格是合法的,不能一起 trim 掉");
});

test("min 判定基于 trim 后的长度(不是原值长度)", () => {
  // min(3):原始 "  a  " 长度 5 ≥ 3 → 旧实现通过;trim 后 "a" 长度 1 < 3 → 应拒
  const s3 = s.string().min(3, "太短");
  assert.equal(s3.safeParse("  a  ").ok, false, "trim 后不足 3 字符却通过了");
  assert.equal(s3.safeParse("  abc  ").ok, true);
  assert.equal(s3.safeParse("abc").ok, true);
});

test("max 判定同样基于 trim 后的长度", () => {
  const s5 = s.string().max(5, "太长");
  assert.equal(s5.safeParse("  abc  ").ok, true, "trim 后 3 字符应通过");
  assert.equal(s5.safeParse("  abcdefgh  ").ok, false);
});

test("enum 匹配 trim 后的值(与「本来就要 trim」保持一致)", () => {
  // 旧实现:按原值比对 enum," openai " 匹配不上 → 报错
  // 新实现:先 trim," openai " → "openai" → 匹配成功
  const se = s.string().oneOf(["openai", "anthropic"]);
  assert.equal(se.safeParse(" openai ").ok, true, "带空白的合法枚举值应被接受");
  assert.equal(se.safeParse("  bogus  ").ok, false);
});

test("AgentSchema.promptTemplate 纯空白必须被拒(空模板会让 LLM 自由发挥)", () => {
  const base = { name: "面试官", role: "tech" };   // role 是 enum,不是自由文本
  assert.equal(AgentSchema.safeParse({ ...base, promptTemplate: "   " }).ok, false);
  assert.equal(AgentSchema.safeParse({ ...base, promptTemplate: "\u3000" }).ok, false);
  assert.equal(AgentSchema.safeParse({ ...base, promptTemplate: "请评估…" }).ok, true);
});
