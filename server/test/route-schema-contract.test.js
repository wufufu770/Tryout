// 单元测试:路由 schema ↔ db 层契约一致性(守卫 ISSUE-018 / ISSUE-023 同类缺陷)
//
// ## 为什么需要这条测试
// 本项目已连续两次出现**同一类**契约不一致:
//   ISSUE-018:`POST /api/sessions/:id/review` 的路由 schema 声明
//             reviewText/summary/overallRating,而 db 层要 overallScore,
//             两者无一重合 → 该路由**任何载荷都写不进去**。
//   ISSUE-023:`PUT /api/agents/:id/basic` 用 `.partial()` 声明支持部分更新,
//             db 层却要求 name+role 同传 → "只改名字"被拒。
//
// 共同点:项目大量使用**白名单式 schema**(`s.object({...})` / `.partial().pick()`),
// 它会**静默剥离**未声明字段 —— 于是"路由层收了什么"与"下层真正需要什么"
// 一旦不一致,失败会以 400 的形式出现,且错误信息完全指向错误的方向。
//
// ## 本测试做什么
// 静态分析:对每个「用 schema 解析 body → 调 db 函数」的路由,
// 比对 schema 声明的字段集与 db 函数里 `if (!x) throw` 守卫的字段集。
// 若 db 必填字段未被 schema 声明,该路由在真实调用中**必然 400**。
//
// 这类不一致**无法靠运行测试发现**(只会表现为 400,而 400 本身是合法响应),
// 只能静态比对 —— 这正是本测试的价值。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexSrcRaw = fs.readFileSync(path.join(SERVER_DIR, "index.js"), "utf8");
const dbSrcRaw = fs.readFileSync(path.join(SERVER_DIR, "db.js"), "utf8");

/**
 * 剥掉行注释与块注释后再做静态匹配。
 * ⚠️ 必需:db.js 里为 ISSUE-023 写了"原先 if (!name) throw"这样的**说明性注释**,
 *    不剥注释的话守卫测试会匹配到注释文本,产生**假阳性** ——
 *    代码明明已修好,测试却报"复发"。这类"测试自己有 bug"的情况本轮已遇到多次。
 */
function stripComments(src) {
  // ⚠️ 必须**单次**合并匹配,不能分两步 replace。
  //   分两步时,块注释分支会先扫到「行注释里嵌着的 /*」——
  //   本项目 index.js 就有这么一行:
  //     // ---- 认证中间件(放在健康检查之前,只对 /api/* 生效) ----
  //   其中的 /api/* 被当成块注释起点,一路吞掉后面几千字符的真实代码,
  //   导致守卫报出"未找到该路由"这种**完全错误的结论**。
  //   合并后正则按位置从左到右尝试:在该位置 \/\* 匹配失败,
  //   转而由 \/\/[^\n]* 分支整行消费,把内嵌的 /* 一并吃掉。
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
}
const validateSrcRaw = fs.readFileSync(path.join(SERVER_DIR, "validate.js"), "utf8");
const dbSrc = stripComments(dbSrcRaw);
const indexSrc = stripComments(indexSrcRaw);

/* ---------- 工具:提取 schema 的字段集 ---------- */
function namedSchemaFields(schemaName) {
  const m = new RegExp(`export const ${schemaName} = s\\.object\\(\\{([\\s\\S]*?)\\n\\}\\);`).exec(validateSrcRaw);
  if (!m) return null;
  const fields = new Set();
  for (const line of m[1].split("\n")) {
    const mm = /^\s{2}(\w+):/.exec(line);
    if (mm) fields.add(mm[1]);
  }
  return fields;
}

/** 提取 db 函数体里 `if (!input?.x) throw` / `if (!x) throw` 的必填字段 */
function dbRequiredFields(fnName) {
  const m = new RegExp(`export function ${fnName}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`, "m").exec(dbSrc);
  if (!m) return null;
  const body = m[1];
  const out = new Set();
  for (const mm of body.matchAll(/if\s*\(\s*!input\??\.(\w+)\s*\)\s*throw/g)) out.add(mm[1]);
  for (const mm of body.matchAll(/if\s*\(\s*!(\w+)\s*\)\s*throw/g)) out.add(mm[1]);
  return out;
}

/* ---------- 已修复的两个实例:直接锁定回归 ---------- */

