// 统一响应格式 + 错误码
// 设计:不强制 envelope(RESTful 风格),但提供 ok()/fail() helper 统一风格
//   成功:res.ok(data, 200) → 200 { ok: true, data }
//   失败:res.fail(code, message, status) → 4xx/5xx { ok: false, code, message }
//
// 错误码约定(字符串,前端可 switch 处理):
//   VALIDATION_ERROR   - 400 参数校验失败
//   NOT_FOUND          - 404 资源不存在
//   AUTH_MISSING       - 401 未提供认证
//   AUTH_INVALID       - 401 认证无效
//   RATE_LIMITED       - 429 限流
//   CONFLICT           - 409 资源冲突(如重复创建)
//   UPSTREAM_ERROR     - 502 LLM 上游错误
//   TIMEOUT            - 504 超时
//   INTERNAL_ERROR     - 500 服务器内部错误

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  AUTH_MISSING: "AUTH_MISSING",
  AUTH_INVALID: "AUTH_INVALID",
  RATE_LIMITED: "RATE_LIMITED",
  CONFLICT: "CONFLICT",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  TIMEOUT: "TIMEOUT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

// 注入到 res 的 helper(通过中间件 app.use 安装)
export function responseHelpers(req, res, next) {
  // 成功响应
  res.ok = function (data, status = 200) {
    return this.status(status).json({ ok: true, data });
  };
  // 失败响应
  res.fail = function (code, message, status = 400, extra = {}) {
    return this.status(status).json({ ok: false, code, message, ...extra });
  };
  // 分页响应
  res.page = function (list, total, opts = {}) {
    return this.json({
      ok: true,
      data: list,
      total,
      limit: opts.limit,
      offset: opts.offset,
      hasMore: opts.offset + list.length < total,
    });
  };
  next();
}
