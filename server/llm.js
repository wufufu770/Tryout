// LLM 代理:后端转发请求到云端 LLM,避免前端 CORS
// v2:从 providers 表读取配置,支持故障转移队列
// v3:PII 脱敏逻辑下沉到 pii.js,system 消息也参与脱敏,非流式回复做反向还原
// v9:30s 超时 + 5xx 重试 1 次 + 流式错误事件 + 结构化日志
// v10:DNS Rebinding 防护(fetch 前 re-resolve)+ 流式首 token 30s 超时 + tokens_total 修复
import dns from "dns";
// v11.1:统一用 undici 的 fetch + Agent(Node 24 原生 fetch 无法识别外部 undici Agent 的 dispatcher,
// 导致 SSRF 防护 Agent 静默失效,所有 LLM 请求报 "fetch failed")
import { Agent, fetch as undiciFetch } from "undici";
import { getProvider, getActiveProvider, getFailoverQueue, getApiKey, listProviders, NotFoundError, ValidationError } from "./db.js";
import { redactPii, restorePii } from "./pii.js";
import { logger } from "./logger.js";
import {
  SsrfBlockedError, SsrfCodes, SSRF_I18N_KEY_MAP,
  isInternalIp, isAlwaysBlockedIp, isMetadataHost,
  ALLOWED_LOCAL_HOSTS,
  NO_REDIRECT_FETCH_INIT,
} from "./ssrf-shared.js";

// 请求超时(毫秒):LLM 单次请求最长 60s(流式首字节更长),超时则中断
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;
// v10:流式首 token 超时(30s 内未收到首字节则中断,防止上游 hang 住客户端 SSE 连接)
const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.LLM_FIRST_TOKEN_TIMEOUT_MS) || 30000;
// 5xx 重试次数(主供应商,失败后立即重试 1 次)
const MAX_RETRY = 1;

// v10:fetch 前 re-resolve DNS 并校验 IP(关闭 checkUrlSafe 与 fetch 之间的 DNS rebinding 窗口)
// 注意:这是"good enough"方案,真正彻底需要 connect-time lookup(需 undici Agent);
// 但 re-resolve 已能阻挡绝大多数 rebinding 攻击(TTL 通常 > 1s)
// v10.2 改造:
//   1. 错误类型改用 SsrfBlockedError(替代字符串匹配,防文案改动导致防护失效)
//   2. IP 校验前先 normalizeIp(防 IPv4-mapped IPv6 绕过,由 ssrf-shared.js 实现)
//   3. 错误消息不泄露服务器 DNS 解析结果(日志层保留完整,address 不返回客户端)
//   4. allowLocal=true 时仅允许 localhost/127.0.0.1/::1/0.0.0.0,阻止其他一切(含元数据 IP)
async function assertSafeUrlAtFetch(urlStr, allowLocal) {
  let u;
  // v10.2.1:抛 SsrfBlockedError 而非裸 Error,让错误中间件能识别并透传 i18nKey
  try { u = new URL(urlStr); } catch {
    throw new SsrfBlockedError(`Base URL 格式无效`, { code: SsrfCodes.URL_INVALID, host: "" });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SsrfBlockedError(`仅允许 http/https 协议`, { code: SsrfCodes.PROTOCOL_INVALID, host: "" });
  }
  const host = u.hostname.toLowerCase();
  // 云元数据 hostname 永远阻止(无论 allowLocal)
  if (isMetadataHost(host)) {
    throw new SsrfBlockedError(`禁止访问云元数据地址:${host}`, {
      code: SsrfCodes.METADATA_HOST, host,
    });
  }
  // allowLocal=true:仅允许 localhost/127.0.0.1/::1(本机 Ollama 等),阻止其他一切
  if (allowLocal) {
    if (ALLOWED_LOCAL_HOSTS.has(host)) return;
    // 域名:解析后只允许指向 127.0.0.1/::1(防 local.example.com → 169.254.169.254)
    let addrs;
    try {
      addrs = await dns.promises.lookup(host, { all: true });
    } catch (e) {
      // DNS 解析失败:local 模式下拒绝(本机域名必须可解析)
      throw new SsrfBlockedError(`本地供应商地址无法解析:${host}`, {
        code: SsrfCodes.UNRESOLVED, host,
      });
    }
    for (const a of addrs) {
      if (isAlwaysBlockedIp(a.address)) {
        logger.warn("ssrf.blocked", { reason: "metadata_ip", host, address: a.address });
        throw new SsrfBlockedError(`该地址解析到云元数据 IP,禁止访问`, {
          code: SsrfCodes.METADATA_IP, host,
        });
      }
      if (a.address !== "127.0.0.1" && a.address !== "::1" && a.address !== "0.0.0.0") {
        logger.warn("ssrf.blocked", { reason: "local_non_loopback", host, address: a.address });
        throw new SsrfBlockedError(`本地供应商仅支持环回地址(localhost/127.0.0.1/::1/0.0.0.0),请改用"自定义"分类`, {
          code: SsrfCodes.LOCAL_NON_LOOPBACK, host,
        });
      }
    }
    return;
  }
  // allowLocal=false:阻止所有内网 IP(含元数据)
  // IP 字面量/localhost 已由 checkUrlSafe 校验过,这里仍 re-resolve 防 rebinding
  let addrs;
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch (e) {
    // v10.2.3(P1-5):DNS 解析失败不再作为 SSRF 阻断,改抛网络错误(502),允许 callWithRetry 重试
    // 原方案抛 SsrfBlockedError(UNRESOLVED) 会让用户看到"域名无法解析,拒绝访问",
    // 但公网 LLM 域名瞬时 DNS 抖动是常见现象,不应被误报为 SSRF 攻击
    // 安全分析:DNS 失败时 fetch 不会发起,不存在 DNS rebinding 风险
    // (rebinding 风险在 DNS 成功时:第一次解析公网 IP,第二次解析内网 IP,
    //  而本函数捕获了第二次解析成功的内网 IP 并阻断,所以 DNS 成功路径已覆盖)
    const err = new Error(`LLM 域名解析失败:${host}(${e.code || e.message})`);
    err.status = 502;
    err.isTimeout = false;
    logger.warn("llm.dns.fail", { host, code: e.code });
    throw err;
  }
  for (const a of addrs) {
    if (isInternalIp(a.address)) {
      logger.warn("ssrf.blocked", { reason: "dns_rebinding", host, address: a.address });
      throw new SsrfBlockedError(`域名解析到内网地址,禁止访问`, {
        code: SsrfCodes.INTERNAL_IP, host,
      });
    }
  }
}

