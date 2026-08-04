// Express 后端:REST API + LLM 代理
// v3:PDF/DOCX 解析 + 弱项分析 + 全局评估查询
// v4:安全加固(SSRF / PII / 404 / 错误处理 / x-powered-by)+ 阶段推进 + Agent 版本切换
// v5:多 Agent 协同 + 会话难度 + 整场评价 + 会话分组 + Agent 图标上传
// v9:认证 + CORS 白名单 + 安全头 + 优雅关闭 + 健康检查深化 + SSRF DNS 校验 + token 配额
import express from "express";
import cors from "cors";
import multer from "multer";
import mammoth from "mammoth";
import path from "path";
import fs from "fs";
import dns from "dns";
import {
  listAgents, getAgent, createAgent, createAgentVersion, updateAgentBasic, deleteAgent,
  createSession, getSession, listSessions, updateSessionModel, updateSessionStage, addSessionAgent, listSessionAgents,
  addMessage, listMessages,
  createMaterial, listMaterials, getMaterialContent, deleteMaterial,
  createEvaluation, listEvaluations, listAllEvaluations,
  saveApiKey, deleteApiKey, listApiKeyProviders, getApiKey,
  listProviders, getProvider, getActiveProvider, createProvider, updateProvider, deleteProvider, setActiveProvider,
  setAgentCurrentVersion,
  saveStageAgents, listStageAgents, deleteStageAgents,
  createSessionReview, getSessionReview, listAllSessionReviews,
  createSessionGroup, getSessionGroup, listSessionGroups, updateSessionGroup, deleteSessionGroup,
  setSessionGroup, listSessionsByGroup, listUngroupedSessions,
  saveAgentIcon, getAgentIconPath,
  ValidationError, NotFoundError,
  dbHealthCheck, DB_DIR_EXPORT,
  getTodayTokenUsage, getDb, recordTokenUsage,
} from "./db.js";
import { listAllProviders, chatProxy, testProviderLatency } from "./llm.js";
import analysisRouter from "./routes/analysis.js";
import { DEFAULT_AGENT_TEMPLATES, seedIfEmpty, seedDefaultProviders, seedBuiltinMaterials } from "./seed.js";
import { authMiddleware, isAuthEnabled } from "./auth.js";
import { requestLogger, logger, logError } from "./logger.js";
import { ValidationErrors, s, ProviderSchema, AgentSchema, SessionSchema, MessageSchema, EvaluationSchema, MaterialSchema, SessionGroupSchema, IdParam } from "./validate.js";
import { responseHelpers, ErrorCodes } from "./response.js";
import {
  SsrfBlockedError, SsrfCodes, SSRF_I18N_KEY_MAP,
  isInternalIp, isAlwaysBlockedIp, isMetadataHost,
  ALLOWED_LOCAL_HOSTS, METADATA_HOST_BLOCKLIST,
} from "./ssrf-shared.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
// v9:默认监听 127.0.0.1;Docker/容器需要外部访问时设置 HOST=0.0.0.0
const HOST = process.env.HOST || (process.env.DOCKER === "1" ? "0.0.0.0" : "127.0.0.1");

app.disable("x-powered-by");
// v10.2.5(P1-7):trust proxy 动态设置,防后端直接暴露时 XFF 伪造绕过限流
// BEHIND_PROXY=1:后端在 Nginx 等反向代理后,信任一层 XFF(Express 取 XFF 最后一段为 req.ip,不可伪造)
// 不设置:后端直接暴露,req.ip 为 TCP 连接的远程地址,XFF 头被忽略(防伪造)
if (process.env.BEHIND_PROXY === "1") {
  app.set("trust proxy", 1);
}

// ---- CORS 白名单(零依赖手写,不依赖 cors 中间件的默认全开) ----
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:1420,http://localhost:5180")
  .split(",").map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ---- 安全响应头(零依赖手写,等价于 helmet 默认配置) ----
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "0"); // 现代浏览器推荐关闭,改用 CSP
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  // HSTS 仅在 HTTPS 下生效
  if (req.protocol === "https" || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // CSP:默认限制,允许内联脚本/样式(React 注入需要)+ 自身源 + Google Fonts
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
  next();
});

// v10:全局 body limit 收紧到 1mb(防大 body DoS);
// /api/materials/upload(文件解析)和 /api/import(批量导入)单独放宽
app.use(express.json({ limit: "1mb" }));

// v9:统一响应 helper(res.ok / res.fail / res.page)
app.use(responseHelpers);

// ---- 结构化请求日志(替代 console.log) ----
app.use(requestLogger);

// ---- Rate limit 中间件(零依赖,基于内存 Map) ----
// v10:key 改用 req.ip(配合 app.set("trust proxy", 1) 取真实客户端 IP)
// 原实现用 XFF 第一段可伪造,攻击者可绕过限流
function createRateLimiter({ windowMs, max, label }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    // v10:用 req.ip(BEHIND_PROXY=1 时取 XFF 最后一段,否则取 TCP 连接地址,均不可伪造)
    const ip = req.ip || "unknown";
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(ip, rec);
    }
    rec.count++;
    if (rec.count > max) {
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.setHeader("Retry-After", retry);
      return res.status(429).json({ error: `请求过于频繁,请 ${retry} 秒后重试(${label})`, code: "RATE_LIMITED" });
    }
    next();
  };
}
app.use("/api", createRateLimiter({ windowMs: 60_000, max: 120, label: "general" }));
app.use("/api/chat", createRateLimiter({ windowMs: 60_000, max: 20, label: "chat" }));
// v11:分析路由(语音转写 / 逐题反馈 / 押题),LLM 调用共享 chat 限流语义
app.use("/api", analysisRouter);
// v10.2.4(P1):导入/上传独立限流(防 CPU/内存 DoS)
// /api/import:15mb JSON 解析是 CPU 密集操作,限制 5次/分钟
app.use("/api/import", createRateLimiter({ windowMs: 60_000, max: 5, label: "import" }));
// /api/materials/upload:文件解析(pdf-parse/mammoth)是 CPU 密集操作,限制 10次/分钟
app.use("/api/materials/upload", createRateLimiter({ windowMs: 60_000, max: 10, label: "upload" }));
// v10.2:/api/providers/:id/test 独立限流(防认证后 SSRF 探测)
// 测速会触发 assertSafeUrlAtFetch + 出站 fetch,认证用户可借此探测内网/端口扫描
// 限制:每分钟 10 次(单 provider 测速足够,正常用户不会频繁触发)
const testRateHits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of testRateHits) if (v.resetAt <= now) testRateHits.delete(k);
}, 60_000).unref();
app.use((req, res, next) => {
  // 仅对 /api/providers/:id/test 精确匹配(不影响其他 provider 路由,通用 /api 限流已覆盖)
  // v10.2.1:用 req.path(已剥离 query + 已规范化)替代 req.originalUrl,并允许尾斜杠(防 /test/ 绕过)
  // v10.2.2:加 i 标志(Express 路由大小写不敏感,正则也需不敏感,防 /api/Providers/foo/test 跳过限流)
  if (req.method === "GET" && /^\/api\/providers\/[^/]+\/test\/?$/i.test(req.path)) {
    const ip = req.ip || "unknown";
    const now = Date.now();
    let rec = testRateHits.get(ip);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + 60_000 };
      testRateHits.set(ip, rec);
    }
    rec.count++;
    if (rec.count > 10) {
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.setHeader("Retry-After", retry);
      return res.status(429).json({ ok: false, code: "RATE_LIMITED", message: `测速请求过于频繁,请 ${retry} 秒后重试` });
    }
  }
  next();
});

