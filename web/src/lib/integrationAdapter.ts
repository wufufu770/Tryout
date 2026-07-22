// 第三方集成适配器(方案 11)
// 提供统一的 test / push 接口,将面试内容写入外部系统(Obsidian / Webhook 等)
// 所有网络请求带 5s 超时与错误兜底,不抛异常,只返回 boolean

export interface IntegrationAdapter {
  name: string;
  test(): Promise<boolean>;
  push(content: string, meta?: Record<string, unknown>): Promise<boolean>;
}

const DEFAULT_TIMEOUT = 5000;

/** 带 AbortController 超时的 fetch,失败统一返回 null */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeout = DEFAULT_TIMEOUT,
): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(timer);
    return resp;
  } catch {
    return null;
  }
}

// ============== Obsidian Local REST API ==============

export interface ObsidianConfig {
  /** baseURL,如 http://127.0.0.1:27124 */
  baseURL: string;
  /** API token */
  token: string;
  /** 写入 vault 内的目标路径,如 Interview/notes.md */
  defaultPath?: string;
}

/**
 * Obsidian Local REST API 适配器
 * - test():GET / 提取响应头 apiversion
 * - push():PUT /vault/{path} 写入 markdown
 */
export class ObsidianAdapter implements IntegrationAdapter {
  name = "obsidian";
  private cfg: ObsidianConfig;

  constructor(cfg: ObsidianConfig) {
    this.cfg = cfg;
  }

  updateConfig(cfg: Partial<ObsidianConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
  }

  async test(): Promise<boolean> {
    if (!this.cfg.baseURL || !this.cfg.token) return false;
    const resp = await fetchWithTimeout(this.cfg.baseURL.replace(/\/$/, ""), {
      method: "GET",
      headers: { Authorization: `Bearer ${this.cfg.token}` },
    });
    if (!resp) return false;
    // Obsidian Local REST API 在响应头返回 apiversion / obsidian-version
    const apiVer = resp.headers.get("apiversion");
    return resp.ok || !!apiVer;
  }

  async push(content: string, meta?: Record<string, unknown>): Promise<boolean> {
    if (!this.cfg.baseURL || !this.cfg.token) return false;
    const path = (meta?.path as string) || this.cfg.defaultPath || "Interview/note.md";
    const mode = (meta?.mode as "append" | "overwrite") || "append";

    const base = this.cfg.baseURL.replace(/\/$/, "");
    const url = `${base}/vault/${encodeURI(path)}`;

    // 构造写入内容:带时间戳前缀
    const ts = new Date().toISOString();
    const header = `\n---\n## ${ts}${meta?.title ? ` · ${meta.title}` : ""}\n\n`;
    const body = mode === "overwrite" ? content : header + content;

    const resp = await fetchWithTimeout(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        "Content-Type": "text/markdown",
      },
      body,
    });
    return !!resp && (resp.ok || resp.status === 200 || resp.status === 204);
  }
}

// ============== 通用 Webhook ==============

export interface WebhookConfig {
  /** webhook URL */
  url: string;
  /** 可选自定义 header(如 Authorization) */
  headers?: Record<string, string>;
}

/**
 * 通用 Webhook 适配器
 * - test():POST 一个 ping 探测包
 * - push():POST JSON { content, meta, timestamp }
 */
export class WebhookAdapter implements IntegrationAdapter {
  name = "webhook";
  private cfg: WebhookConfig;

  constructor(cfg: WebhookConfig) {
    this.cfg = cfg;
  }

  updateConfig(cfg: Partial<WebhookConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
  }

  async test(): Promise<boolean> {
    if (!this.cfg.url) return false;
    const resp = await fetchWithTimeout(this.cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.cfg.headers || {}) },
      body: JSON.stringify({ event: "ping", timestamp: Date.now() }),
    });
    return !!resp && resp.ok;
  }

  async push(content: string, meta?: Record<string, unknown>): Promise<boolean> {
    if (!this.cfg.url) return false;
    const resp = await fetchWithTimeout(this.cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.cfg.headers || {}) },
      body: JSON.stringify({
        content,
        meta: meta || {},
        timestamp: Date.now(),
      }),
    });
    return !!resp && resp.ok;
  }
}

// ============== 注册表 ==============

interface IntegrationRegistry {
  register(name: string, adapter: IntegrationAdapter): void;
  get(name: string): IntegrationAdapter | undefined;
  list(): IntegrationAdapter[];
  unregister(name: string): boolean;
}

function createIntegrationRegistry(): IntegrationRegistry {
  const map = new Map<string, IntegrationAdapter>();

  // 默认注册(obsidian / webhook 使用空配置,需调用方 updateConfig 后才能用)
  map.set("obsidian", new ObsidianAdapter({ baseURL: "", token: "" }));
  map.set("webhook", new WebhookAdapter({ url: "" }));

  return {
    register(name, adapter) {
      map.set(name, adapter);
    },
    get(name) {
      return map.get(name);
    },
    list() {
      return Array.from(map.values());
    },
    unregister(name) {
      return map.delete(name);
    },
  };
}

export const integrationRegistry: IntegrationRegistry = createIntegrationRegistry();
