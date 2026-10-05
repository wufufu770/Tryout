// Schema 校验测试(零依赖 validate.js)
import test from "node:test";
import assert from "node:assert/strict";
import { s, ProviderSchema, AgentSchema, SessionSchema, ValidationErrors } from "../validate.js";

test("Provider schema:合法数据通过", () => {
  const input = {
    name: "OpenAI",
    category: "official",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai_chat",
    modelName: "gpt-4",
    sortIndex: 1,
  };
  const r = ProviderSchema.safeParse(input);
  assert.ok(r.ok, JSON.stringify(r.issues));
  assert.equal(r.value.name, "OpenAI");
  assert.equal(r.value.category, "official");
});

test("Provider schema:缺 name 失败", () => {
  const r = ProviderSchema.safeParse({ baseUrl: "https://x.com" });
  assert.ok(!r.ok);
  assert.ok(r.issues.some(i => i.path === "name"));
});

test("Provider schema:非法 baseUrl 失败", () => {
  const r = ProviderSchema.safeParse({ name: "X", baseUrl: "not-a-url" });
  assert.ok(!r.ok);
  assert.ok(r.issues.some(i => i.path === "baseUrl"));
});

test("Provider schema:非法 category 失败", () => {
  const r = ProviderSchema.safeParse({ name: "X", baseUrl: "https://x.com", category: "weird" });
  assert.ok(!r.ok);
  assert.ok(r.issues.some(i => i.path === "category"));
});

test("Provider schema:stripUnknown 移除未定义字段", () => {
  const r = ProviderSchema.safeParse({
    name: "X", baseUrl: "https://x.com",
    evilField: "DROP TABLE users;",
  });
  assert.ok(r.ok);
  assert.equal(r.value.evilField, undefined);
});

test("Provider schema:partial() 所有字段可选(更新场景)", () => {
  const partial = ProviderSchema.partial();
  // 仅传 sortIndex,也应通过
  const r = partial.safeParse({ sortIndex: 5 });
  assert.ok(r.ok);
  assert.equal(r.value.sortIndex, 5);
});

test("Provider schema:default 填充", () => {
  const r = ProviderSchema.safeParse({ name: "X", baseUrl: "https://x.com" });
  assert.ok(r.ok);
  assert.equal(r.value.category, "custom"); // 默认值
  assert.equal(r.value.apiFormat, "openai_chat");
  assert.equal(r.value.sortIndex, 0);
});

test("Provider schema:string 自动 trim", () => {
  const r = ProviderSchema.safeParse({ name: "  OpenAI  ", baseUrl: "https://x.com" });
  assert.ok(r.ok);
  assert.equal(r.value.name, "OpenAI");
});

test("Provider schema:maxLength 拦截", () => {
  const longName = "x".repeat(51);
  const r = ProviderSchema.safeParse({ name: longName, baseUrl: "https://x.com" });
  assert.ok(!r.ok);
  assert.ok(r.issues.some(i => i.path === "name"));
});

test("Agent schema:合法数据通过", () => {
  const input = {
    name: "温和 HR",
    role: "hr",
    promptTemplate: "你是一位 HR",
  };
  const r = AgentSchema.safeParse(input);
  assert.ok(r.ok, JSON.stringify(r.issues));
  assert.equal(r.value.tone, "neutral"); // 默认值
  assert.equal(r.value.difficulty, 5);
  assert.equal(r.value.agentKind, "interviewer");
});

test("Agent schema:非法 role 失败", () => {
  const r = AgentSchema.safeParse({ name: "X", role: "alien", promptTemplate: "..." });
  assert.ok(!r.ok);
  assert.ok(r.issues.some(i => i.path === "role"));
});

test("Agent schema:difficulty 越界失败", () => {
  const r = AgentSchema.safeParse({ name: "X", role: "hr", promptTemplate: "...", difficulty: 15 });
  assert.ok(!r.ok);
  assert.ok(r.issues.some(i => i.path === "difficulty"));
});

test("Agent schema:difficulty 字符串自动转数字", () => {
  const r = AgentSchema.safeParse({ name: "X", role: "hr", promptTemplate: "...", difficulty: "7" });
  assert.ok(r.ok);
  assert.equal(r.value.difficulty, 7);
});

