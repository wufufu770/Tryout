import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Store, Search, Download, Check, Link2, Upload, Github, X } from "lucide-react";
import { cn } from "@/shared";
import { api } from "@/api/client";
import { useAgentStore } from "@/stores/agentStore";
import { MARKET_AGENTS, MARKET_CATEGORIES, MARKET_CATEGORY_I18N_KEYS, agentI18nKey, type MarketAgentTemplate, type MarketCategory } from "@/data/marketAgents";
import type { AgentRole, AgentTone, AgentKind } from "@/types/agent";
import {
  fetchJsonFromUrl, validateAgent, normalizeAgent, readJsonFile,
} from "@/lib/community";
import { useI18n } from "@/i18n";
import { useModalA11y } from "@/lib/useModalA11y";

// 分号分隔的字符串按 i18n 拆成数组(去空格,丢弃空段)
function splitI18nList(raw: string): string[] {
  if (!raw) return [];
  return raw.split(";").map((s) => s.trim()).filter(Boolean);
}

const ROLE_BADGE: Record<AgentRole, { cls: string }> = {
  hr: { cls: "bg-ide-accent/20 text-ide-accent" },
  tech: { cls: "bg-ide-success/20 text-ide-success" },
  ceo: { cls: "bg-ide-warning/20 text-ide-warning" },
  custom: { cls: "bg-ide-fg-muted/20 text-ide-fg-muted" },
  // candidate 是历史值(后端旧数据),前端 UI 不再使用,显示为"候选人"
  candidate: { cls: "bg-ide-fg-muted/20 text-ide-fg-muted" },
};

function DifficultyStars({ value }: { value: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-0.5" title={t("market.difficultyTitle", { value })}>
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            i < value ? "bg-ide-accent" : "bg-ide-border"
          )}
        />
      ))}
      <span className="ml-1 text-[10px] text-ide-fg-muted">{value}/10</span>
    </div>
  );
}

