// 第三方集成设置卡片(方案 11)
// 嵌入 SettingsPage,提供 Obsidian Local REST API 与通用 Webhook 的配置 / 测试入口
// 配置仅持久化至 localStorage,不进入后端
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/shared";
import { useI18n } from "@/i18n";
import { InfoTip } from "@/components/InfoTip";
import {
  ObsidianAdapter,
  WebhookAdapter,
  type ObsidianConfig,
  type WebhookConfig,
} from "@/lib/integrationAdapter";
import {
  Plug, Cable, Webhook, CheckCircle2, XCircle, Loader2, Send, Save,
} from "lucide-react";

// ============== localStorage 持久化 helper ==============

const OBSIDIAN_KEY = "tryout:integration:obsidian";
const WEBHOOK_KEY = "tryout:integration:webhook";

const DEFAULT_OBSIDIAN: ObsidianConfig = {
  baseURL: "http://127.0.0.1:27124",
  token: "",
  defaultPath: "Tryout/",
};

const DEFAULT_WEBHOOK: WebhookConfig = {
  url: "",
  headers: {},
};

function loadObsidianConfig(): ObsidianConfig {
  try {
    const raw = localStorage.getItem(OBSIDIAN_KEY);
    if (!raw) return { ...DEFAULT_OBSIDIAN };
    const parsed = JSON.parse(raw) as Partial<ObsidianConfig>;
    return { ...DEFAULT_OBSIDIAN, ...parsed };
  } catch {
    return { ...DEFAULT_OBSIDIAN };
  }
}

function loadWebhookConfig(): WebhookConfig {
  try {
    const raw = localStorage.getItem(WEBHOOK_KEY);
    if (!raw) return { ...DEFAULT_WEBHOOK };
    const parsed = JSON.parse(raw) as Partial<WebhookConfig>;
    return { ...DEFAULT_WEBHOOK, ...parsed };
  } catch {
    return { ...DEFAULT_WEBHOOK };
  }
}

