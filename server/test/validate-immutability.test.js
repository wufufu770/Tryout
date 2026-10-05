// 单元测试:schema 实例的**不可变性**与正则的**无状态性**(守卫 ISSUE-046/047/048)
//
// ## 背景
// `server/validate.js` 是自研的"仿 Zod"零依赖实现,导出的 schema
// (`ProviderSchema` / `AgentSchema` / …)都是**模块级共享实例**。
// 一旦某个方法就地改写了这些实例,影响会持续整个进程余生 —— 这正是
// ISSUE-041(`optional()` 写 `return this`)造成的事故:
// 一次 `PUT /api/providers/:id` 之后,`ProviderSchema.parse({})` 从
// 「报缺 name/baseUrl」变成「ok=true」,必填校验彻底失效。
//
// 本文件锁死三条不变量,防止同类反模式从别处再长出来:
//   1. 所有「改配置」的方法(partial/optional/nullable/passthrough/pick)
//      必须返回**副本**,且克隆要递归到子 schema
//   2. 克隆必须彻底:改副本不得穿透到原件(含 ObjectSchema._shape / ArraySchema._item)
//   3. pattern() 不得引入**有状态**正则(/g、/y 会让 .test() 读写 lastIndex)
//
// 三条里第 1、2 条在 R21 之前是 latent(现有调用点恰好没踩到),
// 但 ISSUE-041 就是在"恰好没踩到"的状态下潜伏了 6 轮,所以按 latent 处理同样值得。
import { test } from "node:test";
import assert from "node:assert/strict";
import { s, ProviderSchema, AgentSchema, SessionGroupSchema } from "../validate.js";

/* ---------- 1. 改配置的方法必须返回副本 ---------- */

test("passthrough() 必须返回副本(ISSUE-046)", () => {
  const A = s.object({ x: s.string() });
  const B = A.passthrough();
  assert.notEqual(A, B, "passthrough() 不得返回自身");
  assert.equal(A._stripUnknown, true, "原 schema 的 stripUnknown 不得被改写");
  assert.equal(B._stripUnknown, false, "副本才应当关闭 stripUnknown");
});

test("optional() / nullable() 不得就地改写(ISSUE-041 回归)", () => {
  const base = s.string().min(1, "必填");
  assert.notEqual(base.optional(), base);
  assert.notEqual(base.nullable(), base);
  assert.equal(base.safeParse(undefined).ok, false);
  assert.equal(base.safeParse(null).ok, false);
});

test("partial() 不得改写原 schema(ISSUE-040/041 回归)", () => {
  const before = ProviderSchema.safeParse({});
  assert.equal(before.ok, false, "基线必须拒绝空 body");
  ProviderSchema.partial().parse({ inFailoverQueue: true });
  const after = ProviderSchema.safeParse({});
  assert.equal(after.ok, false, "partial() 之后必填校验必须仍然生效");
  assert.ok(after.issues.some((i) => i.path === "name"));
  assert.ok(after.issues.some((i) => i.path === "baseUrl"));
});

test("pick() / omit() 不得与原 schema 共享字段实例(ISSUE-048)", () => {
  const picked = AgentSchema.partial().pick(["name"]);
  assert.notEqual(picked._shape.name, AgentSchema._shape.name, "pick 出来的字段必须是副本");
  const A = s.object({ x: s.string(), y: s.string() });
  const p2 = A.pick(["x"]);
  assert.equal(Object.keys(p2._shape).length, 1);
  assert.notEqual(p2._shape.x, A._shape.x);
});

test("partial(keys) 里**非列表**字段也必须克隆(ISSUE-048)", () => {
  const p = ProviderSchema.partial(["name"]);
  assert.notEqual(p._shape.name, ProviderSchema._shape.name, "列表内字段应克隆");
  assert.notEqual(p._shape.baseUrl, ProviderSchema._shape.baseUrl,
    "列表外字段同样要克隆 —— 否则将来改副本会穿透回原件");
});

/* ---------- 2. 克隆必须递归 ---------- */

test("clone() 必须递归到 ObjectSchema 的子 schema(ISSUE-046)", () => {
  const inner = s.object({ a: s.string().min(1) });
  const wrap = s.object({ inner });
  const copy = wrap.clone();
  assert.notEqual(copy._shape, wrap._shape, "_shape 本身不能是同一引用");
  assert.notEqual(copy._shape.inner, inner, "嵌套 schema 必须是副本");
  // 真正的判据:改副本不得穿透回原件
  copy._shape.inner._stripUnknown = false;
  assert.equal(inner._stripUnknown, true, "改副本把原件也改了 —— 浅拷贝 ❗");
});

test("clone() 必须递归到 ArraySchema 的 item schema(ISSUE-046)", () => {
  const arr = s.array(s.string().min(1));
  const copy = arr.clone();
  assert.notEqual(copy._item, arr._item, "数组的 item schema 必须是副本");
  // 用 _optional 而不是 _stripUnknown:后者只存在于 ObjectSchema,
  // 而这里的 item 是 StringSchema,取它只会拿到 undefined 造成误判。
  copy._item._optional = true;
  assert.equal(arr._item._optional, false, "改副本把原件也改了 ❗");
});

/* ---------- 3. 正则必须无状态 ---------- */

test("pattern(/foo/g) 不得让 .test() 随调用次数抖动(ISSUE-047)", () => {
  // RegExp.prototype.test 在 g/y 标志下读写 lastIndex,
  // 于是同一个 schema 第二次解析就从上次位置继续找 —— true/false/true 交替。
  const sg = s.string().pattern(/foo/g, "格式");
  const results = [sg.safeParse("foo").ok, sg.safeParse("foo").ok, sg.safeParse("foo").ok];
  assert.deepEqual(results, [true, true, true], "同一输入必须给出稳定结果");
});

test("pattern(/foo/gy) 同样必须稳定(ISSUE-047)", () => {
  const sy = s.string().pattern(/foo/gy, "格式");
  assert.deepEqual([sy.safeParse("foo").ok, sy.safeParse("foo").ok], [true, true]);
});

test("pattern 不匹配时仍要稳定报错(ISSUE-047)", () => {
  const sg = s.string().pattern(/^a+$/g, "格式");
  assert.equal(sg.safeParse("aaa").ok, true);
  assert.equal(sg.safeParse("aaa").ok, true);
  assert.equal(sg.safeParse("bbb").ok, false);
  assert.equal(sg.safeParse("bbb").ok, false);
});

test("既有 pattern 行为不受影响", () => {
  // 项目里真实在用的两条:agentId 与 color
  const A = { name: "n", role: "tech", promptTemplate: "p" };   // promptTemplate 也是必填
  assert.equal(AgentSchema.safeParse({ ...A, agentId: "bad id!" }).ok, false);
  assert.equal(AgentSchema.safeParse({ ...A, agentId: "ok-id_1" }).ok, true);
  const S = s.object({ color: s.string().pattern(/^#[0-9a-fA-F]{6}$/, "格式") });
  assert.equal(S.safeParse({ color: "#4D6BFE" }).ok, true);
  assert.equal(S.safeParse({ color: "4D6BFE" }).ok, false);
});

/* ---------- 4. 组合用法不得被这些改动波及 ---------- */

test("三个用到 partial() 的 schema 组合仍然正确", () => {
  assert.deepEqual(ProviderSchema.partial().parse({ inFailoverQueue: true }), { inFailoverQueue: true });
  assert.deepEqual(AgentSchema.partial().pick(["name"]).parse({ name: "n" }), { name: "n" });
  assert.deepEqual(SessionGroupSchema.partial().parse({}), {});
});