export function MarketPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof MARKET_CATEGORIES)[number]>("全部");
  const [importingId, setImportingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 社区导入对话框
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const importModalRef = useModalA11y(() => setImportDialogOpen(false), importDialogOpen);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const roleLabel = (role: AgentRole) => t("market.role." + role);

  // Agent 字段 i18n helper:优先查 i18n key,查不到回退到模板原值
  const agentName = (tpl: MarketAgentTemplate): string => {
    const k = agentI18nKey(tpl.id, "name");
    const v = t(k);
    return v === k ? tpl.name : v;
  };
  const agentDesc = (tpl: MarketAgentTemplate): string => {
    const k = agentI18nKey(tpl.id, "desc");
    const v = t(k);
    return v === k ? tpl.description : v;
  };
  const agentTags = (tpl: MarketAgentTemplate): string[] => {
    const k = agentI18nKey(tpl.id, "tags");
    const v = t(k);
    return v === k ? tpl.tags : splitI18nList(v);
  };
  const agentFocus = (tpl: MarketAgentTemplate): string[] => {
    const k = agentI18nKey(tpl.id, "focus");
    const v = t(k);
    return v === k ? tpl.focusAreas : splitI18nList(v);
  };
  const categoryLabel = (c: "全部" | MarketCategory): string => {
    const k = MARKET_CATEGORY_I18N_KEYS[c];
    const v = t(k);
    return v === k ? c : v;
  };

  // 拉取现有面试官列表,用于"已导入"匹配(按 name)
  useEffect(() => {
    loadAgents("interviewer");
  }, [loadAgents]);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const importedNames = useMemo(() => {
    return new Set(agents.map((a) => a.name));
  }, [agents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MARKET_AGENTS.filter((tpl) => {
      if (category !== "全部" && tpl.category !== category) return false;
      if (!q) return true;
      // 同时匹配原值与 i18n 后的值,提升英文/其他语言下的搜索体验
      const name = agentName(tpl).toLowerCase();
      const desc = agentDesc(tpl).toLowerCase();
      const tags = agentTags(tpl).map((s) => s.toLowerCase());
      const focus = agentFocus(tpl).map((s) => s.toLowerCase());
      return (
        name.includes(q) || tpl.name.toLowerCase().includes(q) ||
        desc.includes(q) || tpl.description.toLowerCase().includes(q) ||
        tags.some((s) => s.includes(q)) || tpl.tags.some((s) => s.toLowerCase().includes(q)) ||
        focus.some((s) => s.includes(q)) || tpl.focusAreas.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [query, category, t]);

  const handleImport = async (tpl: MarketAgentTemplate) => {
    setError(null);
    setImportingId(tpl.id);
    try {
      await api.createAgent({
        name: tpl.name,
        role: tpl.role,
        avatar: tpl.avatar,
        promptTemplate: tpl.prompt,
        focusAreas: tpl.focusAreas,
        tone: tpl.tone,
        difficulty: tpl.difficulty,
        agentKind: "interviewer",
      });
      // 刷新列表以让"已导入"状态即时更新
      await loadAgents("interviewer");
      setToast(t("market.importSuccess", { name: tpl.name }));
      // 跳转到 Agent 工作台,让用户立刻看到新导入的 agent
      navigate("/agents");
    } catch (e: any) {
      setError(t("market.importFailed", { msg: String(e.message) }));
    } finally {
      setImportingId(null);
    }
  };

  // 从 URL 或文件导入社区分享的 Agent(兼容新旧两种格式)
  const handleCommunityImport = async (rawData: any) => {
    const v = validateAgent(rawData);
    if (!v.valid) throw new Error(v.error || t("market.invalidFormat"));
    const data = normalizeAgent(rawData);
    // normalizeAgent 内部已用白名单校验 role/tone/difficulty,这里安全断言
    await api.createAgent({
      name: data.name,
      role: data.role as AgentRole,
      avatar: data.avatar || "🤖",
      promptTemplate: data.promptTemplate,
      focusAreas: data.focusAreas || [],
      tone: data.tone as AgentTone,
      difficulty: data.difficulty,
      // normalizeAgent 已白名单校验,断言安全
      agentKind: (data.agentKind as AgentKind) || "interviewer",
    });
    await loadAgents("interviewer");
    setToast(t("market.importCommunitySuccess", { name: data.name }));
    navigate("/agents");
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const data = await fetchJsonFromUrl<any>(importUrl.trim());
      await handleCommunityImport(data);
      setImportDialogOpen(false);
      setImportUrl("");
    } catch (e: any) {
      setError(t("market.importFailed", { msg: String(e.message) }));
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const data = await readJsonFile(file);
      await handleCommunityImport(data);
      setImportDialogOpen(false);
    } catch (e: any) {
      setError(t("market.importFailed", { msg: String(e.message) }));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ide-bg text-ide-fg">
      {/* 顶部标题栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-ide-border bg-ide-bg-alt px-4">
        <div className="flex items-center gap-2">
          <Store size={18} className="text-ide-accent" />
          <div>
            <div className="text-sm font-semibold text-ide-fg">{t("market.title")}</div>
            <div className="text-[11px] text-ide-fg-muted">
              {t("market.subtitle", { n: MARKET_AGENTS.length })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ide-fg-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("market.searchPlaceholder")}
              className="h-7 w-64 border border-ide-border bg-ide-bg pl-7 pr-2 text-xs text-ide-fg placeholder:text-ide-fg-muted focus:border-ide-accent focus:outline-none"
            />
          </div>
          <button
            onClick={() => setImportDialogOpen(true)}
            className="flex h-7 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 text-xs text-ide-fg hover:border-ide-accent hover:text-ide-accent"
            title={t("market.importLinkTip")}
          >
            <Link2 size={12} /> {t("market.importLink")}
          </button>
        </div>
      </header>

      {/* 分类筛选 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-ide-border bg-ide-bg-alt px-4 py-2">
        {MARKET_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              "px-2.5 py-1 text-xs",
              category === c
                ? "bg-ide-accent text-ide-accent-fg"
                : "text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg"
            )}
          >
            {categoryLabel(c)}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ide-fg-muted">
          {t("market.totalTemplates", { n: filtered.length, m: MARKET_AGENTS.length })}
        </span>
        {(query || category !== "全部") && (
          <button
            onClick={() => { setQuery(""); setCategory("全部"); }}
            title={t("market.clearFilterTip")}
            className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-[11px] text-ide-fg-muted hover:border-ide-danger hover:text-ide-danger"
          >
            <X size={11} /> {t("experience.clearFilter")}
          </button>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="shrink-0 border-b border-ide-danger/30 bg-ide-danger/10 px-4 py-1.5 text-xs text-ide-danger">
          {error}
        </div>
      )}

      {/* 卡片网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ide-fg-muted">
            {t("market.noMatch")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((tpl) => {
              const imported = importedNames.has(tpl.name);
              const badge = ROLE_BADGE[tpl.role];
              const importing = importingId === tpl.id;
              return (
                <div
                  key={tpl.id}
                  className={cn(
                    "flex flex-col gap-2 border bg-ide-bg-alt p-3 transition-colors",
                    imported ? "border-ide-border opacity-70" : "border-ide-border hover:border-ide-accent"
                  )}
                >
                  {/* 头部:头像 + 名称 + 角色徽章 */}
                  <div className="flex items-start gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-ide-border bg-ide-bg text-lg">
                      {tpl.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ide-fg">{agentName(tpl)}</span>
                        <span className={cn("shrink-0 px-1 text-[10px]", badge.cls)}>{roleLabel(tpl.role)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ide-fg-muted">
                        <span>{t("market.tone." + tpl.tone)}</span>
                        <span className="text-ide-border">·</span>
                        <span>{categoryLabel(tpl.category)}</span>
                      </div>
                    </div>
                  </div>

                  {/* 难度 */}
                  <DifficultyStars value={tpl.difficulty} />

                  {/* 描述 */}
                  <p className="line-clamp-2 text-xs text-ide-fg-muted">{agentDesc(tpl)}</p>

                  {/* tags */}
                  <div className="flex flex-wrap gap-1">
                    {agentTags(tpl).map((tag) => (
                      <span
                        key={tag}
                        className="border border-ide-border bg-ide-bg px-1.5 py-0.5 text-[10px] text-ide-fg-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* 关注领域 */}
                  <div className="mt-auto border-t border-ide-border pt-2 text-[10px] text-ide-fg-muted">
                    <span className="text-ide-fg">{t("market.focus")}</span> {agentFocus(tpl).join(" · ")}
                  </div>

                  {/* 底部:导入按钮 */}
                  <div className="flex items-center justify-end">
                    {imported ? (
                      <span className="flex items-center gap-1 px-2 py-1 text-[11px] text-ide-fg-muted">
                        <Check size={12} /> {t("market.imported")}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleImport(tpl)}
                        disabled={importing}
                        className={cn(
                          "flex h-6 items-center gap-1 bg-ide-accent px-2 text-[11px] text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
                        )}
                      >
                        <Download size={12} />
                        {importing ? t("market.importing") : t("market.import")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 社区分享区 */}
      <div className="shrink-0 border-t border-ide-border bg-ide-bg-alt px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-ide-fg-muted">
          <Github size={14} className="text-ide-accent" />
          <span className="font-medium text-ide-fg">{t("market.communityShare")}</span>
          <span>·</span>
          <span>{t("market.communityShareDesc")}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[11px]">
          <a
            href="https://github.com/topics/tryout-agents"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ide-accent hover:underline"
          >
            {t("market.browseCommunityRepo")}
          </a>
          <span className="text-ide-fg-muted">{t("market.communityFormatHint")}</span>
        </div>
      </div>

      {/* 导入对话框 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportFile}
      />
      {importDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setImportDialogOpen(false)}>
          <div
            ref={importModalRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("market.importCommunityAgent")}
            tabIndex={-1}
            className="w-96 border border-ide-border bg-ide-bg-alt shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-10 items-center justify-between border-b border-ide-border px-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-ide-fg">
                <Link2 size={14} className="text-ide-accent" /> {t("market.importCommunityAgent")}
              </div>
              <button onClick={() => setImportDialogOpen(false)} className="text-ide-fg-muted hover:text-ide-fg">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3 p-4">
              {error && (
                <div className="border border-ide-danger/30 bg-ide-danger/10 px-2 py-1.5 text-xs text-ide-danger">
                  {error}
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-ide-fg-muted">{t("market.importFromUrl")}</label>
                <input
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleImportUrl(); }}
                  placeholder="https://github.com/user/repo/blob/main/agents/foo.json"
                  className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg placeholder:text-ide-fg-muted focus:border-ide-accent focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setImportDialogOpen(false)}
                  className="px-3 py-1.5 text-xs text-ide-fg-muted hover:bg-ide-bg-active"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleImportUrl}
                  disabled={importing || !importUrl.trim()}
                  className="flex items-center gap-1 bg-ide-accent px-3 py-1.5 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
                >
                  <Download size={12} />
                  {importing ? t("market.importing") : t("market.import")}
                </button>
              </div>
              <div className="border-t border-ide-border pt-3">
                <label className="mb-1 block text-xs text-ide-fg-muted">{t("market.importFromFile")}</label>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="flex h-8 w-full items-center justify-center gap-1 border border-ide-border bg-ide-bg text-xs text-ide-fg hover:border-ide-accent disabled:opacity-50"
                >
                  <Upload size={12} /> {t("market.selectFile")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-4 right-4 bg-ide-success px-3 py-2 text-xs text-ide-accent-fg">
          {toast}
        </div>
      )}
    </div>
  );
}