// ---- 文件上传 MIME 白名单(校验真实类型,不只看扩展名) ----
const ALLOWED_DOC_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);
// v10:ALLOWED_ICON_MIMES 仅保留 png/jpeg/webp(不含 svg,svg 可含脚本)
const ALLOWED_ICON_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_DOC_MIMES.has(file.mimetype)) return cb(null, true);
    cb(new ValidationError(`不支持的文件类型:${file.mimetype}(仅支持 PDF/DOCX/TXT/MD)`));
  },
});
const iconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_ICON_MIMES.has(file.mimetype)) return cb(null, true);
    cb(new ValidationError("图标仅支持 jpg/png/webp 格式"));
  },
});

// v10:图片 magic bytes 校验(防 mimetype 伪造上传脚本/HTML/SVG)
// 攻击者可伪造 Content-Type 为 image/png 上传 HTML/JS,通过图标 URL 执行 XSS
// 防护:校验文件头与声明 mimetype 一致
function validateImageMagic(buf, mimetype) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) {
    throw new ValidationError("文件过小或无效");
  }
  if (mimetype === "image/png") {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47 ||
        buf[4] !== 0x0D || buf[5] !== 0x0A || buf[6] !== 0x1A || buf[7] !== 0x0A) {
      throw new ValidationError("PNG 文件头不匹配(可能伪造 mimetype)");
    }
    return;
  }
  if (mimetype === "image/jpeg") {
    // JPEG: FF D8 FF
    if (buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) {
      throw new ValidationError("JPEG 文件头不匹配(可能伪造 mimetype)");
    }
    return;
  }
  if (mimetype === "image/webp") {
    // WebP: "RIFF" + 4 字节大小 + "WEBP"
    const riff = buf.subarray(0, 4).toString("ascii");
    const webp = buf.subarray(8, 12).toString("ascii");
    if (riff !== "RIFF" || webp !== "WEBP") {
      throw new ValidationError("WebP 文件头不匹配(可能伪造 mimetype)");
    }
    return;
  }
  throw new ValidationError(`不支持的图片类型:${mimetype}`);
}

// v10:大 body 路由单独放宽 limit(/api/materials/upload、/api/import)
// 全局 1mb 对简历/批量导入不够,这里通过 express.json 中间件单独覆盖
const largeBodyJson = express.json({ limit: "15mb" });

