// API 客户端:通过 fetch 调后端 REST API
// v9:超时 + 自动重试 + 拦截器 + 统一错误处理 + 强类型
//
// 设计:
//   1. 默认 15s 超时(GET)/ 30s 超时(POST/PUT/DELETE)
//   2. 网络错误/5xx 自动重试 1 次(写操作仅在 502/503/504 重试,避免重复写入)
//   3. 自动解包 envelope:成功返回 data,失败抛 ApiError
//   4. 流式 chat 单独处理(不走 envelope)
//   5. localStorage 中读 token,有则带 Authorization 头
//   6. 上传文件保持原样(FormData)

import type {
  Agent, AgentVersion, Session, Message, Evaluation, Material, Provider, SessionGroup,
  ChatResult, WeaknessAnalysis, ApiError as _ApiError, ErrorCode,
} from "./types";
import { ApiError } from "./types";

const BASE = "/api";
const TOKEN_KEY = "interviewx:api_token";

// ---- Normalize:补全兼容字段,让旧代码(provider.id / material.content)能直接用 ----
function normalizeProvider(p: any): Provider {
  return { ...p, id: p.id || p.providerId };
}
function normalizeMaterial(m: any): Material {
  return { ...m, content: m.content || m.rawText || "" };
}
function normalizeProviderList(list: any[]): Provider[] {
  return (list || []).map(normalizeProvider);
}
function normalizeMaterialList(list: any[]): Material[] {
  return (list || []).map(normalizeMaterial);
}

// 超时配置
const TIMEOUT_GET = 15_000;
const TIMEOUT_MUTATION = 30_000;
const TIMEOUT_STREAM = 120_000; // 流式首字节可能慢

// 重试配置
const MAX_RETRY = 1;
const RETRYABLE_STATUS = new Set([502, 503, 504, 429]);

// ---- Token 管理 ----
// v10.2.6(D2):改用 sessionStorage,标签关闭即清空,降低 XSS 持久窃取风险
export function getApiToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setApiToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

