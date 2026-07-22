// 零依赖 schema 校验(仿 Zod API 极简版)
// 设计原则:
//   1. 链式 API:s.string().min(1).max(100)
//   2. 类型推断:parse 返回强类型(运行时);前端通过 .d.ts 共享类型
//   3. 友好错误:收集所有错误而非首个,前端可批量展示
//   4. 支持 stripUnknown(默认移除未定义字段,防止脏数据入库)
//   5. 支持 partial()/pick()/omit()(更新场景用)
//
// 用法:
//   const schema = s.object({
//     name: s.string().min(1, "name 为必填"),
//     baseUrl: s.string().url(),
//     apiKey: s.string().optional(),
//     sortIndex: s.number().int().min(0).default(0),
//     tags: s.array(s.string()).max(5),
//   });
//   const parsed = schema.parse(req.body);  // 失败抛 ValidationErrors
//   // 或:const result = schema.safeParse(req.body); if (!result.success) ...

export class ValidationErrors extends Error {
  constructor(issues) {
    super(issues.map(i => `${i.path}: ${i.message}`).join("; "));
    this.name = "ValidationErrors";
    this.issues = issues;
    this.status = 400;
  }
}

// ---- 基础类型 ----
class Schema {
  constructor() {
    this._optional = false;
    this._default = undefined;
    this._hasDefault = false;
    this._nullable = false;
  }
  optional() { this._optional = true; return this; }
  // nullable 允许 null,同时隐式允许 undefined(可空字段通常在前端也可不传)
  nullable() { this._nullable = true; this._optional = true; return this; }
  default(v) { this._default = v; this._hasDefault = true; this._optional = true; return this; }

  // 子类实现 _parse(value, path) → { ok, value, issues }
  _parse(value, path) { return { ok: true, value }; }

  // 统一入口:返回值或抛错
  parse(input, opts = {}) {
    const r = this.safeParse(input, opts);
    if (!r.ok) throw new ValidationErrors(r.issues);
    return r.value;
  }

  safeParse(input, opts = {}) {
    const path = opts.path || [];
    // null 处理
    if (input === null) {
      if (this._nullable) return { ok: true, value: null };
      if (this._optional) return { ok: true, value: undefined };
      return { ok: false, issues: [{ path: path.join("."), message: "不能为 null" }] };
    }
    // undefined 处理
    if (input === undefined) {
      if (this._hasDefault) return { ok: true, value: this._default };
      if (this._optional) return { ok: true, value: undefined };
      return { ok: false, issues: [{ path: path.join("."), message: "为必填" }] };
    }
    return this._parse(input, path);
  }
}

class StringSchema extends Schema {
  constructor() { super(); this._min = 0; this._max = Infinity; this._pattern = null; }
  min(n, msg) { this._min = n; this._minMsg = msg; return this; }
  max(n, msg) { this._max = n; this._maxMsg = msg; return this; }
  pattern(re, msg) { this._pattern = re; this._patMsg = msg; return this; }
  url(msg) { this._url = true; this._urlMsg = msg; return this; }
  email(msg) { this._email = true; this._emailMsg = msg; return this; }
  oneOf(list, msg) { this._enum = list; this._enumMsg = msg; return this; }
  _parse(value, path) {
    if (typeof value !== "string") {
      return { ok: false, issues: [{ path: path.join("."), message: "必须为字符串" }] };
    }
    const issues = [];
    if (value.length < this._min) {
      issues.push({ path: path.join("."), message: this._minMsg || `长度不能小于 ${this._min}` });
    }
    if (value.length > this._max) {
      issues.push({ path: path.join("."), message: this._maxMsg || `长度不能超过 ${this._max}` });
    }
    if (this._pattern && !this._pattern.test(value)) {
      issues.push({ path: path.join("."), message: this._patMsg || "格式不正确" });
    }
    if (this._url) {
      try { new URL(value); } catch {
        issues.push({ path: path.join("."), message: this._urlMsg || "URL 格式无效" });
      }
    }
    if (this._email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      issues.push({ path: path.join("."), message: this._emailMsg || "邮箱格式无效" });
    }
    if (this._enum && !this._enum.includes(value)) {
      issues.push({ path: path.join("."), message: this._enumMsg || `必须为 ${this._enum.join("/")} 之一` });
    }
    if (issues.length) return { ok: false, issues };
    // 去除首尾空白(避免 "  https://...  " 这种)
    return { ok: true, value: value.trim() };
  }
}

