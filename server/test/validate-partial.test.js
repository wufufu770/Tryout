// 单元测试:自研 schema 校验层的 `.partial()` 语义(守卫 ISSUE-040 / ISSUE-041)
//
// ## 背景
// 本项目**没有用 Zod** —— `server/validate.js` 是自研的"仿 Zod"零依赖实现,
// 头注释写着「支持 partial()/pick()/omit()(更新场景用)」。
// 这个"更新场景专用"的能力有三个调用点:
//   index.js:457  ProviderSchema.partial()          PUT /api/providers/:id
//   index.js:499  AgentSchema.partial().pick([...])  PUT /api/agents/:id/basic
//   index.js:818  SessionGroupSchema.partial()       PUT /api/session-groups/:id
//
// R19 用 failover 真实触发的 e2e 一次性挖出两个缺陷(见 ISSUES.md):
//
// **ISSUE-041**:`optional()` 写的是 `return this` —— 就地改写并返回**自身**。
//   而 `partial()` 会对**模块级共享的字段实例**逐个调 optional(),
//   于是 `ProviderSchema.partial()` 一执行,全局 schema 被永久改成"全部可选"。
//   实测:一次 PUT 之后 `ProviderSchema.parse({})` 从
//   「报缺 name/baseUrl」变成「ok=true」—— 必填校验在进程余生里失效,
//   `POST /api/providers` 也能拿空 body 建出垃圾行。
//
// **ISSUE-040**:`partial()` 没有剥掉**创建场景的默认值**。
//   `category: s.enum([...]).default("custom")` 同时带 `_hasDefault`,
//   而 `safeParse` 的 undefined 分支里 `_hasDefault` 判断**排在 `_optional` 之前**。
//   实测后果:PUT 只带 `{inFailoverQueue:true}`,就把 category 从 `local` 覆盖成
//   `custom` —— `isLocal` 随之变 false,SSRF 分类改变,
//   **failover 队列里的本地备援被静默跳过,整条转移机制不触发**;
//   `sortIndex` 也被重置为 0。一次"只改一个字段"的更新顺手改坏了别的字段。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderSchema, AgentSchema, SessionGroupSchema, s } from "../validate.js";

test("ISSUE-041:partial() 不得永久改写模块级共享 schema", () => {
  // 基线:必填必须生效
  const before = ProviderSchema.safeParse({});
  assert.equal(before.ok, false, "基线就应拒绝空 body");
  assert.ok(before.issues.some((i) => i.path === "name"));

  // 触发一次 partial(模拟任何一次 PUT)
  ProviderSchema.partial().parse({ inFailoverQueue: true });

  const after = ProviderSchema.safeParse({});
  assert.equal(after.ok, false,
    "partial() 之后必填校验必须仍然生效 —— 共享 schema 被改写了(ISSUE-041 复发)");
  assert.ok(after.issues.some((i) => i.path === "name"));
  assert.ok(after.issues.some((i) => i.path === "baseUrl"));
});

test("ISSUE-040:partial() 不得套用创建场景的默认值", () => {
  // 注:实现里 `c._hasDefault = false` 与 `c._default = undefined` 两行是**冗余的**
  //   (单删任一行,输出都不变 —— 因为 ObjectSchema 见到 undefined 就不写入)。
  //   保留两行是纵深防御:万一将来 parse 逻辑调整只看其中一个,不至于静默失效。
  //   本测试守的是**行为**(缺省字段不得出现在 partial 结果里),不是实现细节;
  //   实测两行同时删除会被本用例与下面那条一并抓到。
  const r = ProviderSchema.partial().parse({ inFailoverQueue: true });
  // 只应回传用户真的给了的字段
  assert.deepEqual(r, { inFailoverQueue: true });
  assert.equal(r.category, undefined, "category 被默认成了 custom —— 会覆盖已有的 local");
  assert.equal(r.sortIndex, undefined, "sortIndex 被默认成了 0 —— 会重置已有排序");
  assert.equal(r.apiFormat, undefined, "apiFormat 被默认成了 openai_chat —— 会覆盖已有配置");
});

test("创建场景的默认值必须完好(修 partial 不能误伤 default)", () => {
  const r = ProviderSchema.parse({ name: "x", baseUrl: "https://api.example.com/v1" });
  assert.equal(r.category, "custom");
  assert.equal(r.apiFormat, "openai_chat");
  assert.equal(r.sortIndex, 0);
});

test("partial() 仍应保留显式传入的值", () => {
  const r = ProviderSchema.partial().parse({ name: "改过的名字", category: "local" });
  assert.equal(r.name, "改过的名字");
  assert.equal(r.category, "local");
});

test("另两个用到 partial() 的 schema 同样正确", () => {
  // partial().pick() 组合
  const a = AgentSchema.partial().pick(["name"]);
  const ar = a.parse({ name: "n" });
  assert.equal(ar.name, "n");
  // 组名 schema
  const g = SessionGroupSchema.partial().parse({});
  assert.deepEqual(g, {}, "SessionGroupSchema.partial().parse({}) 不该凭空造出字段");
});

test("optional()/nullable() 不得就地改写自身(它们返回副本)", () => {
  const base = s.string().min(1, "必填");
  const opt = base.optional();
  assert.notEqual(base, opt, "optional() 必须返回副本,否则会改写共享实例");
  assert.equal(base.safeParse(undefined).ok, false, "原 schema 不该被 optional() 改写");
  assert.equal(opt.safeParse(undefined).ok, true);

  const nul = base.nullable();
  assert.notEqual(base, nul);
  assert.equal(base.safeParse(null).ok, false, "原 schema 不该被 nullable() 改写");
  assert.equal(nul.safeParse(null).ok, true);
});

test("链式用法不受影响(副本状态与改写时一致)", () => {
  const r = s.string().min(3, "太短").max(10, "太长").optional();
  assert.equal(r.safeParse("ab").ok, false, "min 约束应保留");
  assert.equal(r.safeParse("abc").ok, true);
  assert.equal(r.safeParse("a".repeat(20)).ok, false, "max 约束应保留");
  assert.equal(r.safeParse(undefined).ok, true, "optional 应保留");
});
