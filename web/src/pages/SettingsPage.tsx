import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/shared";
import { THEMES, getStoredTheme, setStoredTheme, type ThemeId } from "@/theme";
import { InfoTip } from "@/components/InfoTip";
import { IntegrationSettings } from "@/components/IntegrationSettings";
import { ProviderLogo } from "@/components/ProviderLogo";
import { useI18n, LOCALES, type Locale } from "@/i18n";
import { toast, toastError } from "@/shared";
import { api, formatApiError, ApiError, getApiToken, setApiToken } from "@/api/client";
import {
  Key, Save, Trash2, CheckCircle2, Info, Keyboard, Plus, Zap, ZapOff,
  Edit3, X, Globe, Activity, ChevronUp, ChevronDown, Star, AlertTriangle, Palette, Languages,
} from "lucide-react";

// 供应商分类:labelKey 通过 t() 翻译
const CATEGORIES: Record<string, { labelKey: string; color: string }> = {
  official: { labelKey: "settings.category.official", color: "#10A37F" },
  cn_official: { labelKey: "settings.category.cn_official", color: "#4D6BFE" },
  cloud_provider: { labelKey: "settings.category.cloud_provider", color: "#FF9900" },
  aggregator: { labelKey: "settings.category.aggregator", color: "#9C27B0" },
  third_party: { labelKey: "settings.category.third_party", color: "#F44336" },
  custom: { labelKey: "settings.category.custom", color: "#607D8B" },
  local: { labelKey: "settings.category.local", color: "#888888" },
};

// SHORTCUTS 移到组件内以使用 t()

interface Provider {
  id: string;
  name: string;
  category: string;
  baseUrl: string;
  modelName?: string;
  apiFormat?: string;
  icon?: string;
  iconColor?: string;
  notes?: string;
  websiteUrl?: string;
  isActive?: boolean;
  inFailoverQueue?: boolean;
  failoverPriority?: number;
  hasKey?: boolean;
  isLocal?: boolean;
  dataFlow?: string;
  source?: string;
}