class NumberSchema extends Schema {
  constructor() { super(); this._min = -Infinity; this._max = Infinity; this._int = false; }
  min(n, msg) { this._min = n; this._minMsg = msg; return this; }
  max(n, msg) { this._max = n; this._maxMsg = msg; return this; }
  int(msg) { this._int = true; this._intMsg = msg; return this; }
  _parse(value, path) {
    // 接受数字字符串("5" → 5)
    if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))) {
      value = Number(value);
    }
    if (typeof value !== "number" || isNaN(value)) {
      return { ok: false, issues: [{ path: path.join("."), message: "必须为数字" }] };
    }
    const issues = [];
    if (value < this._min) issues.push({ path: path.join("."), message: this._minMsg || `不能小于 ${this._min}` });
    if (value > this._max) issues.push({ path: path.join("."), message: this._maxMsg || `不能大于 ${this._max}` });
    if (this._int && !Number.isInteger(value)) issues.push({ path: path.join("."), message: this._intMsg || "必须为整数" });
    if (issues.length) return { ok: false, issues };
    return { ok: true, value };
  }
}

class BooleanSchema extends Schema {
  _parse(value, path) {
    if (typeof value === "string") {
      if (value === "true") return { ok: true, value: true };
      if (value === "false") return { ok: true, value: false };
    }
    if (typeof value !== "boolean") {
      return { ok: false, issues: [{ path: path.join("."), message: "必须为布尔值" }] };
    }
    return { ok: true, value };
  }
}

class ArraySchema extends Schema {
  constructor(itemSchema) { super(); this._item = itemSchema; this._min = 0; this._max = Infinity; }
  min(n, msg) { this._min = n; this._minMsg = msg; return this; }
  max(n, msg) { this._max = n; this._maxMsg = msg; return this; }
  _parse(value, path) {
    if (!Array.isArray(value)) {
      return { ok: false, issues: [{ path: path.join("."), message: "必须为数组" }] };
    }
    const issues = [];
    if (value.length < this._min) issues.push({ path: path.join("."), message: this._minMsg || `至少 ${this._min} 项` });
    if (value.length > this._max) issues.push({ path: path.join("."), message: this._maxMsg || `最多 ${this._max} 项` });
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const r = this._item.safeParse(value[i], { path: [...path, i] });
      if (!r.ok) { issues.push(...r.issues); out.push(undefined); }
      else out.push(r.value);
    }
    if (issues.length) return { ok: false, issues };
    return { ok: true, value: out };
  }
}

class ObjectSchema extends Schema {
  constructor(shape) { super(); this._shape = shape; this._stripUnknown = true; }
  // 默认 stripUnknown=true(移除 shape 之外的字段,防止脏数据)
  // passthrough() 允许未知字段通过
  passthrough() { this._stripUnknown = false; return this; }
  // 部分字段可选(更新场景)
  partial(keys) {
    const newShape = {};
    for (const [k, s] of Object.entries(this._shape)) {
      newShape[k] = keys && !keys.includes(k) ? s : s.optional();
    }
    const o = new ObjectSchema(newShape);
    o._stripUnknown = this._stripUnknown;
    return o;
  }
  pick(keys) {
    const newShape = {};
    for (const k of keys) if (this._shape[k]) newShape[k] = this._shape[k];
    const o = new ObjectSchema(newShape);
    o._stripUnknown = this._stripUnknown;
    return o;
  }
  omit(keys) {
    const newShape = {};
    for (const [k, s] of Object.entries(this._shape)) {
      if (!keys.includes(k)) newShape[k] = s;
    }
    const o = new ObjectSchema(newShape);
    o._stripUnknown = this._stripUnknown;
    return o;
  }
  _parse(value, path) {
    if (typeof value !== "object" || Array.isArray(value) || value === null) {
      return { ok: false, issues: [{ path: path.join("."), message: "必须为对象" }] };
    }
    const issues = [];
    const out = {};
    for (const [k, s] of Object.entries(this._shape)) {
      const r = s.safeParse(value[k], { path: [...path, k] });
      if (!r.ok) issues.push(...r.issues);
      else if (r.value !== undefined) out[k] = r.value;
      // undefined 时不写入(避免把 undefined 写到 DB)
    }
    // 未知字段处理
    if (!this._stripUnknown) {
      for (const [k, v] of Object.entries(value)) {
        if (!(k in this._shape) && v !== undefined) out[k] = v;
      }
    }
    if (issues.length) return { ok: false, issues };
    return { ok: true, value: out };
  }
}

// 工厂函数(链式入口)
export const s = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  array: (item) => new ArraySchema(item),
  object: (shape) => new ObjectSchema(shape),
  // enum(字符串字面量联合)
  enum: (values, msg) => new StringSchema().oneOf(values, msg),
};

// ---- 共享 Schema 定义(前后端共用) ----
// 字段语义、约束、默认值集中在此,前端 .d.ts 通过类型生成器或手写复用
// 关键设计:模型名/供应商 ID 等用 string + 合理长度,不强制 enum(便于扩展)