test("ISSUE-018 回归:review 路由 schema 必须声明 overallScore", () => {
  // 若有人把 schema 改回 reviewText/summary/overallRating,该路由会重新变成
  // "任何载荷都写不进去"。这里锁死正确的字段名。
  // 取该路由到**下一个路由注册**之间的整段 —— 不能用固定字符窗口:
  // schema 内有嵌套 s.object(s.array(s.object({...}))),固定窗口会截断。
  const start = indexSrc.indexOf('app.post("/api/sessions/:id/review"');
  assert.ok(start !== -1, "未找到 review 路由");
  const rest = indexSrc.slice(start + 10);
  const next = rest.search(/\napp\.(get|post|put|delete|patch)\(/);
  const block = indexSrc.slice(start, next === -1 ? start + 2000 : start + 10 + next);
  assert.match(block, /\.parse\(req\.body\)/, "review 路由应有 schema 解析");
  assert.match(block, /overallScore/, "review schema 必须声明 overallScore(db 层与表结构都用它)");
  assert.match(block, /strengths/, "review schema 必须声明 strengths(否则会被白名单静默剥离)");
  assert.doesNotMatch(block, /reviewText/, "reviewText 不是表结构里的字段,不应出现在 schema");
  // db 层的必填也必须在 schema 里
  const required = dbRequiredFields("createSessionReview");
  if (required) {
    for (const f of ["overallScore"]) {
      assert.ok(block.includes(f), `createSessionReview 要求 ${f},但路由 schema 未声明`);
    }
  }
});

test("ISSUE-023 回归:updateAgentBasic 不得再要求 name/role 必填", () => {
  const m = /export function updateAgentBasic[\s\S]*?\n\}/.exec(dbSrc);
  assert.ok(m, "未找到 updateAgentBasic");
  const body = m[0];
  assert.doesNotMatch(body, /if\s*\(\s*!name\s*\)\s*throw/,
    "updateAgentBasic 又要求 name 必填 —— 与路由的 .partial() 契约矛盾(ISSUE-023 复发)");
  assert.doesNotMatch(body, /if\s*\(\s*!role\s*\)\s*throw/,
    "updateAgentBasic 又要求 role 必填 —— 与路由的 .partial() 契约矛盾(ISSUE-023 复发)");
  // name/role 必须走 COALESCE,否则传 null 会把字段清空
  assert.match(body, /name = COALESCE\(/, "name 必须用 COALESCE,未传的字段不应被清空");
  assert.match(body, /role = COALESCE\(/, "role 必须用 COALESCE,未传的字段不应被清空");
});

/* ---------- 通用扫描:所有具名 schema 路由 ---------- */

const NAMED_SCHEMA_ROUTES = [
  ["ProviderSchema", "createProvider"],
  ["AgentSchema", "createAgent"],
  ["SessionSchema", "createSession"],
  ["MessageSchema", "addMessage"],
  ["MaterialSchema", "createMaterial"],
  ["EvaluationSchema", "createEvaluation"],
  ["SessionGroupSchema", "createSessionGroup"],
];

test("具名 schema 路由:db 必填字段必须被 schema 声明", () => {
  const problems = [];
  for (const [schemaName, fnName] of NAMED_SCHEMA_ROUTES) {
    const fields = namedSchemaFields(schemaName);
    if (!fields) { problems.push(`${schemaName}: 未在 validate.js 中找到定义`); continue; }
    const required = dbRequiredFields(fnName);
    if (!required) continue;
    for (const f of required) {
      // 排除非请求体的守卫(资源存在性检查等)
      if (["sessionId", "agentId", "providerId", "existing", "agent", "session", "groupId"].includes(f)) continue;
      if (!fields.has(f)) {
        problems.push(`${schemaName} → ${fnName}: db 要求 ${f},但 schema 未声明(会被白名单静默剥离,该路由必然 400)`);
      }
    }
  }
  assert.deepEqual(problems, [], "发现路由 schema 与 db 层的契约不一致:\n  " + problems.join("\n  "));
});

test("`.partial()` 路由调用的 db 函数必须使用 COALESCE 语义", () => {
  // 三个 partial 路由:updateProvider / updateAgentBasic / updateSessionGroup
  const fns = ["updateProvider", "updateAgentBasic", "updateSessionGroup"];
  const problems = [];
  for (const fn of fns) {
    const m = new RegExp(`export function ${fn}[\\s\\S]*?\\n\\}`).exec(dbSrc);
    if (!m) { problems.push(`${fn}: 未找到实现`); continue; }
    // partial 更新意味着字段可不传,实现里就不该有 `x = ?` 形式的无条件赋值
    const unconditional = m[0].match(/\n\s+(\w+) = \?,/g) || [];
    for (const u of unconditional) {
      const col = u.trim().split(" = ")[0];
      problems.push(`${fn}: 列 ${col} 使用了无条件赋值 "= ?",partial 更新时应为 COALESCE(?, ${col})`);
    }
  }
  assert.deepEqual(problems, [], "partial 路由的实现未遵循 COALESCE 语义:\n  " + problems.join("\n  "));
});

test("白名单 schema 的固有风险已被文档化(validate.js 需保留警告注释)", () => {
  // 这类 bug 的根源是白名单 schema 静默剥离字段。任何未来改动都应保留这段警告,
  // 否则后人可能再次误以为"多传字段没关系"。
  assert.match(validateSrcRaw, /白名单式 schema 会静默剥离未声明字段/,
    "validate.js 中应保留「白名单 schema 会静默剥离字段」的警告注释");
});

/* ---------- 第三个实例:ISSUE-025(阶段绑定字段名不匹配)---------- */

test("ISSUE-025 回归:stage-agents schema 必须声明 roleInStage/askMode/sortOrder", () => {
  // 此前 schema 错写成 roleInSession,并漏掉 askMode / sortOrder,
  // 白名单机制把它们全部静默剥离 → saveStageAgents 永远拿 undefined,
  // 角色被强制 primary、askMode 被强制 sequential、顺序被强制 0。
  // 表现:用户切了"同时提问",接口返回 200,但设置毫无作用。
  const start = indexSrc.indexOf('app.put("/api/sessions/:id/stage-agents"');
  assert.ok(start !== -1, "未找到 stage-agents 路由");
  const rest = indexSrc.slice(start + 10);
  const nxt = rest.search(/\n(?:app|router)\.(get|post|put|delete|patch)\(/);
  const block = indexSrc.slice(start, nxt === -1 ? start + 1500 : start + 10 + nxt);

  assert.match(block, /roleInStage/, "schema 必须声明 roleInStage(db 层与表列 role_in_stage 都用它)");
  assert.doesNotMatch(block, /roleInSession/, "roleInSession 不是本接口的字段(那是 addSessionAgent 的)");
  assert.match(block, /askMode/, "schema 必须声明 askMode,否则前端切换提问方式无效");
  assert.match(block, /sortOrder/, "schema 必须声明 sortOrder,否则多 agent 顺序丢失");
  // askMode 的合法取值应与前端 StageAskMode 类型一致
  assert.match(block, /sequential[\s\S]*simultaneous|simultaneous[\s\S]*sequential/,
    "askMode 的枚举应包含前端定义的 sequential / simultaneous");
});

test("ISSUE-025 通用规则:白名单 schema 声明的字段必须在 db 层被真正使用", () => {
  // 反向检查:schema 里出现的字段,db 层若一个都不读,说明该字段是**死字段**
  // (客户端能传、能通过校验,但被静默丢弃)。
  const targets = [
    { schema: 'app.put("/api/sessions/:id/stage-agents"', dbFn: "saveStageAgents" },
    { schema: 'app.post("/api/sessions/:id/agents"', dbFn: "addSessionAgent" },
    { schema: 'app.put("/api/agents/:id/basic"', dbFn: "updateAgentBasic" },
  ];
  const dead = [];
  for (const t of targets) {
    const i = indexSrc.indexOf(t.schema);
    if (i === -1) continue;
    const rest = indexSrc.slice(i + 10);
    const nxt = rest.search(/\n(?:app|router)\.(get|post|put|delete|patch)\(/);
    const block = indexSrc.slice(i, nxt === -1 ? i + 1500 : i + 10 + nxt);
    const declared = new Set();
    for (const line of block.split("\n")) {
      const mm = /^\s{2,4}(\w+):/.exec(line);
      if (mm) declared.add(mm[1]);
    }
    const m2 = new RegExp(`export function ${t.dbFn}[\\s\\S]*?\\n\\}`).exec(dbSrc);
    if (!m2) continue;
    const dbBody = m2[0];
    for (const f of declared) {
      if (["sessionId", "agentId", "providerId", "groupId"].includes(f)) continue;
      if (!new RegExp(`\\b${f}\\b`).test(dbBody)) {
        dead.push(`${t.dbFn}: schema 声明了 ${f},但 db 实现里从未读取 —— 死字段,客户端传了会被静默丢弃`);
      }
    }
  }
  assert.deepEqual(dead, [], "发现白名单 schema 声明但 db 层不读的死字段:\n  " + dead.join("\n  "));
});