test("Session schema:合法数据通过", () => {
  const r = SessionSchema.safeParse({ title: "后端面试", modelId: "gpt-4" });
  assert.ok(r.ok);
  assert.equal(r.value.difficulty, "normal");
  assert.equal(r.value.sessionType, "interview");
});

test("Session schema:flowTemplate 过长失败", () => {
  const r = SessionSchema.safeParse({
    title: "x", modelId: "gpt-4",
    flowTemplate: "x".repeat(5001),
  });
  assert.ok(!r.ok);
});

test("Schema parse 失败抛 ValidationErrors", () => {
  assert.throws(() => ProviderSchema.parse({ baseUrl: "x" }), (e) => {
    return e instanceof ValidationErrors && e.issues.length > 0;
  });
});

test("Object schema:pick 仅保留指定字段", () => {
  const picked = ProviderSchema.pick(["name", "baseUrl"]);
  const r = picked.safeParse({ name: "X", baseUrl: "https://x.com", apiKey: "sk-xxx" });
  assert.ok(r.ok);
  assert.equal(r.value.apiKey, undefined);
});

test("Object schema:omit 移除指定字段", () => {
  const omitted = ProviderSchema.omit(["apiKey", "notes"]);
  const r = omitted.safeParse({ name: "X", baseUrl: "https://x.com", apiKey: "sk-xxx" });
  assert.ok(r.ok);
  assert.equal(r.value.apiKey, undefined);
});

test("Array schema:max 限制", () => {
  const schema = s.array(s.string()).max(3);
  const r = schema.safeParse(["a", "b", "c", "d"]);
  assert.ok(!r.ok);
});

test("Number schema:int 拒绝非整数", () => {
  const r = s.number().int().safeParse(1.5);
  assert.ok(!r.ok);
});

test("String schema:email 校验", () => {
  const r = s.string().email().safeParse("not-email");
  assert.ok(!r.ok);
  const r2 = s.string().email().safeParse("foo@bar.com");
  assert.ok(r2.ok);
});

test("String schema:pattern 正则", () => {
  const schema = s.string().pattern(/^#[0-9a-fA-F]{6}$/, "颜色格式错误");
  assert.ok(!schema.safeParse("red").ok);
  assert.ok(schema.safeParse("#FF5733").ok);
});

test("Boolean schema:字符串自动转换", () => {
  const r = s.boolean().safeParse("true");
  assert.ok(r.ok && r.value === true);
  const r2 = s.boolean().safeParse("false");
  assert.ok(r2.ok && r2.value === false);
  const r3 = s.boolean().safeParse("yes");
  assert.ok(!r3.ok);
});

test("嵌套 schema:对象中的数组", () => {
  const schema = s.object({
    tags: s.array(s.string()).max(3),
    count: s.number().int().min(0),
  });
  assert.ok(schema.safeParse({ tags: ["a", "b"], count: 5 }).ok);
  assert.ok(!schema.safeParse({ tags: ["a", "b", "c", "d"], count: 5 }).ok);
});

// ---- W3-2:目标岗位字段 ----
// 回归防护:白名单式 schema 会**静默剥离**未声明的字段。
// 漏加 industry/position 会导致前端传了却存不进去、且不报任何错。
test("SessionSchema 保留 W3-2 的 industry/position", () => {
  const r = SessionSchema.safeParse({
    title: "后端面试",
    modelId: "gpt-4",
    industry: "backend",
    position: "后端工程师",
  });
  assert.ok(r.ok, "解析应成功");
  assert.equal(r.value.industry, "backend", "industry 必须被保留(不能被静默剥离)");
  assert.equal(r.value.position, "后端工程师", "position 必须被保留");
});

test("SessionSchema 允许 industry/position 为空(未设岗位是合法状态)", () => {
  const r = SessionSchema.safeParse({ title: "x", modelId: "m", industry: null, position: null });
  assert.ok(r.ok);
  assert.equal(r.value.industry, null);
});

test("SessionSchema 拒绝过长的 industry/position", () => {
  assert.ok(!SessionSchema.safeParse({ title: "x", modelId: "m", industry: "a".repeat(51) }).ok);
  assert.ok(!SessionSchema.safeParse({ title: "x", modelId: "m", position: "a".repeat(101) }).ok);
});

test("SessionSchema 未传 industry/position 时不报错(向后兼容老库)", () => {
  const r = SessionSchema.safeParse({ title: "x", modelId: "m" });
  assert.ok(r.ok);
  assert.equal(r.value.industry, undefined);
});