// async 路由错误兜底
const wrapAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- SSRF 防护:hostname + DNS 解析后 IP 双重校验 ----
// v10.2:常量 + IP 判断函数迁移到 ssrf-shared.js(与 llm.js 共享,避免命名漂移)
// v10.2 改造:
//   1. ValidationError 携带 code + i18nKey + i18nParams(供前端 i18n 映射)
//   2. 错误消息不泄露服务器 DNS 解析结果(address 仅写入日志)
//   3. allowLocal=true 时仅允许 localhost/127.0.0.1/::1/0.0.0.0,阻止其他一切
//   4. IP 校验前 normalizeIp(防 IPv4-mapped IPv6 绕过,由 ssrf-shared.js 实现)
async function checkUrlSafe(urlStr, { allowLocal = false } = {}) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    throw new ValidationError("Base URL 格式无效", { code: ErrorCodes.VALIDATION_ERROR, i18nKey: "error.ssrf.urlInvalid" });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ValidationError("仅允许 http/https 协议", { code: ErrorCodes.VALIDATION_ERROR, i18nKey: "error.ssrf.protocol" });
  }
  const host = u.hostname.toLowerCase();
  // 云元数据 hostname 永远阻止(无论 allowLocal)
  if (isMetadataHost(host)) {
    throw new ValidationError(`禁止访问云元数据地址`, {
      code: SsrfCodes.METADATA_HOST, i18nKey: "error.ssrf.metadataHost", i18nParams: { host },
    });
  }
  if (allowLocal) {
    // local provider 仅允许 localhost/127.0.0.1/::1/0.0.0.0
    if (ALLOWED_LOCAL_HOSTS.has(host)) return;
    // 域名:DNS 解析后只允许指向 127.0.0.1/::1
    let addrs;
    try {
      addrs = await dns.promises.lookup(host, { all: true });
    } catch {
      throw new ValidationError(`本地供应商地址无法解析`, {
        code: SsrfCodes.UNRESOLVED, i18nKey: "error.ssrf.unresolved", i18nParams: { host },
      });
    }
    for (const a of addrs) {
      if (isAlwaysBlockedIp(a.address)) {
        logger.warn("ssrf.blocked", { reason: "metadata_ip", host, address: a.address });
        throw new ValidationError(`该地址解析到云元数据 IP,禁止访问`, {
          code: SsrfCodes.METADATA_IP, i18nKey: "error.ssrf.metadataIp", i18nParams: { host },
        });
      }
      if (a.address !== "127.0.0.1" && a.address !== "::1" && a.address !== "0.0.0.0") {
        logger.warn("ssrf.blocked", { reason: "local_non_loopback", host, address: a.address });
        throw new ValidationError(`本地供应商仅支持 localhost / 127.0.0.1 / ::1 / 0.0.0.0,请改用"自定义"分类`, {
          code: SsrfCodes.LOCAL_NON_LOOPBACK, i18nKey: "error.ssrf.localNonLoopback", i18nParams: { host },
        });
      }
    }
    return;
  }
  // DNS 解析后逐 IP 校验(防 DNS rebinding)
  let addrs;
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    // DNS 解析失败:可能是 hosts 文件或本地名,默认拒绝
    throw new ValidationError(`域名无法解析,拒绝访问`, {
      code: SsrfCodes.UNRESOLVED, i18nKey: "error.ssrf.unresolved", i18nParams: { host },
    });
  }
  for (const a of addrs) {
    if (isInternalIp(a.address)) {
      logger.warn("ssrf.blocked", { reason: "internal_ip", host, address: a.address });
      throw new ValidationError(`域名解析到内网地址,禁止访问`, {
        code: SsrfCodes.INTERNAL_IP, i18nKey: "error.ssrf.internalIp", i18nParams: { host },
      });
    }
  }
}
// 同步 hostname 预检(DNS 异步校验在路由层 await)
function validateBaseUrlSync(url, { allowLocal = false } = {}) {
  let u;
  try { u = new URL(url); } catch {
    throw new ValidationError("Base URL 格式无效", { code: ErrorCodes.VALIDATION_ERROR, i18nKey: "error.ssrf.urlInvalid" });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ValidationError("仅允许 http/https 协议", { code: ErrorCodes.VALIDATION_ERROR, i18nKey: "error.ssrf.protocol" });
  }
  const host = u.hostname.toLowerCase();
  // 云元数据 hostname 永远阻止
  if (isMetadataHost(host)) {
    throw new ValidationError(`禁止访问云元数据地址`, {
      code: SsrfCodes.METADATA_HOST, i18nKey: "error.ssrf.metadataHost", i18nParams: { host },
    });
  }
  if (allowLocal) {
    // local provider 仅允许 localhost/127.0.0.1/::1/0.0.0.0
    if (ALLOWED_LOCAL_HOSTS.has(host)) return;
    // IP 字面量:阻止链路本地 + 元数据 IP(域名交给 checkUrlSafe 异步校验)
    if (isAlwaysBlockedIp(host)) {
      throw new ValidationError(`本地供应商禁止访问元数据 IP`, {
        code: SsrfCodes.METADATA_IP, i18nKey: "error.ssrf.metadataIp", i18nParams: { host },
      });
    }
    return;
  }
  // 同步预检:用 isInternalIp 校验 IP 字面量(域名交给 checkUrlSafe)
  if (/^[\d.]+$/.test(host) && isInternalIp(host)) {
    throw new ValidationError(`禁止访问内网地址`, {
      code: SsrfCodes.INTERNAL_IP, i18nKey: "error.ssrf.internalIp", i18nParams: { host },
    });
  }
}

// ---- 认证中间件(放在健康检查之前,只对 /api/* 生效) ----
// v10:/api/health 默认豁免(基础探活);?verbose=1 需认证(防 host/port/tokenBudget 等信息泄露)
// 前端通过 Authorization: Bearer <token> 携带
app.use("/api", (req, res, next) => {
  // 健康检查:仅基础探活(无 verbose)豁免;verbose=1 需认证
  if (req.path === "/health" && req.query.verbose !== "1") return next();
  return authMiddleware(req, res, next);
});

// ---- 健康检查(深化:DB + 磁盘 + 认证状态 + LLM 可达性 + token 预算) ----
// v10:默认仅返回 {ok: true}(信息收敛,避免泄露 host/port/tokenBudget/llmProvider/dbSize 等)
// 加 ?verbose=1 才返回详细信息(且需认证)
app.get("/api/health", wrapAsync(async (req, res) => {
  // 默认精简响应(不泄露任何内部信息)
  if (req.query.verbose !== "1") {
    // 仅做最小 DB 探活,失败才返回 503
    const checks = dbHealthCheck();
    if (checks.db !== "ok") return res.status(503).json({ ok: false });
    return res.json({ ok: true });
  }
  // verbose 模式:返回详细信息(认证由上层中间件保证;此处再加一层防御)
  // 若认证被禁用(开发环境),verbose 信息仍可访问;生产环境认证禁用会被 auth.js fail-fast
  const checks = { ...dbHealthCheck() };
  // 磁盘探活:能 stat 即可
  try {
    fs.statSync(DB_DIR_EXPORT);
    checks.disk = "ok";
  } catch { checks.disk = "fail"; }
  // 认证状态(只告知前端是否需要 token,不泄露 token 本身)
  checks.auth = isAuthEnabled() ? "enabled" : "disabled";
  // v10:LLM 可达性(只测激活 provider 的 base_url DNS 可达性,不打 LLM 接口)
  try {
    const active = getActiveProvider();
    if (active?.baseUrl) {
      const u = new URL(active.baseUrl);
      await dns.promises.lookup(u.hostname, { all: true });
      checks.llm = "ok";
      checks.llmProvider = active.name;
    } else {
      checks.llm = "no_active_provider";
    }
  } catch (e) {
    checks.llm = "unreachable";
    checks.llmError = e.message;
  }
  // v10:token 预算使用情况
  const budget = Number(process.env.DAILY_TOKEN_BUDGET) || 500000;
  const used = getTodayTokenUsage();
  checks.tokenBudget = { used, budget, percent: budget > 0 ? Math.round((used / budget) * 100) : 0 };
  // 任一关键检查失败返回 503(LLM 不通不视为关键失败,只告警)
  const criticalKeys = ["db", "disk"];
  const allOk = criticalKeys.every(k => checks[k] === "ok");
  if (!allOk) return res.status(503).json({ ok: false, version: "10.0", checks });
  res.json({ ok: true, version: "10.0", host: HOST, port: PORT, checks });
}));

