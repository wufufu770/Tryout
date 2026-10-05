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

// ---- 视觉空白处理(R49,ISSUE-045 的漏网之鱼)----
/**
 * 剥掉"**看起来是空白、但 JS 的 trim() 不认**"的字符。
 *
 * ## 为什么不能只用 trim()
 * `String.prototype.trim()` 的空白集合 = White_Space + LineTerminator,
 * 但有两类东西漏在外面:
 *   - U+0000 NUL —— 控制字符,常来自 C 字符串拼接 / 文件截断 / 上游脏数据
 *   - U+180E MONGOLIAN VOWEL SEPARATOR —— Unicode 6.3 之前算空白,之后不算;
 *     旧数据里大量存在
 *   - U+200B~U+200D ZERO WIDTH SPACE/NON-JOINER/JOINER —— 零宽,肉眼不可见
 *   - U+FEFF ZERO WIDTH NO-BREAK SPACE(BOM)
 *   - U+2060 WORD JOINER / U+FEFF 类方向控制符
 *
 * 后果:一个只含这些字符的字符串能**绕过 min(1)**,
 * 界面上显示为空白,数据库里却存了一串不可见垃圾;
 * 而下游任何用 `.trim() === ""` 判断"是否为空"的代码都会认为它**有值**。
 *
 * ## 边界
 * 只处理**空白与不可见控制字符**,不改变任何可见字符。
 * `StringSchema` 已在 R45 改成"先剥空白再校验",此处只是把"空白"的定义补全。
 */
const INVISIBLE_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** 剥掉 JS trim 认的空白 + 上面那些 trim 不认的不可见字符 */
function stripInvisible(v) {
  return v.trim().replace(INVISIBLE_RE, "");
}

