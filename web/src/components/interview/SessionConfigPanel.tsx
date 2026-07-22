// InterviewPage 子组件:会话配置面板(左栏)
// 抽出 v10 C2 渐进式披露的配置面板(场景/标题/难度/流程/重点/资料/面试官)
// 所有 state 和 setter 由父组件持有,通过 props 传入;不引入额外状态管理库
import { type Dispatch, type SetStateAction } from "react";
import { cn, FLOW_TEMPLATES, getDifficultyConfig, INTERVIEW_SCENARIOS, getScenarioById, type InterviewScenario } from "@/shared";
import { useI18n } from "@/i18n";
import { AgentAvatar } from "@/components/AgentAvatar";
import { DifficultySelector } from "@/components/DifficultySelector";
import { InfoTip } from "@/components/InfoTip";
import { ROLE_LABELS } from "@/components/interview/MessageBubble";
import type { Agent } from "@/types/agent";
import type { SessionDifficulty, StageAgentBinding, StageAskMode } from "@/types/session";
import { Sparkles, Settings, Flag, Trash2, Plus, CheckSquare, Square, Users, User, X } from "lucide-react";

interface Provider {
  id: string;
  name?: string;
  dataFlow?: string;
  models?: { id: string; name: string }[];
}

interface SessionConfigPanelProps {
  // 标题
  title: string;
  setTitle: (v: string) => void;
  // 高级配置折叠
  showAdvanced: boolean;
  setShowAdvanced: Dispatch<SetStateAction<boolean>>;
  // 场景剧本
  showScenarioPicker: boolean;
  setShowScenarioPicker: Dispatch<SetStateAction<boolean>>;
  selectedScenarioId: string | null;
  applyScenario: (scenario: InterviewScenario) => void;
  // 难度
  difficulty: SessionDifficulty;
  setDifficulty: (d: SessionDifficulty) => void;
  // 流程
  flow: string;
  setFlow: (v: string) => void;
  isCustomFlow: boolean;
  customStages: string[];
  handleStageChange: (i: number, value: string) => void;
  handleAddStage: () => void;
  handleRemoveStage: (i: number) => void;
  // 阶段
  stages: string[];
  stageIndex: number;
  setStageIndex: Dispatch<SetStateAction<number>>;
  setStageAgentMap: Dispatch<SetStateAction<Record<number, StageAgentBinding[]>>>;
  stageNameI18n: (name: string) => string;
  // 重点方向
  focusDirection: string;
  setFocusDirection: (v: string) => void;
  // 资料
  availableMaterials: any[];
  selectedMaterialIds: string[];
  handleToggleMaterial: (matId: string) => void;
  extraMaterialText: string;
  setExtraMaterialText: Dispatch<SetStateAction<string>>;
  // 面试官
  agentMode: "single" | "multi";
  setAgentMode: Dispatch<SetStateAction<"single" | "multi">>;
  currentAgent: Agent | null;
  handleAgentChange: (id: string) => void;
  agents: Agent[];
  agentTeam: string[];
  handleToggleAgentTeam: (id: string) => void;
  stageAgentMap: Record<number, StageAgentBinding[]>;
  handleStageAgentChange: (stageIdx: number, bindingIdx: number, field: keyof StageAgentBinding, value: string) => void;
  handleAddStageAgent: (stageIdx: number) => void;
  handleRemoveStageAgent: (stageIdx: number, bindingIdx: number) => void;
  handleStageAskModeChange: (stageIdx: number, mode: StageAskMode) => void;
  getAgentById: (id: string | null) => Agent | null;
  // 模型(用于单 Agent 模式下的模型显示)
  currentProvider: Provider | undefined;
  currentModel: string;
  // 操作按钮
  // createSession 返回 Promise<Session | null>(父组件 createSession 有返回值),用 unknown 兼容
  createSession: () => Promise<unknown>;
  startInterview: () => Promise<void>;
  isStreaming: boolean;
}