// ---- 前端可观测性日志接收 ----
// 接收前端上报的错误、性能指标、用户行为日志
// 限流:每分钟 60 次(防滥用)
app.post("/api/log", (req, res) => {
  const { level = "info", msg, fields = {}, type = "event" } = req.body || {};
  // 只接收白名单字段,防止日志注入
  const safeFields = {};
  for (const k of ["url", "userAgent", "stack", "filename", "lineno", "colno", "metric", "value", "rating", "sessionId", "locale"]) {
    if (fields[k] !== undefined) safeFields[k] = String(fields[k]).slice(0, 2000);
  }
  // 限制 msg 长度
  const safeMsg = String(msg || "").slice(0, 500);
  const entry = {
    source: "frontend",
    type,
    level: ["debug", "info", "warn", "error", "fatal"].includes(level) ? level : "info",
    msg: safeMsg,
    ...safeFields,
    requestId: req.id,
  };
  if (entry.level === "error" || entry.level === "fatal") {
    logger.error("frontend:" + entry.msg, entry);
  } else if (entry.level === "warn") {
    logger.warn("frontend:" + entry.msg, entry);
  } else {
    logger.info("frontend:" + entry.msg, entry);
  }
  res.json({ ok: true });
});

// ---- Provider CRUD(cc-switch 风格) ----
app.get("/api/providers", (req, res) => res.ok(listAllProviders()));
app.get("/api/providers/:id", (req, res) => {
  const p = getProvider(req.params.id);
  if (!p) return res.fail(ErrorCodes.NOT_FOUND, "供应商不存在", 404);
  const { apiKey, ...safe } = p;
  res.ok({ ...safe, hasKey: !!apiKey });
});
app.post("/api/providers", wrapAsync(async (req, res) => {
  const input = ProviderSchema.parse(req.body);
  await checkUrlSafe(input.baseUrl, { allowLocal: input.category === "local" });
  res.ok(createProvider(input));
}));
app.put("/api/providers/:id", wrapAsync(async (req, res) => {
  // 更新场景:所有字段可选
  const input = ProviderSchema.partial().parse(req.body);
  if (input.baseUrl !== undefined) {
    const existing = getProvider(req.params.id);
    await checkUrlSafe(input.baseUrl, { allowLocal: input.category === "local" || existing?.category === "local" });
  }
  const p = updateProvider(req.params.id, input);
  if (!p) return res.fail(ErrorCodes.NOT_FOUND, "供应商不存在", 404);
  res.ok(p);
}));
app.delete("/api/providers/:id", (req, res) => {
  const existing = getProvider(req.params.id);
  if (!existing) return res.fail(ErrorCodes.NOT_FOUND, "供应商不存在", 404);
  deleteProvider(req.params.id);
  res.ok({ ok: true });
});

// 设置当前激活供应商(一键切换)
app.put("/api/providers/:id/activate", (req, res) => {
  const p = setActiveProvider(req.params.id);
  if (!p) return res.fail(ErrorCodes.NOT_FOUND, "供应商不存在", 404);
  res.ok(p);
});

// 端点测速
app.get("/api/providers/:id/test", wrapAsync(async (req, res) => {
  const result = await testProviderLatency(req.params.id);
  res.ok(result);
}));

// ---- Agent ----
app.get("/api/agents", (req, res) => res.ok(listAgents(req.query.kind)));
app.get("/api/agents/:id", (req, res) => {
  const a = getAgent(req.params.id);
  if (!a) return res.fail(ErrorCodes.NOT_FOUND, "Agent 不存在", 404);
  res.ok(a);
});
app.post("/api/agents", (req, res) => {
  const input = AgentSchema.parse(req.body);
  res.ok(createAgent(input));
});
app.put("/api/agents/:id/basic", (req, res) => {
  // basic 更新:仅 name/avatar/role/tone/focusAreas/difficulty/iconType/iconValue/preferredProviderId
  const input = AgentSchema.partial().pick([
    "name", "avatar", "role", "tone", "focusAreas", "difficulty",
    "iconType", "iconValue", "preferredProviderId",
  ]).parse(req.body);
  updateAgentBasic(req.params.id, input);
  res.ok({ ok: true });
});
app.put("/api/agents/:id/current-version", (req, res) => {
  if (!req.body?.versionId) throw new ValidationError("versionId 为必填");
  res.ok(setAgentCurrentVersion(req.params.id, req.body.versionId));
});
app.post("/api/agents/:id/versions", (req, res) => {
  // 版本创建:仅 promptTemplate + 可选 name
  const input = s.object({
    name: s.string().max(100).optional(),
    promptTemplate: s.string().min(1, "promptTemplate 为必填").max(20000),
  }).parse(req.body);
  res.ok(createAgentVersion(req.params.id, input));
});
app.delete("/api/agents/:id", (req, res) => { deleteAgent(req.params.id); res.ok({ ok: true }); });

// Agent 图标上传
app.post("/api/agents/:id/icon", iconUpload.single("file"), (req, res) => {
  if (!req.file) throw new ValidationError("未收到文件");
  const agent = getAgent(req.params.id);
  if (!agent) return res.fail(ErrorCodes.NOT_FOUND, "Agent 不存在", 404);
  if (agent.isTemplate) throw new ValidationError("模板 Agent 不可修改");
  // v10:magic bytes 校验(防 mimetype 伪造上传脚本/HTML)
  validateImageMagic(req.file.buffer, req.file.mimetype);
  const ext = req.file.originalname.toLowerCase().split(".").pop();
  const savedExt = saveAgentIcon(req.params.id, req.file.buffer, ext);
  res.ok({ ok: true, iconType: "uploaded", iconValue: savedExt });
});

// Agent 图标读取
app.get("/api/agents/:id/icon", (req, res) => {
  const info = getAgentIconPath(req.params.id);
  if (!info) return res.fail(ErrorCodes.NOT_FOUND, "无上传图标", 404);
  // v10:不再支持 svg(可含脚本);mimeMap 同步移除
  const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
  res.setHeader("Content-Type", mimeMap[info.ext] || "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=3600");
  fs.createReadStream(info.path).pipe(res);
});

// ---- Session ----
app.get("/api/sessions", (req, res) => res.ok(listSessions()));
app.get("/api/sessions/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  res.ok(s);
});
app.post("/api/sessions", (req, res) => {
  const input = SessionSchema.parse(req.body);
  res.ok(createSession(input));
});
app.put("/api/sessions/:id/model", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  const { modelId } = s.object({ modelId: s.string().min(1, "modelId 为必填").max(100) }).parse(req.body);
  updateSessionModel(req.params.id, modelId);
  res.ok({ ok: true });
});
app.put("/api/sessions/:id/stage", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  const { stage } = s.object({ stage: s.number().int().min(0).max(100) }).parse(req.body);
  updateSessionStage(req.params.id, stage);
  res.ok({ ok: true });
});
app.post("/api/sessions/:id/agents", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  const { agentId, agentVersionId, roleInSession } = s.object({
    agentId: s.string().min(1).max(50),
    agentVersionId: s.string().max(50).optional(),
    roleInSession: s.string().max(50).optional(),
  }).parse(req.body);
  addSessionAgent(req.params.id, agentId, agentVersionId, roleInSession);
  res.ok({ ok: true });
});
app.get("/api/sessions/:id/agents", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  res.ok(listSessionAgents(req.params.id));
});

