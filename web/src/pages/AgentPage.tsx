import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { cn } from "@/shared";
import { useAgentStore } from "@/stores/agentStore";
import { useI18n } from "@/i18n";
import { exportAgentConfig, exportShareableAgent, importAgentConfig } from "@/lib/agentIO";
import { PRESET_ICONS } from "@/lib/agentIcon";
import { CANDIDATE_PERSONAS, getPersonaMeta, PERSONA_I18N_KEYS } from "@/lib/candidatePersonas";
import { AgentAvatar } from "@/components/AgentAvatar";
import { InfoTip } from "@/components/InfoTip";
import { api } from "@/api/client";
import type { AgentKind, CandidatePersona } from "@/types/agent";
import { Plus, Trash2, Download, Save, Upload, User, Users, Share2 } from "lucide-react";

export function AgentPage() {
  const { t } = useI18n();
  const agents = useAgentStore((s) => s.agents);
  const currentAgent = useAgentStore((s) => s.currentAgent);
  const loading = useAgentStore((s) => s.loading);
  const storeError = useAgentStore((s) => s.error);

  // i18n helper:优先查 i18n,查不到回退到原值
  const personaLabel = (value: CandidatePersona | null | undefined, fallback?: string): string => {
    if (!value) return fallback || "";
    const k = PERSONA_I18N_KEYS[value]?.labelKey;
    if (!k) return fallback || "";
    const v = t(k);
    return v === k ? (fallback || "") : v;
  };
  const personaDesc = (value: CandidatePersona | null | undefined, fallback?: string): string => {
    if (!value) return fallback || "";
    const k = PERSONA_I18N_KEYS[value]?.descKey;
    if (!k) return fallback || "";
    const v = t(k);
    return v === k ? (fallback || "") : v;
  };
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const addAgent = useAgentStore((s) => s.addAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  const ROLES = [
    { value: "hr", label: t("agent.role.hr") },
    { value: "tech", label: t("agent.role.tech") },
    { value: "ceo", label: t("agent.role.ceo") },
    { value: "custom", label: t("common.custom") },
  ];

  const TONES = [
    { value: "gentle", label: t("agent.tone.gentle") },
    { value: "direct", label: t("agent.tone.direct") },
    { value: "aggressive", label: t("agent.tone.aggressive") },
    { value: "neutral", label: t("agent.tone.neutral") },
  ];

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 编辑器表单状态
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [role, setRole] = useState("custom");
  const [tone, setTone] = useState("gentle");
  const [difficulty, setDifficulty] = useState(5);
  const [focusAreas, setFocusAreas] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [prompt, setPrompt] = useState("");
  // v5:头像与默认模型
  const [iconType, setIconType] = useState<"emoji" | "preset" | "uploaded">("emoji");
  const [iconValue, setIconValue] = useState<string>("");
  const [preferredProviderId, setPreferredProviderId] = useState<string>("");
  const [providers, setProviders] = useState<any[]>([]);
  const [iconUploading, setIconUploading] = useState(false);
  // v6:Tab 切换(面试官 / 候选人) + 候选人画像
  const [activeTab, setActiveTab] = useState<AgentKind>("interviewer");
  const [candidatePersona, setCandidatePersona] = useState<CandidatePersona | "">("");

  const importInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  // v6:按 Tab 重新加载对应 kind 的 agent
  useEffect(() => {
    loadAgents(activeTab);
    // 加载 providers 供默认模型选择
    api.listProviders().then((p) => setProviders(p || [])).catch(() => {});
  }, [loadAgents, activeTab]);

  // v6:切换 Tab 时清空选中
  useEffect(() => {
    selectAgent(null);
  }, [activeTab, selectAgent]);

  // 自动选中第一个
  useEffect(() => {
    if (agents.length > 0 && !currentAgent) {
      selectAgent(agents[0]);
    }
  }, [agents, currentAgent, selectAgent]);

  // 选中 agent 时同步表单
  useEffect(() => {
    if (!currentAgent) return;
    setName(currentAgent.name || "");
    setAvatar(currentAgent.avatar || "");
    setRole(currentAgent.role || "custom");
    setTone(currentAgent.config?.tone || "gentle");
    setDifficulty(currentAgent.config?.difficulty ?? 5);
    setFocusAreas((currentAgent.config?.focusAreas || []).join(", "));
    setPrompt(currentAgent.config?.promptTemplate || "");
    setChangeNote("");
    setSaved(null);
    // v5:同步头像与默认模型
    setIconType((currentAgent.iconType as any) || "emoji");
    setIconValue(currentAgent.iconValue || currentAgent.avatar || "");
    setPreferredProviderId(currentAgent.preferredProviderId || "");
    // v6:同步候选人画像
    setCandidatePersona((currentAgent.candidatePersona as any) || "");
  }, [currentAgent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayError = error || storeError;

  const handleCreate = async () => {
    setError(null);
    try {
      // v6:按当前 Tab 决定 agentKind 和默认配置
      const isCandidate = activeTab === "candidate";
      const created = await addAgent({
        name: isCandidate ? t("agent.newCandidate") : t("agent.newAgent"),
        avatar: isCandidate ? "🧑" : "🤖",
        role: "custom",
        tone: "gentle",
        difficulty: 5,
        focusAreas: [],
        promptTemplate: isCandidate
          ? t("agent.defaultCandidatePrompt")
          : t("interview.prompts.defaultInterviewer"),
        agentKind: activeTab,
        candidatePersona: isCandidate ? "calm" : null,
      });
      selectAgent(created);
    } catch (e: any) {
      setError(t("agent.createFailed", { msg: e.message }));
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    const target = agents.find((a) => a.id === id);
    if (target?.isTemplate) {
      setError(t("agent.templateCannotDelete"));
      return;
    }
    if (!confirm(t("agent.deleteConfirmName", { name: target?.name || id }))) return;
    try {
      await deleteAgent(id);
    } catch (e: any) {
      setError(t("agent.deleteFailed", { msg: e.message }));
    }
  };

  const handleExport = (agent: any) => {
    try {
      exportAgentConfig(agent);
    } catch (e: any) {
      setError(t("agent.exportFailed", { msg: e.message }));
    }
  };

  // 社区分享:导出为 .ix-agent.json,可上传到 GitHub 供其他人通过 URL 导入
  const handleShare = (agent: any) => {
    try {
      exportShareableAgent(agent);
      setSaved(t("agent.shareExported"));
    } catch (e: any) {
      setError(t("agent.shareFailed", { msg: e.message }));
    }
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const imported = await importAgentConfig(file);
      // v6-fix:按当前 Tab 传入 agentKind,避免导入的候选人在候选人 Tab "消失"
      const isCandidate = activeTab === "candidate";
      const created = await addAgent({
        name: imported.name,
        avatar: imported.avatar,
        role: imported.role,
        tone: imported.tone || "gentle",
        difficulty: imported.difficulty || 5,
        focusAreas: imported.focusAreas || [],
        promptTemplate: imported.promptTemplate,
        agentKind: activeTab,
        candidatePersona: isCandidate ? (imported.candidatePersona || "calm") : null,
      });
      selectAgent(created);
    } catch (e: any) {
      setError(t("agent.importFailed", { msg: e.message }));
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaved(null);
    if (!currentAgent) return;
    if (!name.trim()) {
      setError(t("agent.nameRequired"));
      return;
    }
    if (!prompt.trim()) {
      setError(t("agent.promptRequired"));
      return;
    }
    setSaving(true);
    try {
      const focusArr = focusAreas
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // v5:带上图标类型/值/默认模型
      // emoji 模式下 iconValue 与 avatar 保持一致;preset 模式 iconValue 为图标 key
      const finalAvatar = iconType === "emoji" ? avatar : (iconType === "preset" ? "" : "");
      await updateAgent(
        currentAgent.id,
        {
          name,
          avatar: finalAvatar,
          role,
          iconType,
          iconValue: iconType === "emoji" ? avatar : iconValue,
          preferredProviderId: preferredProviderId || null,
          // v6:透传 agentKind 与候选人画像
          agentKind: activeTab,
          candidatePersona: activeTab === "candidate" ? (candidatePersona || null) : null,
        },
        {
          tone,
          difficulty,
          focusAreas: focusArr,
          promptTemplate: prompt,
          changelog: changeNote,
        }
      );
      setSaved(t("agent.saveSuccess"));
    } catch (e: any) {
      setError(t("agent.saveFailed", { msg: e.message }));
    } finally {
      setSaving(false);
    }
  };

  // v5:图标上传
  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentAgent) return;
    // 安全 P0:运行时二次校验文件类型,阻断 SVG(可执行脚本)上传,accept 属性仅为 UI 提示
    const ALLOWED_ICON_TYPES = ["image/png", "image/jpeg", "image/webp"];
    if (!ALLOWED_ICON_TYPES.includes(file.type)) {
      setError(t("agent.iconUploadFailed", { msg: file.type || file.name }));
      if (iconInputRef.current) iconInputRef.current.value = "";
      return;
    }
    setError(null);
    setIconUploading(true);
    try {
      // 先保存当前 Agent 的基本字段,确保 Agent 存在
      await api.uploadAgentIcon(currentAgent.id, file);
      setIconType("uploaded");
      // 触发 Avatar 重新加载(通过变更引用)
      setIconValue(`uploaded:${Date.now()}`);
      setSaved(t("agent.iconUploaded"));
    } catch (e: any) {
      setError(t("agent.iconUploadFailed", { msg: e.message }));
    } finally {
      setIconUploading(false);
      if (iconInputRef.current) iconInputRef.current.value = "";
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* 左栏 Agent 列表 */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-ide-border bg-ide-bg-alt">
        {/* v6:Tab 切换 - 面试官 / 候选人 */}
        <div className="flex border-b border-ide-border">
          <button
            onClick={() => setActiveTab("interviewer")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 px-2 py-2 text-xs font-semibold uppercase outline-none",
              activeTab === "interviewer"
                ? "border-b-2 border-ide-accent text-ide-accent"
                : "text-ide-fg-muted hover:text-ide-fg"
            )}
          >
            <User size={12} /> {t("agent.kind.interviewer")}
          </button>
          <button
            onClick={() => setActiveTab("candidate")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 px-2 py-2 text-xs font-semibold uppercase outline-none",
              activeTab === "candidate"
                ? "border-b-2 border-ide-accent text-ide-accent"
                : "text-ide-fg-muted hover:text-ide-fg"
            )}
          >
            <Users size={12} /> {t("agent.kind.candidate")}
          </button>
        </div>
        <div className="border-b border-ide-border px-3 py-2">
          <div className="mb-1.5 text-xs font-semibold uppercase text-ide-fg-muted">
            {activeTab === "interviewer" ? t("agent.interviewerAgents") : t("agent.aiCandidates")}
          </div>
          <div className="flex gap-1">
            <button
              onClick={handleCreate}
              title={activeTab === "interviewer" ? t("agent.newInterviewer") : t("agent.newCandidate")}
              className="flex h-7 flex-1 items-center justify-center gap-1 bg-ide-accent text-[11px] text-ide-accent-fg hover:bg-ide-accent-hover"
            >
              <Plus size={12} /> {t("agent.new")}
            </button>
            <button
              onClick={handleImportClick}
              title={t("agent.importTip")}
              className="flex h-7 flex-1 items-center justify-center gap-1 border border-ide-border bg-ide-bg text-[11px] text-ide-fg hover:border-ide-accent hover:text-ide-accent"
            >
              <Upload size={12} /> {t("common.import")}
            </button>
          </div>
        </div>
        <input
          ref={importInputRef}
          type="file"
          className="hidden"
          onChange={handleImportFile}
          accept=".ixagent,.json"
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && agents.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-ide-fg-muted">{t("common.loading")}</div>
          )}
          {!loading && agents.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-ide-fg-muted">{t("agent.noAgent")}</div>
          )}
          <ul className="flex flex-col gap-1">
            {agents.map((a) => (
              <li
                key={a.id}
                role="button"
                tabIndex={0}
                onClick={() => selectAgent(a)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectAgent(a);
                  }
                }}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ide-accent",
                  a.id === currentAgent?.id ? "bg-ide-bg-active text-ide-fg" : "hover:bg-ide-bg-active text-ide-fg-muted"
                )}
              >
                <AgentAvatar agent={a} size={20} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-ide-fg">{a.name}</span>
                    {a.isTemplate && (
                      <span className="bg-ide-accent/20 px-1 text-[10px] text-ide-accent">{t("agent.template")}</span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-ide-fg-muted">
                    {activeTab === "candidate" && a.candidatePersona
                      ? personaLabel(a.candidatePersona, getPersonaMeta(a.candidatePersona)?.label || a.role)
                      : a.role || "-"}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShare(a);
                    }}
                    title={t("agent.shareTip")}
                    className="flex h-5 w-5 items-center justify-center text-ide-accent hover:bg-ide-bg"
                  >
                    <Share2 size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExport(a);
                    }}
                    title={t("agent.exportTip")}
                    className="flex h-5 w-5 items-center justify-center hover:bg-ide-bg"
                  >
                    <Download size={12} />
                  </button>
                  {!a.isTemplate && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(a.id);
                      }}
                      title={t("common.delete")}
                      className="flex h-5 w-5 items-center justify-center text-ide-danger hover:bg-ide-bg"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* 右栏 Agent 编辑器 */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!currentAgent ? (
          <div className="flex h-full items-center justify-center text-ide-fg-muted">
            <div className="text-center">
              <p className="text-sm">{t("agent.noSelection")}</p>
              <p className="mt-1 text-xs">{t("agent.noSelectionHint")}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-ide-border bg-ide-bg-alt px-3 text-xs">
              <div className="flex items-center gap-2 truncate text-ide-fg">
                <AgentAvatar agent={currentAgent} size={20} />
                <span className="truncate">{currentAgent.name}</span>
                {currentAgent.isTemplate && (
                  <span className="bg-ide-accent/20 px-1 text-[10px] text-ide-accent">{t("agent.templateReadonly")}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {displayError && <span role="alert" className="text-ide-danger">{displayError}</span>}
                {saved && <span className="text-ide-success">{saved}</span>}
                <button
                  onClick={handleSave}
                  disabled={saving || currentAgent.isTemplate}
                  className="flex h-6 items-center gap-1 bg-ide-accent px-2 text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
                >
                  <Save size={12} />
                  {t("common.save")}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-ide-fg-muted">{t("agent.name")}</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={currentAgent.isTemplate}
                    className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-ide-fg disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                    {t("agent.role")}
                    <InfoTip text={t("agent.roleTip")} />
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={currentAgent.isTemplate}
                    className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-ide-fg disabled:opacity-60"
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* v5:头像三选一 */}
              <div className="border border-ide-border p-2">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs text-ide-fg-muted">{t("agent.interviewerIcon")}</label>
                  <div className="flex items-center gap-1">
                    {iconType === "uploaded" && currentAgent && !currentAgent.isTemplate && (
                      <span className="flex items-center gap-1 text-[10px] text-ide-success">
                        <AgentAvatar agent={{ ...currentAgent, iconType: "uploaded" }} size={16} /> {t("agent.uploaded")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* 类型切换 */}
                  <div className="flex border border-ide-border">
                    {(["emoji", "preset", "uploaded"] as const).map((it) => (
                      <button
                        key={it}
                        onClick={() => !currentAgent.isTemplate && setIconType(it)}
                        disabled={currentAgent.isTemplate}
                        className={cn(
                          "px-2 py-1 text-xs",
                          iconType === it ? "bg-ide-accent text-ide-accent-fg" : "text-ide-fg-muted hover:bg-ide-bg-active"
                        )}
                      >
                        {it === "emoji" ? t("agent.iconType.emoji") : it === "preset" ? t("agent.iconType.preset") : t("agent.iconType.uploaded")}
                      </button>
                    ))}
                  </div>
                  {/* 预览 */}
                  <div className="ml-auto">
                    <AgentAvatar
                      agent={{
                        id: currentAgent.id,
                        avatar: iconType === "emoji" ? avatar : "",
                        iconType,
                        iconValue: iconType === "emoji" ? avatar : iconValue,
                      }}
                      size={32}
                    />
                  </div>
                </div>
                {/* emoji 输入 */}
                {iconType === "emoji" && (
                  <input
                    type="text"
                    value={avatar}
                    onChange={(e) => { setAvatar(e.target.value); setIconValue(e.target.value); }}
                    disabled={currentAgent.isTemplate}
                    placeholder={t("agent.emojiPlaceholder")}
                    className="mt-2 h-7 w-full border border-ide-border bg-ide-bg px-2 text-ide-fg disabled:opacity-60"
                  />
                )}
                {/* 预设图标网格 */}
                {iconType === "preset" && (
                  <div className="mt-2 grid max-h-32 grid-cols-8 gap-1 overflow-y-auto">
                    {PRESET_ICONS.map((ic) => (
                      <button
                        key={ic.key}
                        onClick={() => !currentAgent.isTemplate && setIconValue(ic.key)}
                        disabled={currentAgent.isTemplate}
                        title={ic.label}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center",
                          iconValue === ic.key ? "bg-ide-accent/30 ring-1 ring-ide-accent" : "hover:bg-ide-bg-active"
                        )}
                        style={{ color: ic.color }}
                      >
                        <ic.Component size={16} />
                      </button>
                    ))}
                  </div>
                )}
                {/* 上传 */}
                {iconType === "uploaded" && (
                  <div className="mt-2">
                    <input
                      ref={iconInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={handleIconUpload}
                    />
                    <button
                      onClick={() => iconInputRef.current?.click()}
                      disabled={currentAgent.isTemplate || iconUploading}
                      className="flex h-7 items-center gap-1 bg-ide-accent px-2 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
                    >
                      <Upload size={12} />
                      {iconUploading ? t("agent.uploading") : t("agent.selectImage")}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                    {t("agent.askStyle")}
                    <InfoTip text={t("agent.toneTip")} />
                  </label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    disabled={currentAgent.isTemplate}
                    className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-ide-fg disabled:opacity-60"
                  >
                    {TONES.map((tn) => (
                      <option key={tn.value} value={tn.value}>
                        {tn.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                    {t("agent.difficultyLabel")}<span className="text-ide-accent">{difficulty}</span>
                    <InfoTip text={t("agent.difficultyTip")} />
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={difficulty}
                    onChange={(e) => setDifficulty(Number(e.target.value))}
                    disabled={currentAgent.isTemplate}
                    className="w-full accent-ide-accent disabled:opacity-60"
                  />
                </div>
              </div>

              {/* v5:默认模型 */}
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                  {t("agent.defaultModel")}
                  <InfoTip text={t("agent.defaultModelTip")} />
                </label>
                <select
                  value={preferredProviderId}
                  onChange={(e) => setPreferredProviderId(e.target.value)}
                  disabled={currentAgent.isTemplate}
                  className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-ide-fg disabled:opacity-60"
                >
                  <option value="">{t("agent.useGlobalProvider")}</option>
                  {providers.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.isActive ? t("agent.current") : ""}{p.modelName ? ` · ${p.modelName}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* v6:候选人画像选择器(仅 candidate Tab 显示) */}
              {activeTab === "candidate" && (
                <div className="border border-ide-border p-2">
                  <label className="mb-2 flex items-center gap-1 text-xs text-ide-fg-muted">
                    {t("agent.candidatePersona")}
                    <InfoTip text={t("agent.candidatePersonaTip")} />
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CANDIDATE_PERSONAS.map((p) => {
                      const PersonaIcon = p.icon;
                      const selected = candidatePersona === p.value;
                      return (
                        <button
                          key={p.value}
                          onClick={() => !currentAgent.isTemplate && setCandidatePersona(p.value)}
                          disabled={currentAgent.isTemplate}
                          title={personaDesc(p.value, p.desc)}
                          className={cn(
                            "flex items-center gap-1.5 border px-2 py-1.5 text-left text-xs outline-none transition-colors disabled:opacity-60",
                            selected
                              ? "border-ide-accent bg-ide-accent/10 text-ide-fg"
                              : "border-ide-border bg-ide-bg text-ide-fg-muted hover:bg-ide-bg-active"
                          )}
                        >
                          <PersonaIcon size={14} style={{ color: p.color }} />
                          <span className="flex-1 truncate">{personaLabel(p.value, p.label)}</span>
                        </button>
                      );
                    })}
                  </div>
                  {candidatePersona && (
                    <div className="mt-2 bg-ide-bg-alt p-2 text-[11px] text-ide-fg-muted">
                      {personaDesc(candidatePersona as CandidatePersona, getPersonaMeta(candidatePersona as CandidatePersona)?.desc)}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                  {t("agent.focusAreas")}
                  <InfoTip text={t("agent.focusAreasTip")} />
                </label>
                <input
                  type="text"
                  value={focusAreas}
                  onChange={(e) => setFocusAreas(e.target.value)}
                  disabled={currentAgent.isTemplate}
                  placeholder={t("agent.focusAreasPlaceholder")}
                  className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-ide-fg disabled:opacity-60"
                />
              </div>

              <div>
                <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                  {t("agent.changeNote")}
                  <InfoTip text={t("agent.changeNoteTip")} />
                </label>
                <input
                  type="text"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                  disabled={currentAgent.isTemplate}
                  placeholder={t("agent.changeNotePlaceholder")}
                  className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-ide-fg disabled:opacity-60"
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                  {t("agent.promptSource")}
                  <InfoTip text={t("agent.promptTip")} />
                </label>
                <div className="min-h-[200px] flex-1 overflow-hidden border border-ide-border">
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    language="markdown"
                    value={prompt}
                    onChange={(v) => setPrompt(v || "")}
                    options={{
                      readOnly: currentAgent.isTemplate,
                      minimap: { enabled: false },
                      fontSize: 13,
                      wordWrap: "on",
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