export const ProviderSchema = s.object({
  name: s.string().min(1, "供应商名称为必填").max(50),
  category: s.enum(["official", "cn_official", "aggregator", "local", "custom"]).default("custom"),
  baseUrl: s.string().min(1, "baseUrl 为必填").max(500).url("baseUrl 格式无效"),
  apiKey: s.string().max(500).optional(),
  apiFormat: s.enum(["openai_chat", "anthropic"]).default("openai_chat"),
  modelName: s.string().max(100).optional(),
  icon: s.string().max(500).optional(),
  iconColor: s.string().max(20).optional(),
  notes: s.string().max(2000).optional(),
  websiteUrl: s.string().max(500).url("websiteUrl 格式无效").optional(),
  sortIndex: s.number().int().min(0).default(0),
  isActive: s.boolean().optional(),
  inFailoverQueue: s.boolean().optional(),
  failoverPriority: s.number().int().min(0).optional(),
  seedVersion: s.number().int().min(0).optional(),
});

export const AgentSchema = s.object({
  // v10:agentId 格式校验,防止路径穿越(图标保存时拼接文件路径)
  // 仅允许字母/数字/下划线/短横线,1-32 字符;未传时由 createAgent 用 nanoid 生成
  agentId: s.string().pattern(/^[a-zA-Z0-9_-]{1,32}$/, "agentId 格式不合法(仅允许字母数字下划线短横线,1-32 字符)").optional(),
  name: s.string().min(1, "name 为必填").max(50),
  avatar: s.string().max(20).optional(),
  // role/tone enum 与前端 api/types.ts 完全一致(前后端联合类型统一)
  // "custom" 是前端 UI 默认值;"candidate" 是历史值,均合法
  role: s.enum(["hr", "tech", "ceo", "candidate", "custom"], "role 必须为 hr/tech/ceo/candidate/custom 之一"),
  // "direct" 是前端 UI 默认值;"professional"/"pragmatic" 是历史值,均合法
  tone: s.enum(["gentle", "direct", "aggressive", "professional", "neutral", "pragmatic"]).default("neutral"),
  focusAreas: s.array(s.string().max(30)).max(10).default([]),
  difficulty: s.number().int().min(1).max(10).default(5),
  promptTemplate: s.string().min(1, "promptTemplate 为必填").max(20000),
  isTemplate: s.boolean().optional(),
  iconType: s.enum(["emoji", "preset", "uploaded"]).default("emoji"),
  iconValue: s.string().max(200).optional(),
  preferredProviderId: s.string().max(100).nullable(),
  agentKind: s.enum(["interviewer", "candidate"]).default("interviewer"),
  candidatePersona: s.string().max(50).nullable(),
});

export const SessionSchema = s.object({
  title: s.string().min(1, "title 为必填").max(200),
  modelId: s.string().min(1, "modelId 为必填").max(100),
  flowTemplate: s.string().max(5000).optional(),
  difficulty: s.enum(["easy", "normal", "hard", "extreme", "hell"]).default("normal"),
  groupId: s.string().max(50).nullable(),
  sessionType: s.enum(["interview", "group"]).default("interview"),
  groupConfig: s.object({}).passthrough().optional(),
});

export const MessageSchema = s.object({
  role: s.enum(["user", "assistant", "system"], "role 必须为 user/assistant/system"),
  content: s.string().min(1, "content 为必填").max(100000),
  agentId: s.string().max(50).optional(),
  agentVersionId: s.string().max(50).optional(),
  modelVersion: s.string().max(100).optional(),
  tokensIn: s.number().int().min(0).optional(),
  tokensOut: s.number().int().min(0).optional(),
  stage: s.number().int().min(0).optional(),
  isDegraded: s.boolean().optional(),
});

export const EvaluationSchema = s.object({
  sessionId: s.string().min(1).max(50),
  overallScore: s.number().min(0).max(10),
  report: s.string().min(1, "report 为必填").max(50000),
  improvementAdvice: s.string().max(10000).optional(),
  betterAnswerSample: s.string().max(20000).optional(),
  dimensions: s.array(
    s.object({
      dimensionName: s.string().min(1).max(50),
      score: s.number().min(1).max(5),
      weight: s.number().min(0).max(10).optional(),
      comment: s.string().max(2000).optional(),
    })
  ).optional(),
});

export const MaterialSchema = s.object({
  type: s.enum(["resume", "jd", "reference", "other"], "type 必须为 resume/jd/reference/other"),
  sourceType: s.enum(["file", "text", "url"], "sourceType 必须为 file/text/url"),
  rawText: s.string().min(1, "rawText 为必填").max(500000),
  title: s.string().max(200).optional(),
  sourceRef: s.string().max(500).optional(),
  parsedJson: s.string().max(500000).optional(),
});

export const SessionGroupSchema = s.object({
  name: s.string().min(1, "name 为必填").max(50),
  description: s.string().max(500).optional(),
  color: s.string().pattern(/^#[0-9a-fA-F]{6}$/, "color 必须为 #RRGGBB 格式").default("#4D6BFE"),
  sortOrder: s.number().int().min(0).default(0),
});

// 通用:id 参数校验
export const IdParam = s.string().min(1).max(100);