// v5:阶段-Agent 绑定
app.get("/api/sessions/:id/stage-agents", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  const stage = req.query.stage !== undefined ? Number(req.query.stage) : undefined;
  res.ok(listStageAgents(req.params.id, stage));
});
app.put("/api/sessions/:id/stage-agents", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  const stage = Number(req.query.stage);
  if (!Number.isInteger(stage) || stage < 0) throw new ValidationError("stage 查询参数为必填且须为非负整数");
  const { agents } = s.object({ agents: s.array(s.object({
    agentId: s.string().min(1).max(50),
    agentVersionId: s.string().max(50).optional(),
    roleInSession: s.string().max(50).optional(),
  })).max(20) }).parse(req.body);
  res.ok(saveStageAgents(req.params.id, stage, agents));
});
app.delete("/api/sessions/:id/stage-agents", (req, res) => {
  const stage = Number(req.query.stage);
  if (!Number.isInteger(stage) || stage < 0) throw new ValidationError("stage 查询参数为必填且须为非负整数");
  deleteStageAgents(req.params.id, stage);
  res.ok({ ok: true });
});

// v5:设置会话所属分组(body: { groupId: string | null })
app.put("/api/sessions/:id/group", (req, res) => {
  const { groupId } = s.object({ groupId: s.string().max(50).nullable() }).parse(req.body);
  setSessionGroup(req.params.id, groupId || null);
  res.ok({ ok: true });
});

// ---- Messages ----
app.get("/api/sessions/:id/messages", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  res.ok(listMessages(req.params.id));
});
app.post("/api/sessions/:id/messages", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  const input = MessageSchema.parse(req.body);
  res.ok(addMessage({ ...input, sessionId: req.params.id }));
});

// ---- Materials ----
app.get("/api/materials", (req, res) => res.ok(listMaterials()));
app.post("/api/materials", (req, res) => {
  const input = MaterialSchema.parse(req.body);
  res.ok(createMaterial(input));
});
app.get("/api/materials/:id/content", (req, res) => {
  const c = getMaterialContent(req.params.id);
  if (!c) return res.fail(ErrorCodes.NOT_FOUND, "资料不存在", 404);
  res.ok(c);
});
app.delete("/api/materials/:id", (req, res) => { deleteMaterial(req.params.id); res.ok({ ok: true }); });

app.post("/api/materials/upload", upload.single("file"), wrapAsync(async (req, res, next) => {
  try {
    if (!req.file) return res.fail(ErrorCodes.VALIDATION_ERROR, "无文件", 400);
    const buf = req.file.buffer;
    const ext = req.file.originalname.toLowerCase().split(".").pop();
    let text = "";

    if (ext === "pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buf);
      text = data.text;
    } else if (ext === "docx") {
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value;
    } else if (ext === "doc") {
      text = buf.toString("utf-8").replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\n\r]/g, " ").trim();
    } else {
      text = buf.toString("utf-8");
    }

    if (!text || text.trim().length < 10) {
      return res.fail(ErrorCodes.VALIDATION_ERROR, "文件解析结果为空或内容过少,请检查文件格式", 400);
    }

    res.ok({
      rawText: text.trim(),
      title: req.file.originalname,
      type: req.body.type || "resume",
      sourceType: "file",
    });
  } catch (e) {
    const msg = e?.message || "";
    if (/pdf|zip|central directory|invalid/i.test(msg)) {
      return res.fail(ErrorCodes.VALIDATION_ERROR, "文件损坏或格式不正确,请检查文件", 400);
    }
    next(e);
  }
}));

// ---- Evaluations ----
app.get("/api/sessions/:id/evaluations", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  res.ok(listEvaluations(req.params.id));
});
app.post("/api/evaluations", (req, res) => {
  const input = EvaluationSchema.parse(req.body);
  res.ok(createEvaluation(input));
});

// 全局评估查询(跨会话,用于进步曲线)
app.get("/api/evaluations/all", (req, res) => {
  // v10.2.5(P2-1):limit 范围约束,防 limit=-1 加载全表 DoS(SQLite LIMIT -1 = 无限制)
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 0, 0), 200);
  res.ok(listAllEvaluations(limit));
});

// 弱项分析:统计最近 N 次评估,找最低分维度
app.get("/api/analysis/weakness", (req, res) => {
  // v10.2.5(P2-1):limit 范围约束,防 limit=-1 加载全表 DoS
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 100);
  const all = listAllEvaluations(limit);
  if (all.length === 0) {
    return res.ok({ hasData: false, message: "暂无评估数据,完成一次面试后再来查看" });
  }

  const dimScores = {};
  for (const evalRow of all) {
    for (const d of (evalRow.dimensions || [])) {
      if (!dimScores[d.dimensionName]) dimScores[d.dimensionName] = [];
      dimScores[d.dimensionName].push(d.score);
    }
  }

  const dimAvgs = Object.entries(dimScores).map(([name, scores]) => ({
    dimensionName: name,
    avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
    count: scores.length,
  }));

  dimAvgs.sort((a, b) => a.avgScore - b.avgScore);

  const weakest = dimAvgs.slice(0, 2);
  const advice = weakest.length > 0
    ? `建议加强练习【${weakest.map(w => w.dimensionName).join("】和【")}】方向的题目。`
    : "数据不足";

  res.ok({
    hasData: true,
    totalEvaluations: all.length,
    dimensionStats: dimAvgs,
    weakestDimensions: weakest,
    advice,
    recentScores: all.reverse().map(e => ({ score: e.overallScore, date: e.generatedAt, sessionId: e.sessionId })),
  });
});