// v10.2.4(P0-4):undici Agent with connect-time DNS lookup
// 在 TCP connect 时做最终 IP 校验,彻底关闭 assertSafeUrlAtFetch 与 fetch 之间的 TOCTOU 窗口
// DNS rebinding 攻击:第一次解析(校验)返回公网 IP,第二次解析(fetch 内部)返回内网 IP
// connect.lookup 在 TCP connect 前调用,此时获取的 IP 就是实际连接的 IP,无法被 rebind
function createSafeLookup(allowLocal) {
  return (hostname, opts, cb) => {
    const family = typeof opts === "number" ? opts : (opts?.family || 0);
    dns.lookup(hostname, { all: true, family }, (err, addresses) => {
      if (err) return cb(err);
      if (!addresses || addresses.length === 0) {
        return cb(new Error(`DNS 解析无结果: ${hostname}`));
      }
      for (const addr of addresses) {
        if (isAlwaysBlockedIp(addr.address)) {
          logger.warn("ssrf.blocked", { reason: "connect_metadata_ip", host: hostname, address: addr.address });
          return cb(new SsrfBlockedError(`该地址解析到云元数据 IP,禁止访问`, {
            code: SsrfCodes.METADATA_IP, host: hostname,
          }));
        }
        if (allowLocal) {
          if (addr.address !== "127.0.0.1" && addr.address !== "::1" && addr.address !== "0.0.0.0") {
            logger.warn("ssrf.blocked", { reason: "connect_local_non_loopback", host: hostname, address: addr.address });
            return cb(new SsrfBlockedError(`本地供应商仅支持环回地址,请改用"自定义"分类`, {
              code: SsrfCodes.LOCAL_NON_LOOPBACK, host: hostname,
            }));
          }
        } else {
          if (isInternalIp(addr.address)) {
            logger.warn("ssrf.blocked", { reason: "connect_internal_ip", host: hostname, address: addr.address });
            return cb(new SsrfBlockedError(`域名解析到内网地址,禁止访问`, {
              code: SsrfCodes.INTERNAL_IP, host: hostname,
            }));
          }
        }
      }
      // v11.2:回调必须传数组(undici/Node 24 的 connect.lookup 契约是 all 模式:
      // callback(null, [{ address, family }, ...]))。
      // 原实现传单地址 (null, first.address, first.family) → node:net emitLookup
      // 收到非法值报 "Invalid IP address: undefined" → 所有域名类 provider 全部 fetch failed。
      // 本地 mock(127.0.0.1)是 IP 字面量,undici 不走 lookup,所以此前 e2e 未暴露。
      cb(null, addresses.map((a) => ({ address: a.address, family: a.family || 4 })));
    });
  };
}

const safeAgentNonLocal = new Agent({ connect: { lookup: createSafeLookup(false) } });
const safeAgentLocal = new Agent({ connect: { lookup: createSafeLookup(true) } });