export function SessionConfigPanel(props: SessionConfigPanelProps) {
  const { t } = useI18n();
  const {
    title, setTitle,
    showAdvanced, setShowAdvanced,
    showScenarioPicker, setShowScenarioPicker,
    selectedScenarioId, applyScenario,
    difficulty, setDifficulty,
    flow, setFlow, isCustomFlow, customStages,
    handleStageChange, handleAddStage, handleRemoveStage,
    stages, stageIndex, setStageIndex, setStageAgentMap, stageNameI18n,
    focusDirection, setFocusDirection,
    availableMaterials, selectedMaterialIds, handleToggleMaterial,
    extraMaterialText, setExtraMaterialText,
    agentMode, setAgentMode, currentAgent, handleAgentChange, agents,
    agentTeam, handleToggleAgentTeam,
    stageAgentMap, handleStageAgentChange, handleAddStageAgent, handleRemoveStageAgent,
    handleStageAskModeChange, getAgentById,
    currentProvider, currentModel,
    createSession, startInterview, isStreaming,
  } = props;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-ide-border bg-ide-bg-alt">
      <div className="border-b border-ide-border px-3 py-2 text-xs font-semibold uppercase text-ide-fg-muted">
        {t("interview.sessionConfig")}
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        {/* 快速剧本 */}
        <div>
          <button
            onClick={() => setShowScenarioPicker((v) => !v)}
            className="flex w-full items-center gap-1 text-xs text-ide-fg-muted hover:text-ide-fg"
          >
            <span className="text-ide-accent">{showScenarioPicker ? "▾" : "▸"}</span>
            <Sparkles size={11} className="text-ide-accent" />
            <span>{t("interview.quickScript")}</span>
            <InfoTip text={t("interview.tips.quickScript")} />
            {selectedScenarioId && (() => {
              const s = getScenarioById(selectedScenarioId);
              return s ? <span className="ml-auto truncate text-ide-accent">{s.title}</span> : null;
            })()}
          </button>
          {showScenarioPicker && (
            <div className="mt-1 max-h-60 overflow-y-auto border border-ide-border bg-ide-bg">
              {INTERVIEW_SCENARIOS.map((s, i) => {
                const diff = getDifficultyConfig(s.difficulty);
                const isSelected = s.id === selectedScenarioId;
                return (
                  <button
                    key={s.id}
                    onClick={() => applyScenario(s)}
                    title={s.description}
                    className={cn(
                      "flex w-full items-center gap-1.5 border-b border-l-2 border-l-transparent border-ide-border/40 px-2 py-1 text-left text-xs last:border-b-0 hover:bg-ide-bg-active",
                      isSelected && "border-l-ide-accent bg-ide-accent/20",
                    )}
                  >
                    <span className="w-7 shrink-0 font-mono text-[10px] text-ide-fg-muted">
                      /{String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="shrink-0" style={{ color: diff.color }}>●</span>
                    <span className={cn("flex-1 truncate", isSelected ? "text-ide-accent" : "text-ide-fg")}>
                      {s.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-ide-fg-muted">{s.duration}</span>
                  </button>
                );
              })}
            </div>
          )}
          {selectedScenarioId && (() => {
            const s = getScenarioById(selectedScenarioId);
            if (!s) return null;
            return (
              <div className="mt-1 border border-ide-border bg-ide-bg p-2 text-[11px]">
                <div className="text-ide-fg">{s.topic}</div>
                <div className="mt-0.5 text-ide-fg-muted">{s.description}</div>
                {s.typicalQuestions.length > 0 && (
                  <div className="mt-1">
                    <div className="text-[10px] text-ide-fg-muted">{t("interview.typicalQuestions")}</div>
                    <ul className="ml-3 list-disc text-[10px] text-ide-fg-muted">
                      {s.typicalQuestions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* 会话标题 */}
        <div>
          <label className="mb-1 block text-xs text-ide-fg-muted">{t("interview.sessionTitle")}</label>
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={t("interview.sessionTitlePlaceholder")}
            className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-ide-fg outline-none focus:border-ide-accent"
          />
        </div>

        {/* v10 C2:更多设置切换按钮 - 默认折叠高级配置 */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between border border-ide-border bg-ide-bg px-2 py-1.5 text-xs text-ide-fg hover:bg-ide-bg-active"
        >
          <span className="flex items-center gap-1">
            <Settings size={12} />
            <span>{showAdvanced ? t("interview.advancedConfigCollapse") : t("interview.advancedConfig")}</span>
          </span>
          <span className="text-ide-fg-muted">{showAdvanced ? "▴" : "▾"}</span>
        </button>

        {showAdvanced && (
          <>
            {/* 面试难度 */}
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                <Flag size={11} /> {t("interview.difficulty")}
                <InfoTip text={t("interview.tips.difficulty")} />
              </label>
              <DifficultySelector value={difficulty} onChange={(v) => setDifficulty(v as SessionDifficulty)} />
            </div>

            {/* 面试流程 */}
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                {t("interview.flowTemplate")}
                <InfoTip text={t("interview.tips.flowTemplate")} />
              </label>
              <select
                value={flow}
                onChange={(e) => { setFlow(e.target.value); setStageIndex(0); setStageAgentMap({}); }}
                className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg"
              >
                <option value="tech">{t("interview.flow.tech")}</option>
                <option value="behavioral">{t("interview.flow.behavioral")}</option>
                <option value="mixed">{t("interview.flow.mixed")}</option>
                <option value="custom">{t("interview.flow.custom")}</option>
              </select>

              {isCustomFlow ? (
                <div className="mt-2 space-y-1">
                  {customStages.map((stage, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="w-4 text-[10px] text-ide-fg-muted">{i + 1}.</span>
                      <input
                        value={stage} onChange={(e) => handleStageChange(i, e.target.value)}
                        className="h-6 flex-1 border border-ide-border bg-ide-bg px-1.5 text-xs text-ide-fg outline-none focus:border-ide-accent"
                      />
                      <button onClick={() => handleRemoveStage(i)} disabled={customStages.length <= 1}
                        className="text-ide-fg-muted hover:text-ide-danger disabled:opacity-30" title={t("interview.deleteStage")}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button onClick={handleAddStage} className="flex items-center gap-1 text-[11px] text-ide-accent hover:text-ide-accent-hover">
                    <Plus size={11} /> {t("interview.addStage")}
                  </button>
                </div>
              ) : (
                <div className="mt-2 border border-ide-border bg-ide-bg p-2 text-xs">
                  <ol className="list-decimal pl-4 text-ide-fg">
                    {stages.map((s, i) => (
                      <li key={s} className={cn(i === stageIndex && "text-ide-accent")}>{stageNameI18n(s)}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            {/* 面试重点方向 */}
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                {t("interview.focusDirection")}
                <InfoTip text={t("interview.tips.focusDirection")} />
              </label>
              <textarea
                value={focusDirection} onChange={(e) => setFocusDirection(e.target.value)}
                placeholder={t("interview.focusAreasPlaceholder")}
                rows={2}
                className="w-full resize-none border border-ide-border bg-ide-bg px-2 py-1 text-xs text-ide-fg outline-none focus:border-ide-accent"
              />
            </div>

            {/* 面试资料 */}
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                {t("interview.materials")}
                <InfoTip text={t("interview.tips.materials")} />
              </label>
              {availableMaterials.length === 0 ? (
                <div className="border border-ide-border bg-ide-bg p-2 text-[11px] text-ide-fg-muted">
                  {t("interview.noMaterialsHint")}
                </div>
              ) : (
                <div className="max-h-32 space-y-0.5 overflow-y-auto border border-ide-border bg-ide-bg p-1.5">
                  {availableMaterials.map((m) => {
                    const mid = m.materialId || m.id;
                    const checked = selectedMaterialIds.includes(mid);
                    return (
                      <button key={mid} onClick={() => handleToggleMaterial(mid)}
                        className="flex w-full items-center gap-1.5 px-1 py-0.5 text-left text-xs hover:bg-ide-bg-active">
                        {checked ? <CheckSquare size={12} className="shrink-0 text-ide-accent" /> : <Square size={12} className="shrink-0 text-ide-fg-muted" />}
                        <span className={cn("flex-1 truncate", checked ? "text-ide-fg" : "text-ide-fg-muted")}>{m.title || mid}</span>
                        <span className="text-[9px] text-ide-fg-muted">{m.type}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <textarea
                value={extraMaterialText} onChange={(e) => setExtraMaterialText(e.target.value)}
                placeholder={t("interview.materialPickerPlaceholder")}
                rows={2}
                className="mt-1 w-full resize-none border border-ide-border bg-ide-bg px-2 py-1 text-xs text-ide-fg outline-none focus:border-ide-accent"
              />
            </div>

            {/* 面试官 */}
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs text-ide-fg-muted">
                {t("interview.interviewer")}
                <InfoTip text={t("interview.tips.interviewerMode")} />
              </label>
              <div className="mb-2 flex border border-ide-border">
                <button onClick={() => setAgentMode("single")}
                  className={cn("flex flex-1 items-center justify-center gap-1 px-2 py-1 text-xs",
                    agentMode === "single" ? "bg-ide-accent text-ide-accent-fg" : "text-ide-fg-muted hover:bg-ide-bg-active")}>
                  <User size={11} /> {t("interview.singleInterviewer")}
                </button>
                <button onClick={() => setAgentMode("multi")}
                  className={cn("flex flex-1 items-center justify-center gap-1 px-2 py-1 text-xs",
                    agentMode === "multi" ? "bg-ide-accent text-ide-accent-fg" : "text-ide-fg-muted hover:bg-ide-bg-active")}>
                  <Users size={11} /> {t("interview.multiInterviewerTeam")}
                </button>
              </div>

              {agentMode === "single" ? (
                <>
                  <select value={currentAgent?.id || ""} onChange={(e) => handleAgentChange(e.target.value)}
                    className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-ide-fg">
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  {currentAgent?.config && (
                    <div className="mt-2 border border-ide-border bg-ide-bg p-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <AgentAvatar agent={currentAgent} size={16} />
                        <span className="text-ide-fg">{currentAgent.name}</span>
                        <span className="bg-ide-accent/20 px-1 text-[10px] text-ide-accent">{ROLE_LABELS[currentAgent.role] || currentAgent.role}</span>
                      </div>
                      <div className="mt-1 text-ide-fg-muted">{t("interview.style")} {currentAgent.config.tone} · {t("interview.difficultyLabel")} {currentAgent.config.difficulty}</div>
                      {(currentAgent.config.focusAreas || []).length > 0 && (
                        <div className="mt-0.5 text-ide-fg-muted">{t("interview.focus")} {currentAgent.config.focusAreas.join(", ")}</div>
                      )}
                      {/* 模型显示 */}
                      <div className="mt-1 text-ide-fg-muted">
                        {t("interview.model")} {currentProvider?.name || currentModel || t("interview.notConfigured")}
                        {currentAgent.preferredProviderId && currentAgent.preferredProviderId !== currentModel && (
                          <span className="text-ide-warning"> {t("interview.agentModelFallback")}</span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* 多 Agent 选择 */}
                  <div className="max-h-32 space-y-0.5 overflow-y-auto border border-ide-border bg-ide-bg p-1.5">
                    {agents.map((a) => {
                      const checked = agentTeam.includes(a.id);
                      return (
                        <button key={a.id} onClick={() => handleToggleAgentTeam(a.id)}
                          className="flex w-full items-center gap-1.5 px-1 py-0.5 text-left text-xs hover:bg-ide-bg-active">
                          {checked ? <CheckSquare size={12} className="shrink-0 text-ide-accent" /> : <Square size={12} className="shrink-0 text-ide-fg-muted" />}
                          <AgentAvatar agent={a} size={14} />
                          <span className={cn("flex-1 truncate", checked ? "text-ide-fg" : "text-ide-fg-muted")}>{a.name}</span>
                          <span className="text-[9px] text-ide-fg-muted">{ROLE_LABELS[a.role] || a.role}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-0.5 text-[10px] text-ide-fg-muted">{t("interview.selectedAgentCount", { n: agentTeam.length })}</div>

                  {/* 阶段-面试官绑定 */}
                  {agentTeam.length > 0 && (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-ide-fg-muted">
                        {t("interview.stageAgentBinding")}
                        <InfoTip text={t("interview.tips.stageAgentBinding")} />
                      </div>
                      {stages.map((stageName, sIdx) => {
                        const bindings = stageAgentMap[sIdx] || [];
                        const askMode = bindings[0]?.askMode || "sequential";
                        return (
                          <div key={sIdx} className="border border-ide-border bg-ide-bg p-1.5">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[11px] text-ide-fg">{sIdx + 1}. {stageNameI18n(stageName)}</span>
                              <select value={askMode} onChange={(e) => handleStageAskModeChange(sIdx, e.target.value as StageAskMode)}
                                className="h-5 border border-ide-border bg-ide-bg-alt px-1 text-[10px] text-ide-fg">
                                <option value="sequential">{t("interview.askMode.sequential")}</option>
                                <option value="simultaneous">{t("interview.askMode.simultaneous")}</option>
                              </select>
                            </div>
                            {bindings.map((b, bIdx) => {
                              const a = getAgentById(b.agentId);
                              const availableForStage = agentTeam.filter((id) => !bindings.some((bb, bbIdx) => bbIdx !== bIdx && bb.agentId === id));
                              return (
                                <div key={bIdx} className="mb-0.5 flex items-center gap-1">
                                  <select value={b.agentId} onChange={(e) => handleStageAgentChange(sIdx, bIdx, "agentId", e.target.value)}
                                    className="h-5 flex-1 border border-ide-border bg-ide-bg-alt px-1 text-[10px] text-ide-fg">
                                    {availableForStage.map((id) => {
                                      const ag = getAgentById(id);
                                      return <option key={id} value={id}>{ag?.name || id}</option>;
                                    })}
                                  </select>
                                  <select value={b.roleInStage || "primary"} onChange={(e) => handleStageAgentChange(sIdx, bIdx, "roleInStage", e.target.value)}
                                    className="h-5 border border-ide-border bg-ide-bg-alt px-1 text-[10px] text-ide-fg">
                                    <option value="primary">{t("interview.roleInStage.primary")}</option>
                                    <option value="assistant">{t("interview.roleInStage.assistant")}</option>
                                  </select>
                                  <button onClick={() => handleRemoveStageAgent(sIdx, bIdx)} disabled={bindings.length <= 1}
                                    className="text-ide-fg-muted hover:text-ide-danger disabled:opacity-30" title={t("interview.removeAgent")}>
                                    <X size={10} />
                                  </button>
                                </div>
                              );
                            })}
                            {bindings.length < agentTeam.length && (
                              <button onClick={() => handleAddStageAgent(sIdx)}
                                className="mt-0.5 flex items-center gap-0.5 text-[10px] text-ide-accent hover:text-ide-accent-hover">
                                <Plus size={9} /> {t("interview.addInterviewer")}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* 按钮 */}
        <div className="flex flex-col gap-2 pt-1">
          <button onClick={createSession}
            className="h-7 border border-ide-border bg-ide-bg-active px-2 text-xs text-ide-fg hover:bg-ide-bg">
            {t("interview.createSession")}
          </button>
          <button onClick={startInterview} disabled={isStreaming}
            className="h-7 bg-ide-accent px-2 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50">
            {isStreaming ? t("interview.startGenerating") : t("interview.start")}
          </button>
        </div>
      </div>
    </aside>
  );
}