function saveObsidianConfig(cfg: ObsidianConfig) {
  try {
    localStorage.setItem(OBSIDIAN_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore quota errors */
  }
}

function saveWebhookConfig(cfg: WebhookConfig) {
  try {
    localStorage.setItem(WEBHOOK_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore quota errors */
  }
}

// ============== 状态指示器 ==============

type ObsidianStatus = "unconfigured" | "configured" | "testing" | "success" | "failure";
type WebhookStatus = "unconfigured" | "configured" | "testing" | "success" | "failure";

function StatusBadge({ status }: { status: ObsidianStatus | WebhookStatus }) {
  const { t } = useI18n();
  const map: Record<ObsidianStatus, { label: string; color: string; icon: React.ReactNode }> = {
    unconfigured: { label: t("integration.status.unconfigured"), color: "text-ide-fg-muted", icon: null },
    configured: { label: t("integration.status.configured"), color: "text-ide-fg-muted", icon: null },
    testing: { label: t("integration.status.testing"), color: "text-ide-accent", icon: <Loader2 size={10} className="animate-spin" /> },
    success: { label: t("integration.status.success"), color: "text-ide-success", icon: <CheckCircle2 size={10} /> },
    failure: { label: t("integration.status.failure"), color: "text-ide-danger", icon: <XCircle size={10} /> },
  };
  const s = map[status];
  return (
    <span className={cn("flex items-center gap-1 text-[10px]", s.color)}>
      {s.icon}{s.label}
    </span>
  );
}

// ============== 主组件 ==============

export function IntegrationSettings() {
  const { t } = useI18n();
  // Obsidian 状态
  const [obsidian, setObsidian] = useState<ObsidianConfig>(() => loadObsidianConfig());
  const [obsidianStatus, setObsidianStatus] = useState<ObsidianStatus>(() => {
    const c = loadObsidianConfig();
    return c.baseURL && c.token ? "configured" : "unconfigured";
  });

  // Webhook 状态
  const [webhook, setWebhook] = useState<WebhookConfig>(() => loadWebhookConfig());
  const [webhookHeadersText, setWebhookHeadersText] = useState<string>(() => {
    const c = loadWebhookConfig();
    return c.headers && Object.keys(c.headers).length > 0 ? JSON.stringify(c.headers, null, 2) : "";
  });
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus>(() => {
    const c = loadWebhookConfig();
    return c.url ? "configured" : "unconfigured";
  });
  const [headersError, setHeadersError] = useState<string | null>(null);

  // 适配器实例(useMemo 避免每次 render 重建,配置变化时通过 updateConfig 更新)
  const obsidianAdapter = useMemo(() => new ObsidianAdapter(obsidian), []); // eslint-disable-line react-hooks/exhaustive-deps
  const webhookAdapter = useMemo(() => new WebhookAdapter(webhook), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 配置变更时同步到 adapter
  useEffect(() => {
    obsidianAdapter.updateConfig(obsidian);
  }, [obsidian, obsidianAdapter]);
  useEffect(() => {
    webhookAdapter.updateConfig(webhook);
  }, [webhook, webhookAdapter]);

  // ============== Obsidian ==============

  const handleObsidianSave = useCallback(() => {
    saveObsidianConfig(obsidian);
    if (obsidian.baseURL && obsidian.token) {
      setObsidianStatus("configured");
    } else {
      setObsidianStatus("unconfigured");
    }
  }, [obsidian]);

  const handleObsidianTest = useCallback(async () => {
    // 仅做只读探测,不持久化;用户需显式点击"保存"才会写入 localStorage
    obsidianAdapter.updateConfig(obsidian);
    setObsidianStatus("testing");
    try {
      const ok = await obsidianAdapter.test();
      setObsidianStatus(ok ? "success" : "failure");
    } catch {
      setObsidianStatus("failure");
    }
  }, [obsidian, obsidianAdapter]);

  // ============== Webhook ==============

  const parseHeaders = useCallback((text: string): { ok: true; headers: Record<string, string> } | { ok: false; error: string } => {
    const trimmed = text.trim();
    if (!trimmed) return { ok: true, headers: {} };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: t("integration.headers.invalidObject") };
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
          return { ok: false, error: t("integration.headers.invalidValue", { k }) };
        }
        headers[k] = String(v);
      }
      return { ok: true, headers };
    } catch (e: any) {
      return { ok: false, error: t("integration.headers.parseFailed", { msg: e.message || t("integration.headers.formatError") }) };
    }
  }, [t]);

  const handleWebhookSave = useCallback(() => {
    const parsed = parseHeaders(webhookHeadersText);
    if (!parsed.ok) {
      setHeadersError(parsed.error);
      return;
    }
    setHeadersError(null);
    const next: WebhookConfig = { url: webhook.url, headers: parsed.headers };
    setWebhook(next);
    saveWebhookConfig(next);
    if (next.url) {
      setWebhookStatus("configured");
    } else {
      setWebhookStatus("unconfigured");
    }
  }, [webhook.url, webhookHeadersText, parseHeaders]);

  const handleWebhookTest = useCallback(async () => {
    const parsed = parseHeaders(webhookHeadersText);
    if (!parsed.ok) {
      setHeadersError(parsed.error);
      return;
    }
    setHeadersError(null);
    const next: WebhookConfig = { url: webhook.url, headers: parsed.headers };
    // 仅做只读探测:临时同步到 adapter,不写入 localStorage;用户需显式点击"保存"才会持久化
    setWebhook(next);
    webhookAdapter.updateConfig(next);
    setWebhookStatus("testing");
    try {
      const ok = await webhookAdapter.push(
        t("integration.webhook.testMessage"),
        { event: "test", source: "tryout-settings" },
      );
      setWebhookStatus(ok ? "success" : "failure");
    } catch {
      setWebhookStatus("failure");
    }
  }, [webhook.url, webhookHeadersText, webhookAdapter, parseHeaders, t]);

  // 输入框样式
  const inputCls = "h-7 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg placeholder-ide-fg-muted focus:border-ide-accent focus:outline-none";
  const labelCls = "mb-1 block text-xs text-ide-fg-muted";

  return (
    <div className="border border-ide-border bg-ide-bg-alt p-3">
      {/* 标题栏 */}
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-ide-fg">
        <Plug size={14} className="text-ide-accent" />
        {t("integration.title")}
        <InfoTip text={t("integration.tip")} />
      </div>

      <div className="space-y-4">
        {/* ============== Obsidian 配置区 ============== */}
        <div className="border border-ide-border bg-ide-bg p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-ide-fg">
              <Cable size={12} className="text-ide-accent" />
              Obsidian Local REST API
            </div>
            <StatusBadge status={obsidianStatus} />
          </div>

          <div className="space-y-2">
            <div>
              <label className={labelCls}>Base URL</label>
              <input
                type="text"
                value={obsidian.baseURL}
                onChange={(e) => setObsidian({ ...obsidian, baseURL: e.target.value })}
                placeholder="http://127.0.0.1:27124"
                className={cn(inputCls, "font-mono")}
              />
            </div>

            <div>
              <label className={labelCls}>Token</label>
              <input
                type="password"
                value={obsidian.token}
                onChange={(e) => setObsidian({ ...obsidian, token: e.target.value })}
                placeholder={t("integration.obsidian.tokenPlaceholder")}
                className={inputCls}
                autoComplete="off"
              />
            </div>

            <div>
              <label className={labelCls}>{t("integration.obsidian.pathPrefix")}</label>
              <input
                type="text"
                value={obsidian.defaultPath || ""}
                onChange={(e) => setObsidian({ ...obsidian, defaultPath: e.target.value })}
                placeholder="Tryout/"
                className={cn(inputCls, "font-mono")}
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleObsidianTest}
                disabled={obsidianStatus === "testing" || !obsidian.baseURL || !obsidian.token}
                className="flex items-center gap-1 border border-ide-border bg-ide-bg-alt px-2.5 py-1 text-xs text-ide-fg hover:bg-ide-bg-active disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {obsidianStatus === "testing" ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {t("settings.testConnection")}
              </button>
              <button
                onClick={handleObsidianSave}
                className="flex items-center gap-1 bg-ide-accent px-2.5 py-1 text-xs text-ide-accent-fg hover:bg-ide-accent-hover"
              >
                <Save size={12} /> {t("common.save")}
              </button>
              <span className="ml-auto text-[10px] text-ide-fg-muted">
                {t("integration.obsidian.pluginRequired")}
              </span>
            </div>
          </div>
        </div>

        {/* ============== Webhook 配置区 ============== */}
        <div className="border border-ide-border bg-ide-bg p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-ide-fg">
              <Webhook size={12} className="text-ide-accent" />
              {t("integration.webhook.title")}
            </div>
            <StatusBadge status={webhookStatus} />
          </div>

          <div className="space-y-2">
            <div>
              <label className={labelCls}>URL</label>
              <input
                type="text"
                value={webhook.url}
                onChange={(e) => setWebhook({ ...webhook, url: e.target.value })}
                placeholder="https://example.com/webhook"
                className={cn(inputCls, "font-mono")}
              />
            </div>

            <div>
              <label className={labelCls}>
                {t("integration.webhook.headersLabel")}
              </label>
              <textarea
                value={webhookHeadersText}
                onChange={(e) => setWebhookHeadersText(e.target.value)}
                placeholder={'{\n  "Authorization": "Bearer xxx",\n  "X-Source": "tryout"\n}'}
                rows={4}
                className={cn(
                  "w-full border border-ide-border bg-ide-bg px-2 py-1 font-mono text-xs text-ide-fg placeholder-ide-fg-muted focus:border-ide-accent focus:outline-none",
                  headersError && "border-ide-danger",
                )}
                spellCheck={false}
              />
              {headersError && (
                <div className="mt-1 text-[10px] text-ide-danger">{headersError}</div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleWebhookTest}
                disabled={webhookStatus === "testing" || !webhook.url}
                className="flex items-center gap-1 border border-ide-border bg-ide-bg-alt px-2.5 py-1 text-xs text-ide-fg hover:bg-ide-bg-active disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {webhookStatus === "testing" ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {t("integration.webhook.sendTest")}
              </button>
              <button
                onClick={handleWebhookSave}
                className="flex items-center gap-1 bg-ide-accent px-2.5 py-1 text-xs text-ide-accent-fg hover:bg-ide-accent-hover"
              >
                <Save size={12} /> {t("common.save")}
              </button>
              <span className="ml-auto text-[10px] text-ide-fg-muted">
                {t("integration.webhook.postFormat")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