// 内置默认供应商(当 providers 表为空时作为 fallback)
// 模型名为 2026-07 最新,icon 留空(前端用 favicon)
export const BUILTIN_PROVIDERS = {
  deepseek: { baseUrl: "https://api.deepseek.com/v1", label: "DeepSeek", category: "cn_official", model: "deepseek-v4-flash", icon: "", iconColor: "#4D6BFE" },
  openai: { baseUrl: "https://api.openai.com/v1", label: "OpenAI", category: "official", model: "gpt-5.4-mini", icon: "", iconColor: "#10A37F" },
  glm: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", label: "智谱 GLM", category: "cn_official", model: "glm-5.2", icon: "", iconColor: "#3B5998" },
  ollama: { baseUrl: process.env.OLLAMA_URL || "http://host.docker.internal:11434/v1", label: "Ollama 本地", category: "local", model: "qwen3:8b", icon: "", iconColor: "#888888", local: true },
};

// 列出所有可用供应商(数据库 + 内置)
export function listAllProviders() {
  const dbProviders = listProviders();
  if (dbProviders.length > 0) {
    return dbProviders.map(p => ({
      id: p.providerId,
      name: p.name,
      category: p.category,
      baseUrl: p.baseUrl,
      modelName: p.modelName,
      apiFormat: p.apiFormat,
      icon: p.icon,
      iconColor: p.iconColor,
      notes: p.notes,
      websiteUrl: p.websiteUrl,
      isActive: p.isActive,
      inFailoverQueue: p.inFailoverQueue,
      failoverPriority: p.failoverPriority,
      hasKey: !!p.apiKey,
      isLocal: p.category === "local",
      dataFlow: p.category === "local" ? "完全本地推理" : `对话内容经后端代理发送至 ${p.name}`,
      source: "database",
    }));
  }
  // fallback 到内置
  return Object.entries(BUILTIN_PROVIDERS).map(([id, cfg]) => ({
    id,
    name: cfg.label,
    category: cfg.category,
    baseUrl: cfg.local ? cfg.baseUrl : "(后端代理)",
    modelName: cfg.model,
    icon: cfg.icon,
    iconColor: cfg.iconColor,
    isLocal: cfg.local || false,
    hasKey: false,
    dataFlow: cfg.local ? "完全本地推理" : `对话内容经后端代理发送至 ${cfg.label}`,
    source: "builtin",
  }));
}

// PII 脱敏逻辑已抽取到 ./pii.js,此处直接复用

// 解析供应商配置(支持数据库 provider_id 或内置 id)
function resolveProvider(providerId) {
  // 先从数据库查
  const dbProvider = getProvider(providerId);
  if (dbProvider) {
    return {
      baseUrl: dbProvider.baseUrl,
      // v11.2:providers.api_key 列通常为空(安全设计:key 存独立 api_keys 表,
      // 前端通过 /api/keys 写入)。getApiKey 会回退查 api_keys 表,缺此兜底所有数据库 provider 都拿不到 key
      apiKey: dbProvider.apiKey || getApiKey(providerId),
      model: dbProvider.modelName || providerId,
      apiFormat: dbProvider.apiFormat,
      isLocal: dbProvider.category === "local",
      name: dbProvider.name,
    };
  }
  // 再从内置查
  const builtin = BUILTIN_PROVIDERS[providerId];
  if (builtin) {
    return {
      baseUrl: builtin.baseUrl,
      apiKey: builtin.local ? "ollama" : getApiKey(providerId),
      model: builtin.model || providerId,
      apiFormat: "openai_chat",
      isLocal: builtin.local || false,
      name: builtin.label,
    };
  }
  return null;
}

// 构建请求 payload(根据 api_format)
function buildPayload(provider, body, messages) {
  const model = body.model || provider.model;
  // Anthropic Claude 原生协议:system 必须提取到顶层,messages 数组中不能含 role="system"
  if (provider.apiFormat === "anthropic") {
    const systemMessages = messages
      .filter(m => m.role === "system")
      .map(m => (typeof m.content === "string" ? m.content : ""))
      .filter(Boolean)
      .join("\n\n");
    const chatMessages = messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role, content: m.content }));
    const payload = {
      model,
      max_tokens: body.maxTokens ?? 2048,
      messages: chatMessages,
      stream: body.stream ?? false,
      temperature: body.temperature ?? 0.7,
    };
    if (systemMessages) {
      payload.system = systemMessages;
    }
    return payload;
  }
  // OpenAI 兼容格式
  const payload = {
    model,
    messages,
    temperature: body.temperature ?? 0.7,
    max_tokens: body.maxTokens ?? 2048,
    stream: body.stream ?? false,
  };
  // v10:流式请求加 stream_options.include_usage,让最终 chunk 携带 usage(用于 tokens_total 统计)
  if (payload.stream) {
    payload.stream_options = { include_usage: true };
  }
  return payload;
}