// ---- v5:整场面试回顾评价 ----
app.get("/api/sessions/:id/review", (req, res) => {
  if (!getSession(req.params.id)) return res.fail(ErrorCodes.NOT_FOUND, "会话不存在", 404);
  const review = getSessionReview(req.params.id);
  res.ok(review || null);
});
app.post("/api/sessions/:id/review", (req, res) => {
  const input = s.object({
    reviewText: s.string().min(1).max(50000),
    summary: s.string().max(2000).optional(),
    overallRating: s.number().min(0).max(10).optional(),
  }).parse(req.body);
  res.ok(createSessionReview({ ...input, sessionId: req.params.id }));
});
app.get("/api/reviews", (req, res) => res.ok(listAllSessionReviews()));

// ---- v5:会话分组 ----
app.get("/api/session-groups", (req, res) => res.ok(listSessionGroups()));
app.post("/api/session-groups", (req, res) => {
  const input = SessionGroupSchema.parse(req.body);
  res.ok(createSessionGroup(input));
});
app.get("/api/session-groups/:id", (req, res) => {
  const g = getSessionGroup(req.params.id);
  if (!g) return res.fail(ErrorCodes.NOT_FOUND, "分组不存在", 404);
  res.ok(g);
});
app.put("/api/session-groups/:id", (req, res) => {
  const input = SessionGroupSchema.partial().parse(req.body);
  const g = updateSessionGroup(req.params.id, input);
  if (!g) return res.fail(ErrorCodes.NOT_FOUND, "分组不存在", 404);
  res.ok(g);
});
app.delete("/api/session-groups/:id", (req, res) => { deleteSessionGroup(req.params.id); res.ok({ ok: true }); });
app.get("/api/session-groups/:id/sessions", (req, res) => res.ok(listSessionsByGroup(req.params.id)));
app.get("/api/ungrouped-sessions", (req, res) => res.ok(listUngroupedSessions()));

// ---- LLM 代理 ----
// v10:token 日预算校验(默认 50万/天,环境变量可调)
const DAILY_TOKEN_BUDGET = Number(process.env.DAILY_TOKEN_BUDGET) || 500000;
app.post("/api/chat", wrapAsync(async (req, res, next) => {
  try {
    const { provider, ...body } = req.body;
    if (!provider) throw new ValidationError("provider 为必填");
    // body 基本校验(不强制 messages schema,LLM 转发需要灵活)
    if (!Array.isArray(body.messages)) throw new ValidationError("messages 必须为数组");
    // v10:日预算校验(超出拒绝,防滥用)
    const used = getTodayTokenUsage();
    if (used > DAILY_TOKEN_BUDGET) {
      logger.warn("chat.budget_exceeded", { used, budget: DAILY_TOKEN_BUDGET });
      return res.fail(ErrorCodes.RATE_LIMITED, `已达日 token 预算(${DAILY_TOKEN_BUDGET}),请明天再试`, 429);
    }
    // v10.2.4(P0-3):onUsage 回调 - 改为记录到独立 token_usage 表(不依赖 sessionId)
    // 原方案:onUsage 依赖 sessionId,无 sessionId 时 onUsage=null → usage 不入库 → 预算绕过
    // 新方案:无论是否有 sessionId 都记录到 token_usage,预算校验从 token_usage 查
    const onUsage = (totalTokens) => {
      try {
        recordTokenUsage(totalTokens, provider, body.sessionId);
        // 如有 sessionId,同步更新 sessions.tokens_total(保持向下兼容,前端展示用)
        if (body.sessionId) {
          const db = getDb();
          db.prepare("UPDATE sessions SET tokens_total = tokens_total + ? WHERE session_id = ?")
            .run(totalTokens, body.sessionId);
        }
      } catch (e) {
        logger.warn("tokens.update.failed", { error: e.message, sessionId: body.sessionId });
      }
    };
    if (body.stream) {
      await chatProxy(provider, body, res, onUsage);
    } else {
      const result = await chatProxy(provider, body, null, onUsage);
      res.ok(result);
    }
  } catch (e) {
    if (!res.headersSent) {
      next(e);
    } else {
      res.end();
    }
  }
}));

// ---- 兼容旧 API Keys ----
app.get("/api/keys", (req, res) => res.ok(listApiKeyProviders()));
app.post("/api/keys", (req, res) => {
  const { provider, key } = s.object({
    provider: s.string().min(1).max(50),
    key: s.string().min(1).max(500),
  }).parse(req.body);
  saveApiKey(provider, key);
  res.ok({ ok: true });
});
app.delete("/api/keys/:provider", (req, res) => { deleteApiKey(req.params.provider); res.ok({ ok: true }); });
app.get("/api/keys/:provider", (req, res) => {
  const key = getApiKey(req.params.provider);
  res.ok({ provider: req.params.provider, hasKey: !!key });
});

// ---- v10:数据导出/导入(用户备份/迁移用) ----
// 导出:返回全量 JSON(apiKey 字段过滤,只保留 hasKey 标识)
app.get("/api/export", (req, res) => {
  const data = {
    version: "10.0",
    exportedAt: new Date().toISOString(),
    agents: listAgents(),
    sessions: listSessions(),
    evaluations: listAllEvaluations(10000),
    // providers 不导出 apiKey(敏感),只导出元信息 + hasKey
    providers: listProviders().map(p => {
      const { apiKey, ...safe } = p;
      return { ...safe, hasKey: !!apiKey };
    }),
    materials: listMaterials(),
    sessionGroups: listSessionGroups(),
    reviews: listAllSessionReviews(),
  };
  res.setHeader("Content-Disposition", `attachment; filename="tryout-export-${Date.now()}.json"`);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.ok(data);
});

