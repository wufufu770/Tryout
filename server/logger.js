// 结构化日志:零依赖,输出单行 JSON 便于 ELK/Loki 解析
// 字段:level, time, msg, requestId, method, path, status, ms, ip, error, ...
// 使用:logger.info("msg", { extra: ... }), logger.error(err, "msg", ctx)
// requestId:通过 express middleware 注入到 req.id,日志中携带便于全链路追踪

import crypto from "crypto";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const MIN_LEVEL = LEVELS[String(process.env.LOG_LEVEL || "info").toLowerCase()] || LEVELS.info;

function write(level, msg, fields = {}) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const entry = {
    level,
    time: new Date().toISOString(),
    msg,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "fatal") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (msg, fields) => write("debug", msg, fields),
  info: (msg, fields) => write("info", msg, fields),
  warn: (msg, fields) => write("warn", msg, fields),
  error: (msg, fields) => write("error", msg, fields),
  fatal: (msg, fields) => write("fatal", msg, fields),
};

// Express 中间件:为每个请求注入 requestId,并记录访问日志
export function requestLogger(req, res, next) {
  req.id = req.headers["x-request-id"] || crypto.randomBytes(8).toString("hex");
  req.startTime = Date.now();
  // v16(ISSUE-033):**立刻**定格路径。
  //   req.path 是基于 req.url 实时计算的,而 `app.use("/api/chat", limiter)` 这类
  //   挂载会把 req.url 改写成挂载点内的相对路径("/"),且短路返回 429 时不会还原。
  //   于是 finish 回调里读到的 req.path 变成 "/" —— 实测 36 条成功请求记的是
  //   "/api/chat",2 条被限流的却记成 "/"。也就是说:**访问日志恰恰在最需要排查的
  //   限流请求上失真**,运维无法从日志判断是哪个接口在被限。
  //   必须在任何 app.use 改写之前抓一次,而不是在 finish 里现算。
  const loggedPath = req.path;
  // 暴露给下游:res.locals.logger 带 requestId 上下文
  const ctx = { requestId: req.id };
  res.locals.log = {
    info: (msg, f = {}) => logger.info(msg, { ...ctx, ...f }),
    warn: (msg, f = {}) => logger.warn(msg, { ...ctx, ...f }),
    error: (msg, f = {}) => logger.error(msg, { ...ctx, ...f }),
  };
  // 响应结束时记录
  res.on("finish", () => {
    const ms = Date.now() - req.startTime;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    // v10:path 脱敏:用 req.path(不含 query),避免 query 中的 token/PII 落入日志
    // (req.originalUrl 含完整 query,可能含 ?token=xxx 或 ?phone=138... 等)
    write(level, "request", {
      requestId: req.id,
      method: req.method,
      path: loggedPath,
      status: res.statusCode,
      ms,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  });
  next();
}

// 错误日志辅助:从 Error 对象提取关键信息
export function logError(err, msg = "error", ctx = {}) {
  const fields = {
    ...ctx,
    error: err.message,
    name: err.name,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  };
  if (err.status) fields.httpStatus = err.status;
  logger.error(msg, fields);
}