// ---- 基础类型 ----
class Schema {
  constructor() {
    this._optional = false;
    this._default = undefined;
    this._hasDefault = false;
    this._nullable = false;
  }
  // R19(ISSUE-041):optional()/nullable() 原先 `return this` —— **就地改写并返回自身**。
  //   而 partial() 会对**模块级共享的字段实例**逐个调 optional(),
  //   于是 `ProviderSchema.partial()` 一执行,全局 schema 就被永久改成"全部可选"。
  //   实测:一次 PUT /api/providers/:id 之后,`ProviderSchema.parse({})` 由
  //   「报缺 name/baseUrl」变成「ok=true」—— 必填校验在进程余生里彻底失效,
  //   `POST /api/providers` 也能拿空 body 建出垃圾行。
  //   修法:返回**副本**,调用方拿到的宽松版本与原 schema 互不影响。
  //   链式用法(`s.string().max(500).optional()`)不受影响:副本状态与改写时一致。
  //
  // R21(ISSUE-046):必须**连同子 schema 一起**克隆,不能只做浅拷贝。
  //   浅拷贝对 ObjectSchema 而言 `_shape` 仍是同一引用,对 ArraySchema 而言 `_item` 也是,
  //   于是"改副本"会穿透改到原件 —— 这正是 ISSUE-041 的同类。
  //   现有的 partial/optional/pick 恰好都只改标量字段、没碰 `_shape`,
  //   所以**目前没有现行 bug**;但只要将来有一个方法去改 `_shape`/`_item`,
  //   这条假设立刻崩塌(ISSUE-041 当初也是这样潜伏了 6 轮)。这里把地基补实。
  clone() {
    const c = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    if (this._shape) {
      c._shape = {};
      for (const [k, v] of Object.entries(this._shape)) c._shape[k] = v?.clone ? v.clone() : v;
    }
    if (this._item?.clone) c._item = this._item.clone();
    return c;
  }
  optional() { const c = this.clone(); c._optional = true; return c; }
  // nullable 允许 null,同时隐式允许 undefined(可空字段通常在前端也可不传)
  nullable() { const c = this.clone(); c._nullable = true; c._optional = true; return c; }
  default(v) { this._default = v; this._hasDefault = true; this._optional = true; return this; }
  // R21(ISSUE-047):带 `g` / `y` 标志的正则**有状态**。
  //   `RegExp.prototype.test` 在这两个标志下会读写 `lastIndex`,于是同一个 schema
  //   被复用第二次时就从上次的位置继续找,出现 true/false/true 交替的假象:
  //     const s = x.string().pattern(/foo/g)
  //     s.safeParse("foo")  // true
  //     s.safeParse("foo")  // false  ← 应为 true
  //   项目现有 schema 都没用 /g(已核查),属 latent;但校验器本身是坏的,
  //   任何人加一个带 g 的 pattern 就会中招。这里直接剥掉状态性标志。
  pattern(re, msg) { this._pattern = new RegExp(re.source, re.flags.replace(/[gy]/g, "")); this._patMsg = msg; return this; }

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
  url(msg) { this._url = true; this._urlMsg = msg; return this; }
  email(msg) { this._email = true; this._emailMsg = msg; return this; }
  oneOf(list, msg) { this._enum = list; this._enumMsg = msg; return this; }
  _parse(value, path) {
    if (typeof value !== "string") {
      return { ok: false, issues: [{ path: path.join("."), message: "必须为字符串" }] };
    }
    // ⚠️ R20(ISSUE-045):必须**先 trim 再校验**。
    //   原顺序是「按原值判 min/max 等 → 最后才 trim」,于是纯空白串能同时骗过两层:
    //     ProviderSchema.parse({ name: "   ", ... })  →  ok=true, name === ""
    //   因为 "   ".length === 3 ≥ min(1) 先过了,trim 之后才变成空串被原样返回。
    //   `name` / `promptTemplate` / `title` / `content` 等 8 个必填字段都中招:
    //   最严重的是 `promptTemplate` —— 空的 prompt 模板会让 LLM 自由发挥,
    //   产出完全不可控,而全链路没有任何一处报错。
    //   空白形态不止半角:全角空格 \u3000、NBSP \u00A0 同样会被 trim 掉。
    //   副作用(正向):`" openai "` 这类带空白的 enum 值现在也能正确匹配,
    //   与「本来就要 trim」的既有行为保持一致。
    //
    // ⚠️ R49(模糊测试发现,ISSUE-045 的漏网之鱼):原生 `trim()` 的空白集合
    //   **不包含** NUL(U+0000)与 U+180E(蒙古文元音分隔符,Unicode 6.3 起不再是 White_Space)。
    //   也就是说一个只含 NUL 的字符串,trim() 之后长度仍是 1 ⇒ **绕过了 min(1)**。
    //   模糊测试投喂 2000 条畸形输入时,实测有 134 条这种"看起来全空白、
    //   实际非空"的字符串被放进库里。
    //   影响:用户界面上是空白,数据库里却是一串不可见垃圾;
    //   下游任何用 trim 判断"是否为空"的地方都会认为它**有值**。
    //   这类字符靠枚举式测试几乎不可能想到 —— 这正是模糊测试的价值。
    const v = stripInvisible(value);
    const issues = [];
    if (v.length < this._min) {
      issues.push({ path: path.join("."), message: this._minMsg || `长度不能小于 ${this._min}` });
    }
    if (v.length > this._max) {
      issues.push({ path: path.join("."), message: this._maxMsg || `长度不能超过 ${this._max}` });
    }
    if (this._pattern && !this._pattern.test(v)) {
      issues.push({ path: path.join("."), message: this._patMsg || "格式不正确" });
    }
    if (this._url) {
      try { new URL(v); } catch {
        issues.push({ path: path.join("."), message: this._urlMsg || "URL 格式无效" });
      }
    }
    if (this._email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      issues.push({ path: path.join("."), message: this._emailMsg || "邮箱格式无效" });
    }
    if (this._enum && !this._enum.includes(v)) {
      issues.push({ path: path.join("."), message: this._enumMsg || `必须为 ${this._enum.join("/")} 之一` });
    }
    if (issues.length) return { ok: false, issues };
    return { ok: true, value: v };
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
  //
  // ⚠️ R21(ISSUE-046):必须返回**副本**。这里原先是 `return this`,
  //   与 ISSUE-041 修过的 optional() 是同一个反模式:一旦有人写出
  //   `SomeSharedSchema.passthrough()`,那个模块级共享 schema 的
  //   stripUnknown 会被**永久**改成 false,之后所有未知字段都静默入库。
  //   现有调用点恰好都用 inline 的 `s.object({…}).passthrough()` 写法,
  //   临时对象用完即弃,所以一直没踩到 —— 但雷还在。
  passthrough() { const c = this.clone(); c._stripUnknown = false; return c; }
  // 部分字段可选(更新场景)
  //
  // ⚠️ R19(ISSUE-040):这里除了「让字段可选」,还必须**剥掉创建场景的默认值**。
  //   `category: s.enum([...]).default("custom")` 这类字段同时带 _hasDefault;
  //   而 safeParse 的 undefined 分支里 `_hasDefault` 的判断**排在 `_optional` 之前**,
  //   所以 partial 之后缺省字段仍会被填上默认值。
  //   实测后果:`PUT /api/providers/:id` 只带 `{inFailoverQueue:true}`,
  //   就会把 `category` 从 `local` 覆盖成 `custom` —— 于是 resolveProvider 的
  //   `isLocal` 变 false,SSRF 分类改变,本地供应商(Ollama 等)与
  //   **failover 队列里的本地备援**会被静默跳过,同名的 `sortIndex` 也会被重置为 0。
  //   也就是说:一次"部分更新"会顺手改掉用户没打算改、且改完会坏掉的字段。
  //   修法:partial 产出的字段副本去掉 _hasDefault,缺省即"不写"(updateProvider 用
  //   COALESCE(?, col) 保留原值,契约对齐)。
  partial(keys) {
    const newShape = {};
    for (const [k, s] of Object.entries(this._shape)) {
      // ⚠️ R21(ISSUE-048):**所有**字段都要克隆,不只是 keys 里的。
      //   原先不在 keys 里的字段直接复用原引用,于是 partial(keys) 产出的对象
      //   与原 schema 共享同一批字段实例 —— 将来任何"改副本"的写法都会穿透回去。
      //   项目目前没有 partial(keys) 的调用点(都传空),属 latent。
      const c = s.clone();
      if (keys && !keys.includes(k)) { newShape[k] = c; continue; }
      c._optional = true;
      c._hasDefault = false;
      c._default = undefined;
      newShape[k] = c;
    }
    const o = new ObjectSchema(newShape);
    o._stripUnknown = this._stripUnknown;
    return o;
  }
  pick(keys) {
    const newShape = {};
    // 同 ISSUE-048:pick 也必须克隆,否则产出对象与原 schema 共享字段实例
    for (const k of keys) if (this._shape[k]) newShape[k] = this._shape[k].clone();
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
  // W3-2:目标岗位。industry 对应题库的行业 id(backend/frontend/...),
  // position 是自由文本岗位名。缺省时提问侧不猜行业,返回 needsIndustry。
  // ⚠️ 白名单式 schema 会静默剥离未声明字段 —— 漏加这两个会让
  //    前端传了却存不进去,且不报错。
  industry: s.string().max(50).nullable().optional(),
  position: s.string().max(100).nullable().optional(),
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