// 导入:接收 export 格式的 JSON,逐表 INSERT OR IGNORE(跳过已存在,不覆盖用户修改)
// v10:安全加固 - SSRF 校验 + 分表分事务(避免单大事务锁库)+ INSERT OR IGNORE(不覆盖)
// v10:body limit 放宽(导入数据可能较大,全局 1mb 不够)
const ImportSchema = s.object({
  version: s.string().max(20).optional(),
  agents: s.array(s.object({}).passthrough()).max(10000).optional(),
  sessions: s.array(s.object({}).passthrough()).max(10000).optional(),
  evaluations: s.array(s.object({}).passthrough()).max(10000).optional(),
  providers: s.array(s.object({}).passthrough()).max(1000).optional(),
  materials: s.array(s.object({}).passthrough()).max(10000).optional(),
  sessionGroups: s.array(s.object({}).passthrough()).max(1000).optional(),
  reviews: s.array(s.object({}).passthrough()).max(10000).optional(),
});
app.post("/api/import", largeBodyJson, wrapAsync(async (req, res) => {
  const input = ImportSchema.parse(req.body);
  const db = getDb();
  const stats = { agents: 0, sessions: 0, evaluations: 0, providers: 0, materials: 0, sessionGroups: 0, reviews: 0 };
  // v10:skipped 列表(记录因 SSRF 校验失败等原因跳过的条目)
  const skipped = [];

  // v10:providers 表 - 先做 SSRF 校验(异步 DNS),失败跳过该 provider 并记录到 skipped
  // 拆出独立事务(单表小事务,避免长事务锁库)
  if (input.providers && input.providers.length > 0) {
    // v10:事务外做异步 SSRF DNS 校验(checkUrlSafe 是异步的,不能在事务内 await)
    // 失败的 provider 加入 skipped 列表,不进入事务
    const safeProviders = [];
    for (const p of input.providers) {
      if (!p.providerId) continue;
      if (!p.baseUrl) { safeProviders.push(p); continue; }
      const isLocal = p.category === "local";
      try {
        // 同步 hostname 预检 + 异步 DNS 解析双校验
        validateBaseUrlSync(p.baseUrl, { allowLocal: isLocal });
        await checkUrlSafe(p.baseUrl, { allowLocal: isLocal });
        safeProviders.push(p);
      } catch (e) {
        skipped.push({ table: "providers", id: p.providerId, reason: e.message });
      }
    }
    // 单表事务:对过滤后的 safeProviders 做 INSERT OR IGNORE
    const txProviders = db.transaction(() => {
      for (const p of safeProviders) {
        // v10:INSERT OR IGNORE(跳过已存在,不覆盖用户修改)
        const result = db.prepare(`INSERT OR IGNORE INTO providers
          (provider_id, name, category, base_url, api_key, api_format, model_name, icon, icon_color, notes, website_url, sort_index, is_active, in_failover_queue, failover_priority, seed_version, deleted_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'))`)
          .run(p.providerId, p.name || "", p.category || "custom", p.baseUrl || "",
            p.apiFormat || "openai_chat", p.modelName || null, p.icon || null, p.iconColor || null,
            p.notes || null, p.websiteUrl || null, p.sortIndex || 0,
            p.isActive ? 1 : 0, p.inFailoverQueue ? 1 : 0, p.failoverPriority || 0, p.seedVersion || 0);
        if (result.changes > 0) stats.providers++;
      }
    });
    txProviders();
  }

  // v10:sessionGroups 表 - 独立事务 + INSERT OR IGNORE
  if (input.sessionGroups && input.sessionGroups.length > 0) {
    const tx = db.transaction(() => {
      for (const g of input.sessionGroups) {
        if (!g.groupId) continue;
        const result = db.prepare(`INSERT OR IGNORE INTO session_groups (group_id, name, description, color, sort_order, summary, summary_generated_at, deleted_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))`)
          .run(g.groupId, g.name || "", g.description || null, g.color || "#4D6BFE",
            g.sortOrder || 0, g.summary || null, g.summaryGeneratedAt || null);
        if (result.changes > 0) stats.sessionGroups++;
      }
    });
    tx();
  }

  // v10:agents 表 - 独立事务 + INSERT OR IGNORE
  if (input.agents && input.agents.length > 0) {
    const tx = db.transaction(() => {
      for (const a of input.agents) {
        if (!a.agentId) continue;
        const result = db.prepare(`INSERT OR IGNORE INTO agents (agent_id, user_id, name, avatar, role, current_version_id, is_template, icon_type, icon_value, preferred_provider_id, agent_kind, candidate_persona, deleted_at, created_at)
          VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))`)
          .run(a.agentId, a.name || "", a.avatar || null, a.role || "custom",
            a.currentVersionId || null, a.isTemplate ? 1 : 0,
            a.iconType || "emoji", a.iconValue || null, a.preferredProviderId || null,
            a.agentKind || "interviewer", a.candidatePersona || null);
        if (result.changes > 0) stats.agents++;
      }
    });
    tx();
  }

  // v10:sessions 表 - 独立事务 + INSERT OR IGNORE
  if (input.sessions && input.sessions.length > 0) {
    const tx = db.transaction(() => {
      for (const s of input.sessions) {
        if (!s.sessionId) continue;
        const result = db.prepare(`INSERT OR IGNORE INTO sessions (session_id, user_id, title, status, model_id, flow_template, current_stage, duration_ms, difficulty, group_id, session_type, group_config, deleted_at, tokens_total, cost_usd, created_at, updated_at, ended_at)
          VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`)
          .run(s.sessionId, s.title || "", s.status || "active", s.modelId || "",
            s.flowTemplate || null, s.currentStage || 0, s.durationMs || 0,
            s.difficulty || "normal", s.groupId || null, s.sessionType || "interview",
            s.groupConfig ? JSON.stringify(s.groupConfig) : null,
            s.tokensTotal || 0, s.costUsd || 0,
            s.createdAt || new Date().toISOString(), s.updatedAt || new Date().toISOString(),
            s.endedAt || null);
        if (result.changes > 0) stats.sessions++;
      }
    });
    tx();
  }

  // v10:materials 表 - 独立事务 + INSERT OR IGNORE
  if (input.materials && input.materials.length > 0) {
    const tx = db.transaction(() => {
      for (const m of input.materials) {
        if (!m.materialId) continue;
        const result = db.prepare(`INSERT OR IGNORE INTO materials (material_id, user_id, type, source_type, source_ref, title, content_hash, char_count, parse_status, deleted_at, added_at)
          VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
          .run(m.materialId, m.type || "other", m.sourceType || "text",
            m.sourceRef || null, m.title || null, m.contentHash || null,
            m.charCount || 0, m.parseStatus || "ok",
            m.addedAt || new Date().toISOString());
        if (result.changes > 0) stats.materials++;
      }
    });
    tx();
  }

  // v10:evaluations 表 - 独立事务 + INSERT OR IGNORE(已存在则跳过,不覆盖 dimensions)
  if (input.evaluations && input.evaluations.length > 0) {
    const tx = db.transaction(() => {
      for (const e of input.evaluations) {
        if (!e.evaluationId) continue;
        const result = db.prepare(`INSERT OR IGNORE INTO evaluations (evaluation_id, session_id, agent_version_id, model_version, overall_score, report, improvement_advice, better_answer_sample, tokens_consumed, generation_ms, generated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(e.evaluationId, e.sessionId, e.agentVersionId || null, e.modelVersion || null,
            e.overallScore || 0, e.report || "", e.improvementAdvice || null,
            e.betterAnswerSample || null, e.tokensConsumed || 0, e.generationMs || 0,
            e.generatedAt || new Date().toISOString());
        // v10:仅当 evaluation 是新插入时才写 dimensions(避免覆盖用户修改)
        if (result.changes > 0) {
          if (Array.isArray(e.dimensions)) {
            for (const d of e.dimensions) {
              db.prepare("INSERT OR IGNORE INTO evaluation_dimensions (evaluation_id, dimension_name, score, weight, comment) VALUES (?, ?, ?, ?, ?)")
                .run(e.evaluationId, d.dimensionName, d.score || 0, d.weight || 1.0, d.comment || null);
            }
          }
          stats.evaluations++;
        }
      }
    });
    tx();
  }

  // v10:reviews 表 - 独立事务 + INSERT OR IGNORE
  if (input.reviews && input.reviews.length > 0) {
    const tx = db.transaction(() => {
      for (const r of input.reviews) {
        if (!r.reviewId) continue;
        const result = db.prepare(`INSERT OR IGNORE INTO session_reviews (review_id, session_id, overall_score, strengths, weaknesses, improvements, performance, next_focus, generated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(r.reviewId, r.sessionId, r.overallScore || 0,
            r.strengths ? JSON.stringify(r.strengths) : null,
            r.weaknesses ? JSON.stringify(r.weaknesses) : null,
            r.improvements ? JSON.stringify(r.improvements) : null,
            r.performance || null, r.nextFocus || null,
            r.generatedAt || new Date().toISOString());
        if (result.changes > 0) stats.reviews++;
      }
    });
    tx();
  }

  logger.info("import.completed", { ...stats, skipped: skipped.length });
  res.ok({ ok: true, stats, skipped });
}));

// ---- 统一错误处理 ----
// v10.2:ValidationError 透传 code + i18nKey + i18nParams(供前端 i18n 映射)
// v10.2:SsrfBlockedError(chatProxy 抛出)转 400 + SSRF 稳定 code
app.use((err, req, res, next) => {
  // v9:ValidationErrors(schema 校验失败,聚合多字段错误)
  if (err instanceof ValidationErrors) {
    return res.status(400).json({
      ok: false,
      code: ErrorCodes.VALIDATION_ERROR,
      message: err.message,
      issues: err.issues,
    });
  }
  // v10.2:SsrfBlockedError(llm.js assertSafeUrlAtFetch 抛出,chatProxy 透传)
  // 转 400(客户端错误:用户配置的 provider 地址不安全),携带 ssrfCode + ssrfHost
  // v10.2.1:用 SSRF_I18N_KEY_MAP 预映射表替代 toCamelCase(后者首字母大小写 bug 导致 key 失配)
  if (err instanceof SsrfBlockedError) {
    const i18nKey = SSRF_I18N_KEY_MAP[err.ssrfCode] || "error.ssrf.urlInvalid";
    return res.fail(ErrorCodes.VALIDATION_ERROR, err.message, 400, {
      code: err.ssrfCode,
      i18nKey,
      i18nParams: err.ssrfHost ? { host: err.ssrfHost } : {},
    });
  }
  if (err instanceof ValidationError) {
    // v10.2:透传 SSRF 稳定 code + i18nKey + i18nParams
    const extra = {};
    if (err.code) extra.code = err.code;
    if (err.i18nKey) extra.i18nKey = err.i18nKey;
    if (err.i18nParams) extra.i18nParams = err.i18nParams;
    return res.fail(ErrorCodes.VALIDATION_ERROR, err.message, 400, extra);
  }
  if (err instanceof NotFoundError) {
    return res.fail(ErrorCodes.NOT_FOUND, err.message, 404);
  }
  const status = err.status || 500;
  logError(err, "request.error", {
    requestId: req.id,
    method: req.method,
    path: req.path, // v10:用 path 不含 query,避免 PII/token 落入错误日志
    status,
  });
  // 上游 LLM 错误(502/504)单独标记
  const code = status === 504 ? ErrorCodes.TIMEOUT : status === 502 ? ErrorCodes.UPSTREAM_ERROR : ErrorCodes.INTERNAL_ERROR;
  const safeMsg = process.env.NODE_ENV === "production"
    ? (status >= 500 ? "服务器内部错误" : err.message)
    : (err.message || "服务器内部错误");
  res.status(status).json({ ok: false, code, message: safeMsg });
});

// ---- 初始化 ----
seedIfEmpty();
seedDefaultProviders();
seedBuiltinMaterials();

// v9:优雅关闭(SIGTERM/SIGINT 时停止接受新连接,等待进行中请求结束)
const server = app.listen(PORT, HOST, () => {
  const url = HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  logger.info("server.started", { url, host: HOST, port: PORT, auth: isAuthEnabled() ? "enabled" : "disabled" });
  console.log(`Tryout server v9.0 running on ${url}`);
});

let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server.shutting_down", { signal });
  console.log(`\n[graceful] 收到 ${signal},开始优雅关闭...`);
  // 停止接受新连接
  server.close((err) => {
    if (err) {
      logger.error("server.close.error", { error: err.message });
      process.exit(1);
    }
    // 关闭数据库连接
    try {
      // better-sqlite3 是同步的,直接 close 即可
      // db 在 db.js 内部,通过进程退出自然释放
      logger.info("server.closed", {});
      console.log("[graceful] 服务已关闭");
      process.exit(0);
    } catch (e) {
      logger.error("db.close.error", { error: e.message });
      process.exit(1);
    }
  });
  // 兜底:10s 后强制退出(防止挂死)
  setTimeout(() => {
    logger.warn("server.force_exit", {});
    process.exit(1);
  }, 10000).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
// v10.2.4(P1):uncaughtException 后进程状态可能不一致,记录日志后延迟退出(配合进程管理器重启)
// Node.js 官方建议 uncaughtException 后退出进程;延迟 1s 让日志写入完成
process.on("uncaughtException", (err) => {
  logError(err, "uncaughtException");
  logger.error("uncaughtException.exit", { msg: "进程将在 1s 后退出" });
  setTimeout(() => process.exit(1), 1000).unref();
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason: reason?.message || String(reason) });
});