export function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  // v10.2.1:error state 存原始 ApiError 对象(替代已翻译字符串),渲染时 formatApiError 实时翻译
  // 修复 P0-5:切换语言后已显示的错误固定在原语言 → 现在 locale 变化触发重渲染,formatApiError 用新 t() 重新翻译
  const [error, setError] = useState<ApiError | null>(null);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  // v10.2:testResults 新增 error 字段,保存后端返回的错误消息(原 P0-1 丢弃 result.error 导致用户无反馈)
  // v10.2.1:error 改为 ApiError 对象(支持语言切换重译)+ 新增 ssrfCode 用于测速场景前端 i18n 映射
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latency: number; error?: ApiError | null } | "testing">>({});
  const [themeId, setThemeId] = useState<ThemeId>(() => getStoredTheme());
  const { t, locale, setLocale } = useI18n();
  // v10.2.6(D1):API 访问令牌配置 — setApiToken 之前无调用方,补齐前端 UI
  const [apiTokenInput, setApiTokenInput] = useState("");
  const [hasApiToken, setHasApiToken] = useState(() => !!getApiToken());

  const handleSaveApiToken = () => {
    const trimmed = apiTokenInput.trim();
    if (!trimmed) return;
    setApiToken(trimmed);
    setHasApiToken(true);
    setApiTokenInput("");
    showToast(t("settings.apiTokenSaved"));
  };
  const handleClearApiToken = () => {
    setApiToken(null);
    setHasApiToken(false);
    setApiTokenInput("");
    showToast(t("settings.apiTokenCleared"));
  };

  // SHORTCUTS 在组件内构造以使用 t()
  const SHORTCUTS = [
    { keys: "Ctrl + Enter", desc: t("settings.shortcut.send") },
    { keys: "Ctrl + Shift + N", desc: t("settings.shortcut.newSession") },
    { keys: "Ctrl + M", desc: t("settings.shortcut.switchModel") },
    { keys: t("settings.shortcut.hoverIcon"), desc: t("settings.shortcut.hoverDesc") },
  ];

  const handleThemeChange = (id: ThemeId) => {
    setThemeId(id);
    setStoredTheme(id);
    // 修复 P1-10:此处 `t` 与 i18n 的 t() 函数重名导致遮蔽,改用 theme 作为参数名
    showToast(t("settings.themeChanged", { name: THEMES.find(theme => theme.id === id)?.name ?? "" }));
  };

  // 委托给全局 toast,移除本地 state(避免重复实现)
  const showToast = (msg: string) => toast(msg, "success");

  // v10.2.1:toApiError 辅助 — 把任意 catch 到的错误归一为 ApiError(供 setError 存原对象,渲染时再翻译)
  const toApiError = (e: any): ApiError =>
    e instanceof ApiError ? e : new ApiError(e?.message || String(e), "INTERNAL_ERROR", 0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listProviders();
      setProviders(list);
    } catch (e: any) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleActivate = async (id: string) => {
    try {
      await api.activateProvider(id);
      showToast(t("settings.activatedToast"));
      load();
    } catch (e: any) {
      setError(toApiError(e));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t("settings.confirmDeleteProvider", { name }))) return;
    try {
      await api.deleteProvider(id);
      showToast(t("settings.deletedToast"));
      load();
    } catch (e: any) {
      setError(toApiError(e));
    }
  };

  // v10.2:handleTest 修复 P0-1 - 保存 result.error / catch 分支错误消息,渲染时显示给用户
  // v10.2.1:测速失败的 SSRF 错误走前端 i18n 映射(后端透传 ssrfCode + ssrfHost)
  //   - 优先用 ssrfCode 查 i18n key(如 SSRF_METADATA_HOST → error.ssrf.metadataHost)
  //   - 否则用 result.error 作为 message(后端返回的中文/上游错误原文)
  //   - ApiError 对象存 state,渲染时 formatApiError 实时翻译(支持语言切换重译)
  // v10.2.3(P1-6):后端直接透传 i18nKey(无需前端维护映射表),本地映射表作为向后兼容回退
  const SSRF_CODE_TO_I18N_KEY: Record<string, string> = {
    SSRF_METADATA_HOST: "error.ssrf.metadataHost",
    SSRF_METADATA_IP: "error.ssrf.metadataIp",
    SSRF_LOCAL_NON_LOOPBACK: "error.ssrf.localNonLoopback",
    SSRF_INTERNAL_IP: "error.ssrf.internalIp",
    SSRF_UNRESOLVED: "error.ssrf.unresolved",
    SSRF_REDIRECT_BLOCKED: "error.ssrf.redirectBlocked",
    SSRF_URL_INVALID: "error.ssrf.urlInvalid",
    SSRF_PROTOCOL_INVALID: "error.ssrf.protocol",
  };

  const handleTest = async (id: string) => {
    setTestResults(prev => ({ ...prev, [id]: "testing" }));
    try {
      const result = await api.testProvider(id);
      // 后端在 success=false 时返回 error 字段(中文 message)+ ssrfCode + ssrfHost + i18nKey(供前端 i18n 映射)
      let errObj: ApiError | null = null;
      if (!result.success && result.error) {
        // 优先用后端透传的 i18nKey,回退到本地映射表(向后兼容)
        const i18nKey = result.i18nKey || (result.ssrfCode ? SSRF_CODE_TO_I18N_KEY[result.ssrfCode] : undefined);
        const i18nParams = result.ssrfHost ? { host: result.ssrfHost } : undefined;
        errObj = new ApiError(result.error, "INTERNAL_ERROR", 0, undefined, i18nKey, i18nParams);
      }
      setTestResults(prev => ({
        ...prev,
        [id]: { success: result.success, latency: result.latency, error: errObj },
      }));
    } catch (e: any) {
      // 网络错误/429:ApiError 自带 i18nKey(client.ts 已透传),直接存
      setTestResults(prev => ({
        ...prev,
        [id]: { success: false, latency: 0, error: toApiError(e) },
      }));
    }
  };

  const handleToggleFailover = async (p: Provider) => {
    try {
      const newQueue = !p.inFailoverQueue;
      const priority = newQueue ? (providers.filter(x => x.inFailoverQueue).length + 1) : 0;
      await api.updateProvider(p.id, { inFailoverQueue: newQueue, failoverPriority: priority });
      load();
    } catch (e: any) {
      setError(toApiError(e));
    }
  };

  if (loading) return <div className="p-4 text-ide-fg-muted">{t("common.loading")}</div>;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between border-b border-ide-border px-4 py-2">
        <h1 className="flex items-center gap-1 text-sm font-semibold">
          {t("settings.providerManagement")}
          <InfoTip text={t("settings.providerManagementTip")} />
        </h1>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1 bg-ide-accent px-3 py-1 text-xs text-ide-accent-fg hover:bg-ide-accent-hover"
        >
          <Plus size={14} /> {t("settings.addProviderBtn")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div role="alert" className="border border-ide-danger/50 bg-ide-danger/10 px-3 py-2 text-xs text-ide-danger flex items-center gap-2">
            <AlertTriangle size={14} /> {formatApiError(error, t)}
            <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
          </div>
        )}

        {/* 数据流向说明 */}
        <div className="border border-ide-border bg-ide-bg-alt p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-ide-fg">
            <Info size={14} className="text-ide-accent" /> {t("settings.dataFlow")}
            <InfoTip text={t("settings.dataFlowTip")} />
          </div>
        </div>

        {/* 供应商卡片列表 */}
        <div className="space-y-2">
          {providers.map((p) => {
            const cat = CATEGORIES[p.category] || CATEGORIES.custom;
            const test = testResults[p.id];
            return (
              <div
                key={p.id}
                className={cn(
                  "border p-3 transition-colors",
                  p.isActive
                    ? "border-ide-accent bg-ide-accent/5"
                    : "border-ide-border bg-ide-bg-alt hover:border-ide-fg-muted"
                )}
              >
                <div className="flex items-start gap-3">
                  {/* 图标:官方 favicon,回退品牌色徽章 */}
                  <ProviderLogo
                    name={p.name}
                    providerId={p.id}
                    iconColor={p.iconColor}
                    websiteUrl={p.websiteUrl}
                    icon={p.icon}
                    size={40}
                  />

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ide-fg">{p.name}</span>
                      <span
                        className="px-1.5 py-0.5 text-[10px]"
                        style={{ backgroundColor: cat.color + "33", color: cat.color }}
                      >
                        {t(cat.labelKey)}
                      </span>
                      {p.isActive && (
                        <span className="flex items-center gap-1 bg-ide-accent/20 px-1.5 py-0.5 text-[10px] text-ide-accent">
                          <CheckCircle2 size={10} /> {t("settings.activated")}
                        </span>
                      )}
                      {p.inFailoverQueue && (
                        <span className="flex items-center gap-1 bg-ide-warning/20 px-1.5 py-0.5 text-[10px] text-ide-warning">
                          <Zap size={10} /> {t("settings.failoverBadge", { n: p.failoverPriority ?? 0 })}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-ide-fg-muted truncate">
                      {p.isLocal ? t("settings.localInferencePrefix") : ""}{p.modelName || t("settings.modelNotSet")} · {p.baseUrl}
                    </div>
                    {p.notes && <div className="mt-0.5 text-xs text-ide-fg-muted">{p.notes}</div>}

                    {/* 测速结果 - v10.2.1:加 role="alert" 让屏幕阅读器播报失败结果(P1-4)+ formatApiError 实时翻译(P0-5)*/}
                    {test && test !== "testing" && (
                      <div
                        role={test.success ? "status" : "alert"}
                        className={cn("mt-1 text-xs", test.success ? "text-ide-success" : "text-ide-danger")}
                      >
                        {test.success
                          ? t("settings.testLatencyOk", { n: test.latency })
                          : (
                            <span>
                              {t("settings.connectionFailShort")}
                              {test.error && <span className="text-ide-danger/80"> · {formatApiError(test.error, t)}</span>}
                            </span>
                          )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 操作按钮组:常驻可见(图标 + 文字),解决"图标按钮不直观"问题 */}
                <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-ide-border pt-2">
                  {/* 测速 / 测试连接 */}
                  <button
                    onClick={() => handleTest(p.id)}
                    disabled={test === "testing"}
                    title={t("settings.testConnectionTip")}
                    className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-[11px] text-ide-fg hover:border-ide-accent hover:text-ide-accent disabled:opacity-50"
                  >
                    {test === "testing" ? <Activity size={11} className="animate-spin" /> : <Activity size={11} />}
                    {test === "testing" ? t("settings.testingConnection") : t("settings.testConnectionBtn")}
                  </button>

                  {/* 设为当前(非激活时显示,主操作强调色) */}
                  {!p.isActive && (
                    <button
                      onClick={() => handleActivate(p.id)}
                      title={t("settings.setAsCurrentTip")}
                      className="flex h-6 items-center gap-1 bg-ide-accent px-2 text-[11px] text-ide-accent-fg hover:bg-ide-accent-hover"
                    >
                      <Star size={11} /> {t("settings.setAsCurrent")}
                    </button>
                  )}

                  {/* 故障转移开关 */}
                  <button
                    onClick={() => handleToggleFailover(p)}
                    title={p.inFailoverQueue ? t("settings.leaveFailoverTip") : t("settings.joinFailoverTip")}
                    className={cn(
                      "flex h-6 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-[11px] hover:border-ide-warning hover:text-ide-warning",
                      p.inFailoverQueue ? "text-ide-warning border-ide-warning/40" : "text-ide-fg-muted"
                    )}
                  >
                    {p.inFailoverQueue ? <Zap size={11} /> : <ZapOff size={11} />}
                    {p.inFailoverQueue ? t("settings.joinedFailover") : t("settings.joinFailover")}
                  </button>

                  {/* 编辑 */}
                  <button
                    onClick={() => setEditingProvider(p)}
                    title={t("settings.editProviderTip")}
                    className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-[11px] text-ide-fg hover:border-ide-accent hover:text-ide-accent"
                  >
                    <Edit3 size={11} /> {t("common.edit")}
                  </button>

                  {/* 删除(危险操作) */}
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    title={t("settings.deleteProviderTip")}
                    className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-[11px] text-ide-fg-muted hover:border-ide-danger hover:text-ide-danger"
                  >
                    <Trash2 size={11} /> {t("common.delete")}
                  </button>
                </div>

                {/* API Key 输入(非本地供应商) */}
                {!p.isLocal && (
                  <ApiKeyRow providerId={p.id} hasKey={p.hasKey} onSaved={() => { load(); showToast(t("settings.apiKeySaved")); }} />
                )}
              </div>
            );
          })}
        </div>

        {/* 快捷键 */}
        <div className="border border-ide-border bg-ide-bg-alt p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-ide-fg mb-2">
            <Keyboard size={14} className="text-ide-accent" /> {t("settings.shortcuts")}
          </div>
          <div className="space-y-1">
            {SHORTCUTS.map(s => (
              <div key={s.keys} className="flex items-center justify-between text-xs">
                <span className="text-ide-fg-muted">{s.desc}</span>
                <kbd className="border border-ide-border bg-ide-bg px-1.5 py-0.5 font-mono text-ide-fg">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </div>

        {/* 主题 */}
        <div className="border border-ide-border bg-ide-bg-alt p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-ide-fg mb-2">
            <Palette size={14} className="text-ide-accent" /> {t("settings.theme")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {THEMES.map(theme => {
              const selected = theme.id === themeId;
              return (
                <button
                  key={theme.id}
                  onClick={() => handleThemeChange(theme.id)}
                  className={cn(
                    "flex items-center gap-2 border p-2 text-left transition-colors",
                    selected
                      ? "border-ide-accent bg-ide-accent/10"
                      : "border-ide-border hover:bg-ide-bg-active"
                  )}
                >
                  <div className="flex shrink-0 gap-px">
                    {theme.swatch.map((c, i) => (
                      <span key={i} className="h-4 w-2.5" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn("truncate text-xs", selected ? "text-ide-accent" : "text-ide-fg")}>{t(theme.nameKey)}</div>
                    <div className="truncate text-[10px] text-ide-fg-muted">{t(theme.descKey)}</div>
                  </div>
                  {selected && <CheckCircle2 size={12} className="shrink-0 text-ide-accent" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 语言 */}
        <div className="border border-ide-border bg-ide-bg-alt p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ide-fg">
            <Languages size={14} className="text-ide-accent" /> {t("settings.language")}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LOCALES.map((l) => {
              const selected = l.code === locale;
              return (
                <button
                  key={l.code}
                  onClick={() => setLocale(l.code as Locale)}
                  className={cn(
                    "flex min-w-0 items-center gap-2 border p-2 text-left transition-colors",
                    selected
                      ? "border-ide-accent bg-ide-accent/10"
                      : "border-ide-border hover:bg-ide-bg-active"
                  )}
                  title={l.englishName}
                >
                  <span className={cn("truncate text-xs", selected ? "text-ide-accent" : "text-ide-fg")}>
                    {l.label}
                  </span>
                  {l.dir === "rtl" && (
                    <span className="ml-auto shrink-0 rounded bg-ide-bg-active px-1 text-[9px] text-ide-fg-muted">RTL</span>
                  )}
                  {selected && <CheckCircle2 size={12} className="shrink-0 text-ide-accent" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 访问令牌 */}
        <div className="border border-ide-border bg-ide-bg-alt p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ide-fg">
            <Key size={14} className="text-ide-accent" /> {t("settings.apiToken")}
            {hasApiToken ? (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-ide-success">
                <CheckCircle2 size={10} /> {t("settings.apiTokenSet")}
              </span>
            ) : (
              <span className="ml-auto text-[10px] text-ide-fg-muted">{t("settings.apiTokenNotSet")}</span>
            )}
          </div>
          <p className="mb-2 text-[10px] text-ide-fg-muted">{t("settings.apiTokenDesc")}</p>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={apiTokenInput}
              onChange={(e) => setApiTokenInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveApiToken(); }}
              placeholder={t("settings.apiTokenPlaceholder")}
              className="min-w-0 flex-1 border border-ide-border bg-ide-bg px-2 py-1 font-mono text-xs text-ide-fg outline-none focus:border-ide-accent"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={handleSaveApiToken}
              disabled={!apiTokenInput.trim()}
              className="flex shrink-0 items-center gap-1 border border-ide-border px-2 py-1 text-xs text-ide-fg transition-colors hover:bg-ide-bg-active disabled:opacity-40"
            >
              <Save size={12} /> {t("common.save")}
            </button>
            {hasApiToken && (
              <button
                onClick={handleClearApiToken}
                className="flex shrink-0 items-center gap-1 border border-ide-border px-2 py-1 text-xs text-ide-danger transition-colors hover:bg-ide-danger/10"
              >
                <Trash2 size={12} /> {t("common.clear")}
              </button>
            )}
          </div>
        </div>

        {/* 第三方集成 */}
        <IntegrationSettings />
      </div>

      {/* 编辑/添加弹窗 */}
      {(editingProvider || showAddForm) && (
        <ProviderEditModal
          provider={editingProvider}
          onClose={() => { setEditingProvider(null); setShowAddForm(false); }}
          onSaved={() => { setEditingProvider(null); setShowAddForm(false); load(); showToast(t("common.success")); }}
        />
      )}

      {/* Toast 由全局 ToastContainer 统一渲染 */}
    </div>
  );
}

// API Key 输入行
function ApiKeyRow({ providerId, hasKey, onSaved }: { providerId: string; hasKey?: boolean; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  const handleSave = async () => {
    if (!key.trim()) return;
    setSaving(true);
    try {
      // apiKey 走独立的 /keys 接口(不入 providers 表,出于安全考虑)
      // Provider 接口不暴露 apiKey 字段,见 api/types.ts
      await api.saveKey(providerId, key.trim());
      setKey("");
      onSaved();
    } catch (e: any) {
      toastError(formatApiError(e, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-2 border-t border-ide-border pt-2">
      <Key size={12} className="text-ide-fg-muted shrink-0" />
      <input
        type={show ? "text" : "password"}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={hasKey ? t("settings.apiKeyConfigured") : t("settings.apiKeyPlaceholder")}
        className="h-7 flex-1 border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg placeholder-ide-fg-muted"
      />
      <button
        onClick={() => setShow(!show)}
        className="text-xs text-ide-fg-muted hover:text-ide-fg"
      >
        {show ? t("settings.hide") : t("settings.show")}
      </button>
      <button
        onClick={handleSave}
        disabled={saving || !key.trim()}
        className="flex items-center gap-1 bg-ide-accent px-2 py-1 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
      >
        <Save size={12} /> {saving ? t("settings.savingBtn") : t("common.save")}
      </button>
      {hasKey && <CheckCircle2 size={14} className="text-ide-success" />}
    </div>
  );
}

// 供应商编辑/添加弹窗
function ProviderEditModal({ provider, onClose, onSaved }: { provider: Provider | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: provider?.name || "",
    category: provider?.category || "custom",
    baseUrl: provider?.baseUrl || "",
    modelName: provider?.modelName || "",
    apiFormat: provider?.apiFormat || "openai_chat",
    apiKey: "",
    icon: provider?.icon || "",
    iconColor: provider?.iconColor || "#607D8B",
    notes: provider?.notes || "",
    websiteUrl: provider?.websiteUrl || "",
  });
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  const handleSave = async () => {
    if (!form.name.trim() || !form.baseUrl.trim()) {
      toastError(t("settings.nameRequired"));
      return;
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(form.baseUrl);
    } catch {
      toastError(t("settings.urlInvalid"));
      return;
    }
    // 仅允许 http/https,拦截 file:/javascript:/data: 等危险 scheme
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      toastError(t("settings.urlScheme"));
      return;
    }
    setSaving(true);
    try {
      const data: any = { ...form };
      if (!form.apiKey) delete data.apiKey;
      if (provider) {
        await api.updateProvider(provider.id, data);
      } else {
        await api.createProvider(data);
      }
      onSaved();
    } catch (e: any) {
      // v10.2:SSRF/校验类错误优先用 i18nKey 渲染(后端透传 code/i18nKey/i18nParams)
      toastError(formatApiError(e, t));
    } finally {
      setSaving(false);
    }
  };

  // v10.2:local 分类 placeholder 联动 - 引导用户填本机地址而非外部 URL
  const isLocalCategory = form.category === "local";
  const baseUrlPlaceholder = isLocalCategory
    ? t("settings.placeholder.baseUrlLocal")
    : t("settings.placeholder.baseUrl");

  // v10.2.1:Modal a11y - Escape 关闭 + focus trap(简易版)+ restore focus
  // 修复 P0-3:键盘/屏幕阅读器用户无法使用 Modal(原无 role/Escape/focus trap)
  // v10.2.2:用 useRef 持有 onClose 避免 deps 重跑(P1-2)+ 选择器排除 disabled(P1-3)+ 初始焦点到第一个可聚焦元素(P1-4)
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    const modal = modalRef.current;
    // 初始聚焦到第一个可聚焦元素(避免容器 tabIndex=-1 导致 Shift+Tab 逃逸)
    const getFocusables = () => modal
      ? Array.from(modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null || el === document.activeElement)
      : [];
    const focusables = getFocusables();
    if (focusables.length > 0) {
      focusables[0].focus();
    } else if (modal) {
      modal.focus();
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && modal) {
        // focus trap:在 Modal 内的可聚焦元素(排除 disabled/隐藏)间循环
        const list = getFocusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        // 当前焦点在容器或第一个元素时,Shift+Tab 跳到最后
        if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden"; // 防背景滚动
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      // 恢复焦点
      if (previousFocusRef.current) {
        try { previousFocusRef.current.focus(); } catch { /* 已被卸载 */ }
      }
    };
  }, []);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-modal-title"
        tabIndex={-1}
        className="w-full max-w-[480px] max-h-[80vh] overflow-y-auto border border-ide-border bg-ide-bg-alt outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ide-border px-4 py-3">
          <h2 id="provider-modal-title" className="text-sm font-semibold">{provider ? t("settings.editProviderTitle") : t("settings.addProviderTitle")}</h2>
          <button onClick={onClose} aria-label={t("common.close")} className="text-ide-fg-muted hover:text-ide-fg"><X size={16} /></button>
        </div>

        <div className="space-y-3 p-4">
          <Field label={t("settings.field.name")}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-sm text-ide-fg" placeholder={t("settings.placeholder.deepseek")} />
          </Field>

          <Field label={t("settings.field.category")}>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-sm text-ide-fg">
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>{t(v.labelKey)}</option>
              ))}
            </select>
          </Field>

          <Field label={t("settings.field.baseUrl")}>
            <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 font-mono text-xs text-ide-fg" placeholder={baseUrlPlaceholder} />
            {isLocalCategory && (
              <div className="mt-1 text-[10px] text-ide-fg-muted">{t("settings.localUrlHint")}</div>
            )}
          </Field>

          <Field label={t("settings.field.modelName")}>
            <input value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })}
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-sm text-ide-fg" placeholder={t("settings.placeholder.modelName")} />
          </Field>

          <Field label={t("settings.field.apiFormat")}>
            <select value={form.apiFormat} onChange={(e) => setForm({ ...form, apiFormat: e.target.value })}
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-sm text-ide-fg">
              <option value="openai_chat">{t("settings.apiFormatOpenAI")}</option>
              <option value="anthropic">{t("settings.apiFormatAnthropic")}</option>
            </select>
          </Field>

          <Field label={t("settings.field.apiKeyOptional")}>
            <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-sm text-ide-fg" placeholder={t("settings.placeholder.apiKey")} />
          </Field>

          <div className="flex gap-2">
            <Field label={t("settings.field.iconPreview")}>
              <div className="flex h-8 items-center gap-2">
                <ProviderLogo
                  name={form.name || t("settings.providerDefaultName")}
                  providerId={provider?.id}
                  iconColor={form.iconColor}
                  websiteUrl={form.websiteUrl}
                  icon={form.icon}
                  size={32}
                />
                <span className="text-xs text-ide-fg-muted">{t("settings.iconPreviewHint")}</span>
              </div>
            </Field>
            <Field label={t("settings.field.iconColor")}>
              <input type="color" value={form.iconColor} onChange={(e) => setForm({ ...form, iconColor: e.target.value })}
                className="h-8 w-full border border-ide-border bg-ide-bg" />
            </Field>
          </div>

          <Field label={t("settings.field.websiteUrl")}>
            <input value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-sm text-ide-fg" placeholder="https://..." />
          </Field>

          <Field label={t("settings.field.notes")}>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full border border-ide-border bg-ide-bg px-2 py-1 text-sm text-ide-fg" rows={2} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-ide-border px-4 py-3">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-ide-fg-muted hover:bg-ide-bg-active">{t("common.cancel")}</button>
          <button onClick={handleSave} disabled={saving}
            className="bg-ide-accent px-3 py-1.5 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50">
            {saving ? t("settings.savingBtn") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // v10.2.6(D3):用 <label> 包裹,自动关联内部 input,点击文本聚焦输入框
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ide-fg-muted">{label}</span>
      {children}
    </label>
  );
}