// 发送单个请求(带 30s 超时;流式响应开始前先验证上游可达)
// 重试逻辑在 chatProxy 层处理,这里只发一次
// v10:onUsage 回调 - 当获取到 LLM usage 信息时调用(用于更新 sessions.tokens_total)
async function sendRequest(provider, payload, stream, res, ctx = {}, onUsage) {
  // ⚠️ 日志安全副本(ISSUE-026):`ctx` 里带着 `piiMatches` —— 那是**含明文 PII**的映射
  //   (手机号/邮箱/身份证原文)。而下面有 8 处 `logger.xxx({ ..., ...logCtx })` 会把它整包写进日志,
  //   直接违反本文件 381 行"该映射不落库、不写入日志"的安全声明。
  //
  //   注:v11.3 曾特意把 piiMatches 从 ctx 拆到 streamPiiCtx,注释也写明"不进 ctx,
  //   因为 ctx 被展开进 8 处 logger";但 callCtx = { ...ctx, ...streamPiiCtx } 又把它合了回去,
  //   拆分的意图在接线处被抵消。
  //
  //   修法:在函数入口剥出 `logCtx`,所有 logger 只用 logCtx,并把映射替换为**条数**
  //   (条数有运维价值,明文没有)。
  const { piiMatches, ...ctxRest } = ctx;
  const logCtx = piiMatches?.length
    ? { ...ctxRest, piiMatchCount: piiMatches.length }
    : ctxRest;
  const isAnthropic = provider.apiFormat === "anthropic";
  const url = isAnthropic
    ? `${provider.baseUrl}/messages`
    : `${provider.baseUrl}/chat/completions`;

  // v10:DNS Rebinding 防护 - fetch 前 re-resolve 校验
  // 关闭 checkUrlSafe(路由层)与 fetch 之间的 DNS rebinding 窗口
  await assertSafeUrlAtFetch(url, provider.isLocal);

  // 构建请求头
  const headers = { "Content-Type": "application/json" };
  if (isAnthropic) {
    if (provider.apiKey && provider.apiKey !== "ollama") {
      headers["x-api-key"] = provider.apiKey;
    }
    headers["anthropic-version"] = "2023-06-01";
  } else {
    if (provider.apiKey && provider.apiKey !== "ollama") {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }
  }

  // v10:显式 AbortController(便于流式期间首 token 超时也能 abort)
  // 流式:总超时 120s + 首 token 超时 30s;非流式:总超时 60s
  const timeoutMs = stream ? REQUEST_TIMEOUT_MS * 2 : REQUEST_TIMEOUT_MS;
  const startMs = Date.now();
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), timeoutMs);

  let resp;
  try {
    // v10.2.4(P0-4):传入 undici Agent,在 TCP connect 时做最终 IP 校验(关闭 TOCTOU 窗口)
    const dispatcher = provider.isLocal ? safeAgentLocal : safeAgentNonLocal;
    resp = await undiciFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
      dispatcher,
      ...NO_REDIRECT_FETCH_INIT, // v10.2:禁止 3xx 自动跟随,防重定向绕过 SSRF
    });
  } catch (e) {
    clearTimeout(totalTimer);
    // v10.2.4(P0-4):检查 connect-time SSRF 阻断(来自 undici Agent connect.lookup)
    // undici 可能将 lookup 回调的 error 包装到 e.cause 中
    const ssrfErr = e instanceof SsrfBlockedError ? e :
      (e?.cause instanceof SsrfBlockedError ? e.cause : null);
    if (ssrfErr) throw ssrfErr;
    // 网络错误/超时:包装为可识别的错误
    const isTimeout = e.name === "TimeoutError" || e.name === "AbortError";
    const err = new Error(
      isTimeout
        ? `LLM 请求超时(${timeoutMs}ms):${provider.name}`
        : `LLM 网络错误:${e.message}`
    );
    err.status = isTimeout ? 504 : 502;
    err.isTimeout = isTimeout;
    logger.warn("llm.fetch.error", { provider: provider.name, error: err.message, ...logCtx });
    throw err;
  }

  // v10.2:redirect: manual 模式下 3xx 会被当作"非 ok"响应
  // LLM API 不应返回 3xx,遇到 3xx 直接按错误处理(防重定向到内网)
  // v10.2.1:抛 SsrfBlockedError(REDIRECT_BLOCKED)替代裸 Error,让前端能走 i18n 翻译
  if (resp.status >= 300 && resp.status < 400) {
    clearTimeout(totalTimer);
    const loc = resp.headers.get("location") || "(no location)";
    logger.warn("llm.redirect.blocked", { provider: provider.name, status: resp.status, location: loc, ...logCtx });
    throw new SsrfBlockedError(`LLM 上游返回重定向(${resp.status}),已阻止`, {
      code: SsrfCodes.REDIRECT_BLOCKED, host: provider.baseUrl,
    });
  }

  if (!resp.ok) {
    clearTimeout(totalTimer);
    const text = await resp.text();
    // v10.2.4(P0-5):不把上游错误响应体放入 err.message(防泄露上游内部信息给客户端)
    // v10.2.5(P0-5 跟进):upstreamBody 仅供日志诊断使用,重试逻辑基于 err.status(5xx),不读 upstreamBody
    const err = new Error(`LLM 请求失败(${resp.status})`);
    err.status = resp.status;
    err.upstreamBody = text.slice(0, 500); // 供日志诊断使用,不返回客户端
    logger.warn("llm.upstream.error", {
      // ⚠️ R20(ISSUE-043):此处原先展开的是 `...ctx`,而 sendRequest 的 ctx 里带着
      //   `piiMatches`(明文手机号/邮箱/身份证映射)—— 同一个函数里另外 4 处 logger
      //   都用 logCtx,唯独这一处漏了。它只在 `!resp.ok` 分支执行,
      //   而所有既有 PII 测试用的 mock 上游恒返 200,**这行一次都没被跑到**,
      //   于是 ISSUE-026 的修复静默漏网 6 轮。
      //   实测:上游返 500 时,明文手机号与邮箱直接出现在服务端日志,
      //   日志字段里能看到 `piiMatches` 整包。
      provider: provider.name, status: resp.status, ...logCtx,
      bodyPreview: text.slice(0, 200),
    });
    throw err;
  }

  if (stream && res) {
    // 流式:开始写响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // 关闭代理缓冲(Nginx 等反代下也需要禁用 buffering,这里 SSE 头已足够)
    res.setHeader("X-Accel-Buffering", "no");

    // v11.3:流式 PII 占位符映射下发
    // 流式内容无法回填明文(已逐块写出),因此把"占位符→明文"映射作为
    // 首个 SSE 事件下发给前端,由前端在渲染时还原。
    // 安全:该映射只含本次请求的 PII,不落库、不写入日志、不外传给第三方模型。
    if (ctx.piiMatches && ctx.piiMatches.length > 0) {
      try {
        res.write(`data: ${JSON.stringify({ pii_mapping: ctx.piiMatches })}\n\n`);
      } catch { /* 客户端可能已断开 */ }
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    // v10:首 token 超时 - 30s 内未收到首字节则 abort(防止上游 hang 住 SSE 连接)
    let firstTokenReceived = false;
    const firstTokenTimer = setTimeout(() => {
      if (!firstTokenReceived) {
        try { controller.abort(); } catch { /* already aborted */ }
      }
    }, FIRST_TOKEN_TIMEOUT_MS);
    // v10:流式期间捕获 usage(OpenAI 最终 chunk 或 Anthropic message_delta)
    let streamUsage = null;
    // 流式期间发生错误时的兜底:向前端发送 error 事件,避免前端挂死
    const sendStreamError = (errMsg) => {
      try {
        res.write(`data: ${JSON.stringify({ error: errMsg, errorType: "stream_error" })}\n\n`);
        res.write("data: [DONE]\n\n");
      } catch { /* 客户端可能已断开 */ }
    };
    try {
      if (isAnthropic) {
        // Anthropic SSE 转换为 OpenAI 兼容格式
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          firstTokenReceived = true;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            if (!part.trim()) continue;
            const dataLines = part
              .split("\n")
              .filter(line => line.startsWith("data:"))
              .map(line => line.slice(5).trim());
            if (dataLines.length === 0) continue;
            const dataStr = dataLines.join("\n");
            if (dataStr === "[DONE]") continue;
            try {
              const evt = JSON.parse(dataStr);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && typeof evt.delta.text === "string") {
                const openaiChunk = { choices: [{ delta: { content: evt.delta.text } }] };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
              }
              // v10:捕获 Anthropic usage(message_start 含 input_tokens,message_delta 含 output_tokens)
              if (evt.type === "message_start" && evt.message?.usage?.input_tokens) {
                streamUsage = streamUsage || { input_tokens: 0, output_tokens: 0 };
                streamUsage.input_tokens = evt.message.usage.input_tokens;
              }
              if (evt.type === "message_delta" && evt.usage?.output_tokens) {
                streamUsage = streamUsage || { input_tokens: 0, output_tokens: 0 };
                streamUsage.output_tokens = evt.usage.output_tokens;
              }
              // v9:Anthropic error 事件
              if (evt.type === "error") {
                sendStreamError(evt.error?.message || "Anthropic 上游错误");
                return null;
              }
            } catch (e) {
              // 非 JSON 数据行,忽略
            }
          }
        }
        if (buffer.trim()) {
          const dataLines = buffer
            .split("\n")
            .filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trim());
          const dataStr = dataLines.join("\n");
          if (dataStr && dataStr !== "[DONE]") {
            try {
              const evt = JSON.parse(dataStr);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && typeof evt.delta.text === "string") {
                const openaiChunk = { choices: [{ delta: { content: evt.delta.text } }] };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
              }
              if (evt.type === "message_delta" && evt.usage?.output_tokens) {
                streamUsage = streamUsage || { input_tokens: 0, output_tokens: 0 };
                streamUsage.output_tokens = evt.usage.output_tokens;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
        res.write("data: [DONE]\n\n");
      } else {
        // OpenAI 兼容:直接透传 SSE,同时解析 usage(最终 chunk 含 usage)
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          firstTokenReceived = true;
          const chunk = decoder.decode(value, { stream: true });
          // v10:解析 chunk 提取 usage(不修改透传内容)
          // SSE chunk 格式:"data: {...}\n\n"
          buffer += chunk;
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const dataLines = part.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim());
            for (const line of dataLines) {
              if (line === "[DONE]") continue;
              try {
                const obj = JSON.parse(line);
                // OpenAI 流式最终 chunk(choices 为空数组,含 usage)
                if (obj.usage) {
                  streamUsage = obj.usage;
                }
              } catch { /* 忽略解析错误 */ }
            }
          }
          res.write(chunk);
        }
      }
    } catch (e) {
      // 流式过程中上游断连/读取异常:向前端发错误事件
      const isAbort = e.name === "AbortError";
      const errMsg = isAbort && !firstTokenReceived
        ? `LLM 首 token 超时(${FIRST_TOKEN_TIMEOUT_MS}ms):${provider.name}`
        : e.message;
      logger.warn("llm.stream.error", { provider: provider.name, error: errMsg, ...logCtx, isAbort, firstTokenReceived });
      if (!res.writableEnded) sendStreamError(errMsg);
      return null;
    } finally {
      clearTimeout(totalTimer);
      clearTimeout(firstTokenTimer);
      if (!res.writableEnded) res.end();
    }
    // v10:流式完成后,如有 usage 信息则回调(更新 sessions.tokens_total)
    if (onUsage && streamUsage) {
      const total = isAnthropic
        ? (streamUsage.input_tokens || 0) + (streamUsage.output_tokens || 0)
        : (streamUsage.total_tokens || ((streamUsage.prompt_tokens || 0) + (streamUsage.completion_tokens || 0)));
      if (total > 0) {
        try { onUsage(total); } catch (e) { logger.warn("llm.onUsage.error", { error: e.message }); }
      }
    }
    logger.info("llm.stream.done", { provider: provider.name, ms: Date.now() - startMs, ...logCtx });
    return null;
  }

  // 非流式
  const data = await resp.json();
  clearTimeout(totalTimer);
  if (isAnthropic) {
    const textBlock = Array.isArray(data.content)
      ? data.content.find(b => b.type === "text")
      : null;
    const tokensIn = data.usage?.input_tokens || 0;
    const tokensOut = data.usage?.output_tokens || 0;
    const totalTokens = tokensIn + tokensOut;
    // v10:回调 usage(更新 sessions.tokens_total)
    if (onUsage && totalTokens > 0) {
      try { onUsage(totalTokens); } catch (e) { logger.warn("llm.onUsage.error", { error: e.message }); }
    }
    return {
      content: textBlock?.text || "",
      model: data.model,
      tokensIn,
      tokensOut,
      totalTokens,
      finishReason: data.stop_reason || "stop",
    };
  }
  // OpenAI 兼容格式
  const tokensIn = data.usage?.prompt_tokens || 0;
  const tokensOut = data.usage?.completion_tokens || 0;
  const totalTokens = data.usage?.total_tokens || (tokensIn + tokensOut);
  // v10:回调 usage(更新 sessions.tokens_total)
  if (onUsage && totalTokens > 0) {
    try { onUsage(totalTokens); } catch (e) { logger.warn("llm.onUsage.error", { error: e.message }); }
  }
  return {
    content: data.choices?.[0]?.message?.content || "",
    model: data.model,
    tokensIn,
    tokensOut,
    totalTokens,
    finishReason: data.choices?.[0]?.finish_reason || "stop",
  };
}