// ---- 核心请求函数 ----
async function request<T>(
  path: string,
  options: RequestInit = {},
  opts: { retryable?: boolean; raw?: boolean } = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const isMutation = method !== "GET";
  const timeout = isMutation ? TIMEOUT_MUTATION : TIMEOUT_GET;

  // 注入 token
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  const token = getApiToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // X-Request-Id(便于服务端日志关联)
  headers["X-Request-Id"] = Math.random().toString(36).slice(2, 18);

  // 重试循环
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(`${BASE}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // 流式响应(由调用方处理,这里只校验状态)
      if (opts.raw) {
        if (!resp.ok) {
          const err = await parseError(resp);
          throw err;
        }
        return resp as unknown as T;
      }

      // JSON 解析(统一 envelope)
      const text = await resp.text();
      let body: any;
      try { body = text ? JSON.parse(text) : {}; }
      catch { throw new ApiError("响应非 JSON 格式", "INTERNAL_ERROR", resp.status, undefined, "error.network.invalidJson"); }

      if (!resp.ok) {
        // 失败:从 envelope 提取 code/message/i18nKey/i18nParams
        // v10.2:后端 ValidationError/SsrfBlockedError 携带 i18nKey,前端优先用 t() 渲染
        const code = (body.code || "INTERNAL_ERROR") as ErrorCode;
        const message = body.message || body.error || `请求失败(${resp.status})`;
        throw new ApiError(message, code, resp.status, body.issues, body.i18nKey, body.i18nParams);
      }

      // 成功:envelope { ok: true, data } → 解包 data
      // 兼容旧接口(直接返回数据,无 envelope)
      if (body && typeof body === "object" && "ok" in body) {
        return body.data as T;
      }
      // 旧接口直接返回
      return body as T;
    } catch (e: any) {
      clearTimeout(timer);
      lastErr = e;
      // 已是 ApiError:判断是否可重试
      if (e instanceof ApiError) {
        const retryable = opts.retryable !== false &&
          (RETRYABLE_STATUS.has(e.status) || e.code === "TIMEOUT");
        if (!retryable || attempt === MAX_RETRY) throw e;
        // 429 退避
        if (e.status === 429) await sleep(1000 * (attempt + 1));
        continue;
      }
      // 网络错误/abort:可重试
      const isAbort = e.name === "AbortError";
      const retryable = opts.retryable !== false &&
        (isAbort || e.name === "TypeError"); // fetch 网络错误通常是 TypeError
      if (!retryable || attempt === MAX_RETRY) {
        if (isAbort) {
          throw new ApiError(`请求超时(${timeout}ms)`, "TIMEOUT", 408, undefined, "error.network.timeout", { n: timeout });
        }
        throw new ApiError(e.message || "网络错误", "INTERNAL_ERROR", 0, undefined, "error.network.error");
      }
      // 退避后重试
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function parseError(resp: Response): Promise<ApiError> {
  const text = await resp.text().catch(() => "");
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  const code = (body.code || "INTERNAL_ERROR") as ErrorCode;
  const message = body.message || body.error || `请求失败(${resp.status})`;
  // v10.2:透传 i18nKey + i18nParams(SSRF / 校验类错误)
  return new ApiError(message, code, resp.status, body.issues, body.i18nKey, body.i18nParams);
}

// ---- 文件上传(FormData,不走 JSON envelope) ----
async function uploadFile(path: string, form: FormData, timeout = TIMEOUT_MUTATION): Promise<any> {
  const headers: Record<string, string> = {};
  const token = getApiToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  headers["X-Request-Id"] = Math.random().toString(36).slice(2, 18);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    let body: any;
    try { body = text ? JSON.parse(text) : {}; } catch { throw new ApiError("响应非 JSON", "INTERNAL_ERROR", resp.status, undefined, "error.network.invalidJson"); }
    if (!resp.ok) {
      throw new ApiError(body.message || body.error || "上传失败", body.code || "INTERNAL_ERROR", resp.status, undefined, "error.network.uploadFail");
    }
    return body?.data ?? body;
  } catch (e: any) {
    clearTimeout(timer);
    if (e instanceof ApiError) throw e;
    if (e.name === "AbortError") throw new ApiError(`上传超时(${timeout}ms)`, "TIMEOUT", 408, undefined, "error.network.uploadTimeout", { n: timeout });
    throw new ApiError(e.message || "上传失败", "INTERNAL_ERROR", 0, undefined, "error.network.uploadFail");
  }
}

// ============================================================
// API 接口(强类型)
// ============================================================
export const api = {
  // ---- Agents ----
  listAgents: (kind?: "interviewer" | "candidate") =>
    request<Agent[]>(`/agents${kind ? `?kind=${kind}` : ""}`),
  getAgent: (id: string) => request<Agent>(`/agents/${id}`),
  createAgent: (data: Partial<Agent> & Record<string, any>) =>
    request<Agent>("/agents", { method: "POST", body: JSON.stringify(data) }),
  updateAgentBasic: (id: string, data: Partial<Agent>) =>
    request<{ ok: true }>(`/agents/${id}/basic`, { method: "PUT", body: JSON.stringify(data) }),
  // 后端 createAgentVersion 返回 agent_versions 表行(camelize),对应 AgentVersion 类型
  createAgentVersion: (id: string, data: { name?: string; promptTemplate: string }) =>
    request<AgentVersion>(`/agents/${id}/versions`, { method: "POST", body: JSON.stringify(data) }),
  setAgentCurrentVersion: (id: string, versionId: string) =>
    request<Agent>(`/agents/${id}/current-version`, { method: "PUT", body: JSON.stringify({ versionId }) }),
  deleteAgent: (id: string) => request<{ ok: true }>(`/agents/${id}`, { method: "DELETE" }),

  uploadAgentIcon: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return uploadFile(`/agents/${id}/icon`, form);
  },
  agentIconUrl: (id: string) => `${BASE}/agents/${id}/icon`,

  // ---- Sessions ----
  listSessions: () => request<Session[]>("/sessions"),
  getSession: (id: string) => request<Session>(`/sessions/${id}`),
  createSession: (data: Partial<Session>) =>
    request<Session>("/sessions", { method: "POST", body: JSON.stringify(data) }),
  updateSessionModel: (id: string, modelId: string) =>
    request<{ ok: true }>(`/sessions/${id}/model`, { method: "PUT", body: JSON.stringify({ modelId }) }),
  addSessionAgent: (id: string, data: { agentId: string; agentVersionId?: string; roleInSession?: string }) =>
    request<{ ok: true }>(`/sessions/${id}/agents`, { method: "POST", body: JSON.stringify(data) }),
  listStageAgents: (id: string, stage?: number) =>
    request<any[]>(`/sessions/${id}/stage-agents${stage !== undefined ? `?stage=${stage}` : ""}`),
  saveStageAgents: (id: string, stage: number, agents: any[]) =>
    request<any[]>(`/sessions/${id}/stage-agents?stage=${stage}`, { method: "PUT", body: JSON.stringify({ agents }) }),
  setSessionGroup: (id: string, groupId: string | null) =>
    request<{ ok: true }>(`/sessions/${id}/group`, { method: "PUT", body: JSON.stringify({ groupId }) }),

  getSessionReview: (id: string) => request<any | null>(`/sessions/${id}/review`),
  createSessionReview: (id: string, data: any) =>
    request<any>(`/sessions/${id}/review`, { method: "POST", body: JSON.stringify(data) }),
  listAllReviews: () => request<any[]>("/reviews"),

  listSessionGroups: () => request<SessionGroup[]>("/session-groups"),
  createSessionGroup: (data: Partial<SessionGroup>) =>
    request<SessionGroup>("/session-groups", { method: "POST", body: JSON.stringify(data) }),
  updateSessionGroup: (id: string, data: Partial<SessionGroup>) =>
    request<SessionGroup>(`/session-groups/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSessionGroup: (id: string) => request<{ ok: true }>(`/session-groups/${id}`, { method: "DELETE" }),
  listGroupSessions: (id: string) => request<Session[]>(`/session-groups/${id}/sessions`),
  listUngroupedSessions: () => request<Session[]>("/ungrouped-sessions"),

  // ---- Messages ----
  listMessages: (sessionId: string) => request<Message[]>(`/sessions/${sessionId}/messages`),
  addMessage: (sessionId: string, data: Partial<Message>) =>
    request<Message>(`/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify(data) }),

  // ---- Materials ----
  listMaterials: async (): Promise<Material[]> => {
    const list = await request<any[]>("/materials");
    return normalizeMaterialList(list);
  },
  createMaterial: async (data: Partial<Material>): Promise<Material> => {
    const m = await request<any>("/materials", { method: "POST", body: JSON.stringify(data) });
    return normalizeMaterial(m);
  },
  getMaterialContent: async (id: string): Promise<Material> => {
    const m = await request<any>(`/materials/${id}/content`);
    return normalizeMaterial(m);
  },
  deleteMaterial: (id: string) => request<{ ok: true }>(`/materials/${id}`, { method: "DELETE" }),
  uploadFile: async (file: File, type: string): Promise<Material> => {
    const form = new FormData();
    form.append("file", file);
    form.append("type", type);
    const m = await uploadFile("/materials/upload", form, 60_000);
    return normalizeMaterial(m);
  },

  // ---- Evaluations ----
  listEvaluations: (sessionId: string) => request<Evaluation[]>(`/sessions/${sessionId}/evaluations`),
  // 允许传 messageId 等额外字段(后端 schema 会 stripUnknown,不报错)
  createEvaluation: (data: Partial<Evaluation> & Record<string, any>) =>
    request<Evaluation>("/evaluations", { method: "POST", body: JSON.stringify(data) }),
  listAllEvaluations: () => request<Evaluation[]>("/evaluations/all"),
  analyzeWeakness: (limit = 5) => request<WeaknessAnalysis>(`/analysis/weakness?limit=${limit}`),

  // ---- v11:语音转写(本地 whisper) ----
  transcribeAudio: (blob: Blob, data: { sessionId: string; question?: string; agentId?: string; durationMs?: number; language?: string }) => {
    const form = new FormData();
    form.append("audio", blob, "answer.webm");
    form.append("sessionId", data.sessionId);
    if (data.question) form.append("question", data.question);
    if (data.agentId) form.append("agentId", data.agentId);
    if (data.durationMs) form.append("durationMs", String(data.durationMs));
    if (data.language) form.append("language", data.language);
    return uploadFile("/transcribe", form, 120_000);
  },
  listRecordings: (sessionId: string) => request<any[]>(`/sessions/${sessionId}/recordings`),

  // ---- v11:逐题反馈 ----
  scoreAnswer: (sessionId: string, data: { provider: string; question: string; answer: string }) =>
    request<any>(`/sessions/${sessionId}/answers/score`, { method: "POST", body: JSON.stringify(data) }),
  listAnswers: (sessionId: string) => request<any[]>(`/sessions/${sessionId}/answers`),
  markAnswerMissed: (feedbackId: string, isMissed: boolean) =>
    request<{ ok: true }>(`/answers/${feedbackId}/missed`, { method: "PUT", body: JSON.stringify({ isMissed }) }),
  deleteAnswer: (feedbackId: string) => request<{ ok: true }>(`/answers/${feedbackId}`, { method: "DELETE" }),

  // ---- v11:简历押题 ----
  predictQuestions: (data: { provider: string; materialId?: string; resumeText?: string; jdText?: string }) =>
    request<any>("/analysis/predict-questions", { method: "POST", body: JSON.stringify(data) }),

  // ---- Providers ----
  listProviders: async (): Promise<Provider[]> => {
    const list = await request<any[]>("/providers");
    return normalizeProviderList(list);
  },
  getProvider: async (id: string): Promise<Provider> => {
    const p = await request<any>(`/providers/${id}`);
    return normalizeProvider(p);
  },
  createProvider: async (data: Partial<Provider>): Promise<Provider> => {
    const p = await request<any>("/providers", { method: "POST", body: JSON.stringify(data) });
    return normalizeProvider(p);
  },
  updateProvider: async (id: string, data: Partial<Provider>): Promise<Provider> => {
    const p = await request<any>(`/providers/${id}`, { method: "PUT", body: JSON.stringify(data) });
    return normalizeProvider(p);
  },
  deleteProvider: (id: string) => request<{ ok: true }>(`/providers/${id}`, { method: "DELETE" }),
  activateProvider: async (id: string): Promise<Provider> => {
    const p = await request<any>(`/providers/${id}/activate`, { method: "PUT" });
    return normalizeProvider(p);
  },
  testProvider: (id: string) =>
    request<{ success: boolean; latency: number; status?: number; error?: string; ssrfCode?: string; ssrfHost?: string; i18nKey?: string }>(`/providers/${id}/test`),

  // ---- Chat(流式 SSE) ----
  chat: async (provider: string, body: any, onToken?: (t: string) => void): Promise<ChatResult> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = getApiToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    headers["X-Request-Id"] = Math.random().toString(36).slice(2, 18);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_STREAM);
    let resp: Response;
    try {
      resp = await fetch(`${BASE}/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ provider, ...body, stream: !!onToken }),
        signal: controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timer);
      if (e.name === "AbortError") throw new ApiError(`聊天超时(${TIMEOUT_STREAM}ms)`, "TIMEOUT", 408, undefined, "error.network.chatTimeout", { n: TIMEOUT_STREAM });
      throw new ApiError(e.message || "聊天请求失败", "INTERNAL_ERROR", 0, undefined, "error.network.chatFail");
    }

    if (!resp.ok) {
      clearTimeout(timer);
      throw await parseError(resp);
    }

    if (onToken && resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let tokensIn = 0, tokensOut = 0;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            // v9:流式错误事件
            if (json.error) {
              streamError = json.error;
              continue;
            }
            const delta = json.choices?.[0]?.delta?.content || "";
            if (delta) { content += delta; onToken(delta); }
            if (json.usage) {
              tokensIn = json.usage.prompt_tokens || 0;
              tokensOut = json.usage.completion_tokens || 0;
            }
          } catch { /* ignore */ }
        }
      }
      clearTimeout(timer);
      if (streamError) {
        throw new ApiError(streamError, "UPSTREAM_ERROR", 502);
      }
      return { content, model: provider, tokensIn, tokensOut, finishReason: "stop" };
    }

    clearTimeout(timer);
    // 非流式:envelope 解包
    const text = await resp.text();
    let body2: any;
    try { body2 = text ? JSON.parse(text) : {}; }
    catch { throw new ApiError("响应非 JSON", "INTERNAL_ERROR", resp.status, undefined, "error.network.invalidJson"); }
    if (body2?.ok) return body2.data as ChatResult;
    return body2 as ChatResult;
  },

  // ---- API Keys(兼容旧) ----
  listKeyProviders: () => request<string[]>("/keys"),
  saveKey: (provider: string, key: string) =>
    request<{ ok: true }>("/keys", { method: "POST", body: JSON.stringify({ provider, key }) }),
  deleteKey: (provider: string) => request<{ ok: true }>(`/keys/${provider}`, { method: "DELETE" }),
  hasKey: (provider: string) => request<{ provider: string; hasKey: boolean }>(`/keys/${provider}`),

  // ---- 内部工具 ----
  request: <T>(path: string, options?: RequestInit) => request<T>(path, options),
};

export { ApiError };
export type { ErrorCode };

// v10.2:统一的 ApiError → 用户可见文案转换
// 优先用 t(i18nKey, i18nParams) 渲染(SSRF / 校验类错误有稳定 i18nKey)
// 回退到 e.message(网络错误 / 超时等无 i18nKey 的场景)
// 注意:此函数依赖调用方传入的 t(),保持 client.ts 零状态依赖
export function formatApiError(
  e: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (e instanceof ApiError) {
    if (e.i18nKey) return t(e.i18nKey, e.i18nParams || {});
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
