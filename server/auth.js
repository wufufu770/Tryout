// 认证中间件:Bearer Token(单机/小团队场景)
// 设计原则:零依赖、单进程内存校验、支持多 token(主+备用)
// Token 来源(优先级):
//   1. 环境变量 INTERVIEWX_API_TOKEN(多个用逗号分隔)
//   2. 本地文件 data/.api_token(自动生成,首次启动打印到日志)
//   3. INTERVIEWX_AUTH_DISABLED=1 时完全跳过认证(仅本地开发用)
//
// 豁免策略(2026-07 修订):
//   - 完全豁免:/api/health
//   - GET 浏览免认证(只读列表,无 PII):providers/experiences/question-bank/evaluations/flow-templates/integration/stats/analysis
//   - 子路径(如 /sessions/:id/messages、/materials/:id/content、/evaluations/:id)需认证,防 IDOR
//   - 写操作(POST/PUT/DELETE/chat)仍需 token
// v10.2.5(P1):移除 /agents /sessions /materials /session-groups 的 GET 豁免
//   原因:agents 列表含 promptTemplate,sessions/materials/session-groups 列表含标题/摘要等 PII
//   未认证用户可直接 GET 拉取这些数据,构成 PII 泄露
// 安全提示:生产环境务必通过环境变量注入 token,不要依赖文件

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DB_DIR } from "./paths.js";

// ⚠️ R23(ISSUE-052):原先同样是 `process.env.DB_DIR || process.cwd()` ——
//   与 crypto.js 的 ISSUE-051 **完全同构**的第三例。
//   `npm start` 不设 DB_DIR 时,token 会落到 <cwd>/.api_token,而数据库在
//   <cwd>/data/。后果:日后有人设了 DB_DIR,服务端就会读**另一个** token 文件,
//   此前所有客户端立刻 401「认证 token 无效」;且备份 data/ 也不含 token。
//   本机已实测到两个 token 文件并存(server/data/.api_token 与 server/.api_token)。
//   现统一从 paths.js 取值。
const TOKEN_FILE = path.join(DB_DIR, ".api_token");
const EXEMPT_PATHS = new Set(["/api/health"]);

// v10:GET 浏览免认证"精确路径"集合(只读列表接口,不涉及敏感数据/资源消耗)
// 安全原则:只豁免列表 GET,不豁免子路径,防止 IDOR
// (例:/sessions 豁免,但 /sessions/:id/messages 不豁免,避免未授权读取他人会话消息)
// 注意:authMiddleware 通过 app.use("/api", ...) 挂载,Express 会自动剥离 /api 前缀,
// 因此这里的 path 应使用剥离 /api 后的路径(如 /agents 而非 /api/agents)
//
// ISSUE-003b(2026-10-04 自主测试循环发现):此前此处有 7 条,其中 5 条是**死条目** ——
// /experiences、/question-bank(实际路由为 /questionbank)、/flow-templates、
// /integration、/stats(实际为 /questionbank/stats)均无任何对应路由,
// 是历史改名(路由改名/重排)后未同步留下的,豁免形同虚设却仍在白名单里,
// 掩盖了白名单的真实状态。已清理,仅保留确实存在的路径。
// 回归保护:scripts/e2e-auth-routes.mjs 的 E 组会自动扫描路由表,
// 一旦白名单里出现无对应路由的条目即失败,防止再次漂移。
const GET_EXEMPT_EXACT_PATHS = new Set([
  "/evaluations",       // 该路径仅注册了 POST;GET 豁免当前不生效,保留以免行为变化
  "/analysis/weakness", // 聚合接口,无 PII。⚠️ 见 ISSUE-003:实际会泄露 recentScores[].sessionId,待产品决策
]);

let validTokens = null;

function loadTokens() {
  if (validTokens) return validTokens;
  // 0. 显式禁用认证(仅开发)
  if (process.env.INTERVIEWX_AUTH_DISABLED === "1") {
    // v10:生产环境禁止禁用认证(fail-fast,防止误配置导致裸奔)
    if (process.env.NODE_ENV === "production") {
      throw new Error("[auth] 生产环境(NODE_ENV=production)禁止禁用认证(INTERVIEWX_AUTH_DISABLED=1)");
    }
    console.warn("[auth] 认证已禁用(INTERVIEWX_AUTH_DISABLED=1),仅适合本地开发");
    validTokens = null; // null 表示禁用
    return null;
  }
  const tokens = new Set();
  // 1. 环境变量
  const env = process.env.INTERVIEWX_API_TOKEN;
  if (env) {
    env.split(",").map(s => s.trim()).filter(Boolean).forEach(t => tokens.add(t));
  }
  // 2. 本地文件
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const raw = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
      raw.split(",").map(s => s.trim()).filter(Boolean).forEach(t => tokens.add(t));
    } else if (tokens.size === 0) {
      // 首次启动:生成 token 并写入文件,只打印路径不打印 token 本身(避免日志泄漏)
      const newToken = crypto.randomBytes(24).toString("hex");
      fs.writeFileSync(TOKEN_FILE, newToken, { mode: 0o600 });
      console.warn(`[auth] 已生成访问 token 并保存到 ${TOKEN_FILE}`);
      console.warn(`[auth] 前端可在 Settings 页查看 token,或设置 INTERVIEWX_AUTH_DISABLED=1 禁用认证`);
      tokens.add(newToken);
    }
  } catch (e) {
    console.warn(`[auth] 无法持久化 token(${e.message}),使用进程内随机 token`);
    if (tokens.size === 0) {
      const t = crypto.randomBytes(24).toString("hex");
      tokens.add(t);
    }
  }
  validTokens = tokens;
  return tokens;
}

// 常量时间字符串比较(防时序攻击)
function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // v10.2.5(P2-2):长度不一致时仍执行一次比较(与自身),消耗等量时间防时序侧信道
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// 判断是否为 GET 浏览免认证路径(仅精确匹配,不豁免子路径,防 IDOR)
function isGetExempt(req) {
  if (req.method !== "GET") return false;
  // 仅精确路径匹配,子路径(如 /sessions/:id/messages)不豁免
  return GET_EXEMPT_EXACT_PATHS.has(req.path);
}

// Express 中间件
export function authMiddleware(req, res, next) {
  const tokens = loadTokens();
  // tokens === null 表示认证被禁用
  if (tokens === null) return next();
  // 完全豁免路径
  if (EXEMPT_PATHS.has(req.path)) return next();
  // GET 浏览免认证(只读接口)
  if (isGetExempt(req)) return next();

  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: "未提供认证 token", code: "AUTH_MISSING" });
  }
  const token = m[1].trim();
  // 任一 token 匹配即通过
  for (const t of tokens) {
    if (safeEqual(token, t)) return next();
  }
  return res.status(401).json({ error: "认证 token 无效", code: "AUTH_INVALID" });
}

// 供前端使用的辅助:返回当前是否有 token(不泄露 token 本身)
export function isAuthEnabled() {
  return loadTokens() !== null;
}