// 聊天代理:支持主供应商重试 + failover
// v10:onUsage 回调 - 流式/非流式获取到 usage 时回调(用于更新 sessions.tokens_total)
export async function chatProxy(providerId, body, res, onUsage) {
  const provider = resolveProvider(providerId);
  if (!provider) {
    // ⚠️ 用 ValidationError 而非裸 Error(ISSUE-028):
    //   裸 Error 会被全局处理器兜底成 500,客户端传错 provider 就看到"服务器内部错误",
    //   既误导排查方向,又把客户端错误计入服务端 5xx 指标。
    //   注意:前端很容易误传 provider **名称**而非 id(如传 "minimax" 而非 "prov_xxx"),
    //   所以这条路径在实际使用中会被频繁触发。
    throw new ValidationError(`供应商不存在: ${providerId}(请使用 provider id,而非名称)`);
  }

  if (!provider.apiKey && !provider.isLocal) {
    // ⚠️ R20(ISSUE-044):原先是裸 `new Error(...)` → 被 index.js 的全局处理器兜底成
    //   500「服务器内部错误」。但这是**客户端配置问题**:供应商在系统里存在,
    //   只是还没配 key(典型场景:刚加了 provider 就点发送)。
    //   报 500 会把排查方向带偏,并把客户端错误计入服务端 5xx 指标。
    //   与上面「供应商不存在」统一用 ValidationError(ISSUE-028 的同源问题)。
    throw new ValidationError(`供应商「${provider.name}」未配置 API Key,请先在设置里填写`);
  }

  // PII 脱敏(system 消息中也可能含简历/JD 中的 PII,同样需要脱敏)
  const allMatches = [];
  const messages = (body.messages || []).map(m => {
    if (typeof m.content !== "string" || m.content.length === 0) return m;
    const { redacted, matches } = redactPii(m.content);
    if (matches.length > 0) {
      allMatches.push(...matches);
      return { ...m, content: redacted };
    }
    return m;
  });
  if (allMatches.length > 0) {
    logger.info("pii.redacted", { count: allMatches.length, provider: provider.name });
  }

  const payload = buildPayload(provider, body, messages);
  const stream = body.stream && res;
  // v11.3:PII 映射单独放在 piiMatches 变量,不进 ctx。
  // 原因:ctx 被展开进 8 处 logger 调用,含明文 PII 会污染日志。
  // ⚠️ 本函数内的 logger 一律展开 **ctx**,不要写 logCtx。
  //   `logCtx` 是 sendRequest 内部的局部变量(由它从 ctx 里剥掉 piiMatches 后生成),
  //   在 chatProxy / callWithRetry 作用域**根本不存在** —— 展开它会抛
  //   `ReferenceError: logCtx is not defined`,把整条重试与 failover 路径打成 500。
  //   而这里用 ctx 是安全的:v11.3 刻意把含明文 PII 的 allMatches 拆到
  //   streamPiiCtx,不与 ctx 混用(见下方 callCtx 合并处)。
  const ctx = { provider: provider.name, stream: !!stream };
  const streamPiiCtx = { piiMatches: allMatches };

  // v9:主供应商 5xx 重试(超时/网关错误/服务不可用),最多 MAX_RETRY 次
  // v10:onUsage 透传到 sendRequest
  // v10.2:SsrfBlockedError 不参与重试(SSRF 阻断是确定性失败,重试只会浪费配额/放大日志噪声)
  async function callWithRetry(p, pl, st, rs, usageCb) {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        // v11.3:piiMatches 走独立字段传给 sendRequest,保证不与 ctx(会进日志)混用
        const callCtx = { ...ctx, attempt, ...streamPiiCtx };
        const result = await sendRequest(p, pl, st, rs, callCtx, usageCb);
        // 非流式回复:把占位符反向还原为原始 PII
        // (流式无法回填,改为在 SSE 首个事件下发映射,由前端还原)
        if (!st && result && typeof result.content === "string" && allMatches.length > 0) {
          result.content = restorePii(result.content, allMatches);
        }
        return result;
      } catch (e) {
        lastErr = e;
        // v10.2:SsrfBlockedError 是 SSRF 阻断,不重试直接透传
        if (e instanceof SsrfBlockedError) throw e;
        // 流式已经开始写入 response,不能重试(否则前端收到两份内容)
        if (st) throw e;
        // 仅 5xx/超时/网关错误才重试;4xx 是客户端问题(鉴权/参数),不重试
        const retryable = !e.status || (e.status >= 500 && e.status < 600) || e.isTimeout;
        if (!retryable || attempt === MAX_RETRY) {
          logger.warn("llm.primary.failed", { provider: p.name, error: e.message, attempt, ...ctx });
          throw e;
        }
        logger.warn("llm.primary.retry", { provider: p.name, error: e.message, attempt: attempt + 1, ...ctx });
      }
    }
    throw lastErr;
  }

  // 主供应商尝试(含重试)
  try {
    return await callWithRetry(provider, payload, stream, res, onUsage);
  } catch (primaryError) {
    // 非流式才支持 failover(流式已经开始写入 response,无法回退)
    if (stream) throw primaryError;

    logger.error("failover.primary.exhausted", { provider: provider.name, error: primaryError.message, ...ctx });

    // 查找 failover 队列
    const queue = getFailoverQueue();
    for (const fp of queue) {
      if (fp.providerId === providerId) continue;
      const failoverProvider = resolveProvider(fp.providerId);
      if (!failoverProvider) continue;
      if (!failoverProvider.apiKey && !failoverProvider.isLocal) continue;

      logger.info("failover.try", { from: provider.name, to: failoverProvider.name, ...ctx });
      try {
        const failoverPayload = buildPayload(failoverProvider, body, messages);
        const result = await sendRequest(failoverProvider, failoverPayload, false, null, { ...ctx, failover: failoverProvider.name }, onUsage);
        result.degraded = true;
        result.degradedFrom = failoverProvider.name;
        if (result && typeof result.content === "string" && allMatches.length > 0) {
          result.content = restorePii(result.content, allMatches);
        }
        return result;
      } catch (e) {
        logger.warn("failover.target.failed", { provider: failoverProvider.name, error: e.message, ...ctx });
        continue;
      }
    }

    // 全部失败,抛出原始错误
    throw primaryError;
  }
}

// 端点测速
// v10.1:N1 修复 - 两个 fetch 前都调 assertSafeUrlAtFetch,防 DNS rebinding + 元数据 IP
// v10.2:fetch 加 redirect:"manual" + 3xx 阻断 + SsrfBlockedError 透传 ssrfCode
export async function testProviderLatency(providerId) {
  const provider = resolveProvider(providerId);
  // 用 NotFoundError 而不是裸 Error:裸 Error 会被全局处理器当成 500,
  // 导致用户传了个不存在的 providerId 却只看到"服务器内部错误"(生产模式),
  // 既误导排查方向,又会把客户端错误计入服务端 5xx 指标。
  if (!provider) {
    const e = new NotFoundError("供应商");
    e.message = `供应商不存在: ${providerId}`;
    throw e;
  }

  const start = Date.now();
  try {
    // v10.2.5(P1-5):测速同样使用 safeAgent(connect-time IP 校验),关闭 TOCTOU 窗口
    const dispatcher = provider.isLocal ? safeAgentLocal : safeAgentNonLocal;
    if (provider.apiFormat === "anthropic") {
      // Anthropic 没有 /models 端点,用一个最小 /messages 请求测连通性
      const url = `${provider.baseUrl}/messages`;
      // v10.1:fetch 前 DNS rebinding 校验(与 chatProxy 同一防护)
      await assertSafeUrlAtFetch(url, provider.isLocal);
      const headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      };
      if (provider.apiKey && provider.apiKey !== "ollama") {
        headers["x-api-key"] = provider.apiKey;
      }
      const resp = await undiciFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: AbortSignal.timeout(5000),
        dispatcher,
        ...NO_REDIRECT_FETCH_INIT, // v10.2:防重定向绕过
      });
      const elapsed = Date.now() - start;
      // v10.2:3xx 视为失败(防重定向到内网)
      // v10.2.1:透传 ssrfCode + ssrfHost,让前端走 i18n 翻译(原硬编码中文对非中文用户是乱入)
      // v10.2.3(P1-6):同时透传 i18nKey,前端无需维护 ssrfCode → i18nKey 映射
      if (resp.status >= 300 && resp.status < 400) {
        return {
          success: false, latency: elapsed, error: `LLM 上游返回重定向(${resp.status}),已阻止`,
          ssrfCode: SsrfCodes.REDIRECT_BLOCKED, ssrfHost: provider.baseUrl,
          i18nKey: SSRF_I18N_KEY_MAP[SsrfCodes.REDIRECT_BLOCKED],
        };
      }
      // 200 表示连通正常;401/403 表示密钥问题但端点可达,也算连通
      return { success: resp.status === 200, latency: elapsed, status: resp.status };
    }
    // OpenAI 兼容格式:用 GET /models 测速
    const url = `${provider.baseUrl}/models`;
    // v10.1:fetch 前 DNS rebinding 校验
    await assertSafeUrlAtFetch(url, provider.isLocal);
    const headers = {};
    if (provider.apiKey && provider.apiKey !== "ollama") {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
    }
    const resp = await undiciFetch(url, { method: "GET", headers, signal: AbortSignal.timeout(5000), dispatcher, ...NO_REDIRECT_FETCH_INIT });
    const elapsed = Date.now() - start;
    if (resp.status >= 300 && resp.status < 400) {
      return {
        success: false, latency: elapsed, error: `LLM 上游返回重定向(${resp.status}),已阻止`,
        ssrfCode: SsrfCodes.REDIRECT_BLOCKED, ssrfHost: provider.baseUrl,
        i18nKey: SSRF_I18N_KEY_MAP[SsrfCodes.REDIRECT_BLOCKED],
      };
    }
    return { success: resp.ok, latency: elapsed, status: resp.status };
  } catch (e) {
    const elapsed = Date.now() - start;
    // v10.2:SsrfBlockedError 透传 ssrfCode + ssrfHost(供前端 i18n 映射)
    // v10.2.3(P1-6):同时透传 i18nKey,前端无需维护 ssrfCode → i18nKey 映射
    // v10.2.5(P1-5):undici connect.lookup 抛出的 SsrfBlockedError 会被包装到 e.cause
    const ssrfErr = e instanceof SsrfBlockedError ? e :
      (e?.cause instanceof SsrfBlockedError ? e.cause : null);
    if (ssrfErr) {
      return {
        success: false, latency: elapsed, error: ssrfErr.message,
        ssrfCode: ssrfErr.ssrfCode, ssrfHost: ssrfErr.ssrfHost,
        i18nKey: SSRF_I18N_KEY_MAP[ssrfErr.ssrfCode] || "error.ssrf.urlInvalid",
      };
    }
    return { success: false, latency: elapsed, error: e.message };
  }
}
