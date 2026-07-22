// PropertyPanel:节点属性面板(Coze 风格右侧 Drawer)
// 从第一原理:属性面板 = 配置选中节点的业务参数,不应暴露坐标等实现细节
// 380px 从右滑入,顶部标题可编辑,中部配置表单,底部操作按钮
import { useEffect, useRef, useState } from "react";
import {
  X, SlidersHorizontal, Copy, Trash2, ChevronDown, ChevronRight,
} from "lucide-react";
import { api } from "@/api/client";
import {
  BUSINESS_NODE_TYPES,
  DIFFICULTY_LABELS,
  NODE_I18N_KEYS,
  type BusinessNodeType,
} from "./flowConfig";
import type { FlowNode } from "./flowTypes";
import { useI18n } from "@/i18n";

interface PropertyPanelProps {
  node: FlowNode;
  onClose: () => void;
  onUpdateNode: (id: string, patch: Partial<FlowNode>) => void;
  onUpdateNodeData: (id: string, key: string, value: any) => void;
  onLiveUpdateNode: (id: string, patch: Partial<FlowNode>) => void;
  onLiveUpdateNodeData: (id: string, key: string, value: any) => void;
  onCopy: () => void;
  onDelete: () => void;
}

const labelCls = "mb-1 block text-[11px] text-ide-fg-muted";
const inputCls = "h-8 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg outline-none focus:border-ide-accent";
const taCls = "w-full border border-ide-border bg-ide-bg px-2 py-1 text-xs text-ide-fg outline-none focus:border-ide-accent resize-y";
const selectCls = "h-8 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg outline-none focus:border-ide-accent";

export function PropertyPanel({
  node,
  onClose,
  onUpdateNode,
  onUpdateNodeData,
  onLiveUpdateNode,
  onLiveUpdateNodeData,
  onCopy,
  onDelete,
}: PropertyPanelProps) {
  const d = node.data || {};
  const nodeType = (node.type || "").toLowerCase() as BusinessNodeType;
  const typeDef = BUSINESS_NODE_TYPES.find((t) => t.type === nodeType);
  const panelRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  // v10.2.6(D3):Escape 关闭 Drawer(Drawer 不需要 focus trap/body overflow,只需 Escape)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // 节点 label/desc 渲染:优先 i18n,查不到 fallback 到 typeDef 原值
  const nodeLabel = (type: string, fallback: string): string => {
    const k = NODE_I18N_KEYS[type as BusinessNodeType]?.labelKey;
    if (!k) return fallback;
    const v = t(k);
    return v === k ? fallback : v;
  };
  const nodeDesc = (type: string, fallback: string): string => {
    const k = NODE_I18N_KEYS[type as BusinessNodeType]?.descKey;
    if (!k) return fallback;
    const v = t(k);
    return v === k ? fallback : v;
  };

  // 打开时聚焦面板,支持屏幕阅读器
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // API 数据
  const [interviewerAgents, setInterviewerAgents] = useState<any[]>([]);
  const [candidateAgents, setCandidateAgents] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [interviewers, candidates, provs, mats] = await Promise.all([
          api.listAgents("interviewer").catch((e) => { setLoadError(e?.message || t("propPanel.error.loadFailed")); return []; }),
          api.listAgents("candidate").catch(() => []),
          api.listProviders().catch(() => []),
          api.listMaterials().catch(() => []),
        ]);
        if (cancelled) return;
        setInterviewerAgents(interviewers);
        setCandidateAgents(candidates);
        setProviders(provs);
        setMaterials(mats);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    // Drawer:从右侧滑入,380px 宽,带过渡动画;RTL 时镜像到左侧
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("propPanel.aria.label", { name: typeDef ? nodeLabel(typeDef.type, typeDef.label) : node.type })}
      tabIndex={-1}
      className="absolute right-0 top-0 z-30 flex h-full w-full max-w-[380px] flex-col border-l border-ide-border bg-ide-bg-alt shadow-xl outline-none rtl:right-auto rtl:left-0 rtl:border-l-0 rtl:border-r"
      style={{ animation: "flow-drawer-in 200ms ease-out" }}
    >
      <style>{`
        @keyframes flow-drawer-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>

      {/* ===== 面板头部:类型图标 + 可编辑标题 + 关闭 ===== */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ide-border px-4">
        {typeDef && (
          <span
            className="flex h-7 w-7 items-center justify-center rounded"
            style={{ backgroundColor: typeDef.color + "18", color: typeDef.color }}
          >
            <typeDef.Icon size={14} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <input
            value={node.label}
            onChange={(e) => onLiveUpdateNode(node.id, { label: e.target.value })}
            onBlur={(e) => onUpdateNode(node.id, { label: e.target.value })}
            className="w-full bg-transparent text-sm font-medium text-ide-fg outline-none focus:border-ide-accent"
            placeholder={t("propPanel.placeholder.nodeName")}
          />
          <div className="text-[10px] text-ide-fg-muted">
            {typeDef ? `${nodeLabel(typeDef.type, typeDef.label)} · ${nodeDesc(typeDef.type, typeDef.desc)}` : node.type}
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg"
          title={t("propPanel.action.close")}
          aria-label={t("propPanel.aria.close")}
        >
          <X size={16} />
        </button>
      </div>

      {/* ===== 面板内容 ===== */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loadError && (
          <div className="border border-ide-warning/40 bg-ide-warning/10 px-2 py-1.5 text-[11px] text-ide-warning">
            {loadError}
          </div>
        )}

        {/* ===== 类型特定字段 ===== */}
        {/* Scenario 节点 */}
        {nodeType === "scenario" && (
          <>
            <div>
              <label className={labelCls}>{t("propPanel.scenario.interviewType")}</label>
              <select
                value={d.scenarioType || "single"}
                onChange={(e) => onUpdateNodeData(node.id, "scenarioType", e.target.value)}
                className={selectCls}
              >
                <option value="single">{t("propPanel.scenario.type.single")}</option>
                <option value="multi">{t("propPanel.scenario.type.multi")}</option>
                <option value="group">{t("propPanel.scenario.type.group")}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.scenario.sessionTitle")}</label>
              <input
                value={d.sessionTitle || ""}
                onChange={(e) => onLiveUpdateNodeData(node.id, "sessionTitle", e.target.value)}
                onBlur={(e) => onUpdateNodeData(node.id, "sessionTitle", e.target.value)}
                className={inputCls}
                placeholder={t("propPanel.scenario.sessionTitlePlaceholder")}
              />
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.scenario.description")}</label>
              <textarea
                value={d.description || ""}
                onChange={(e) => onLiveUpdateNodeData(node.id, "description", e.target.value)}
                onBlur={(e) => onUpdateNodeData(node.id, "description", e.target.value)}
                className={taCls}
                rows={3}
                placeholder={t("propPanel.scenario.descriptionPlaceholder")}
              />
            </div>
          </>
        )}

        {/* Interviewer 节点 */}
        {nodeType === "interviewer" && (
          <>
            <div>
              <label className={labelCls}>{t("propPanel.interviewer.selectAgent")}</label>
              <select
                value={d.agentId || ""}
                onChange={(e) => {
                  const agent = interviewerAgents.find((a) => a.id === e.target.value);
                  onUpdateNodeData(node.id, "agentId", e.target.value);
                  if (agent) {
                    onUpdateNode(node.id, { label: agent.name });
                    onUpdateNodeData(node.id, "role", agent.kind || "interviewer");
                  }
                }}
                className={selectCls}
                disabled={loading}
              >
                <option value="">{t("propPanel.common.selectPlaceholder")}</option>
                {interviewerAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {interviewerAgents.length === 0 && !loading && (
                <div className="mt-1 text-[10px] text-ide-fg-muted">
                  {t("propPanel.interviewer.noAgent")}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.interviewer.role")}</label>
              <select
                value={d.role || "tech"}
                onChange={(e) => onUpdateNodeData(node.id, "role", e.target.value)}
                className={selectCls}
              >
                <option value="hr">{t("propPanel.interviewer.role.hr")}</option>
                <option value="tech">{t("propPanel.interviewer.role.tech")}</option>
                <option value="ceo">{t("propPanel.interviewer.role.ceo")}</option>
                <option value="custom">{t("propPanel.interviewer.role.custom")}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.interviewer.tone")}</label>
              <select
                value={d.tone || "neutral"}
                onChange={(e) => onUpdateNodeData(node.id, "tone", e.target.value)}
                className={selectCls}
              >
                <option value="gentle">{t("propPanel.interviewer.tone.gentle")}</option>
                <option value="neutral">{t("propPanel.interviewer.tone.neutral")}</option>
                <option value="direct">{t("propPanel.interviewer.tone.direct")}</option>
                <option value="aggressive">{t("propPanel.interviewer.tone.aggressive")}</option>
                <option value="professional">{t("propPanel.interviewer.tone.professional")}</option>
              </select>
            </div>
          </>
        )}

        {/* Candidate 节点 */}
        {nodeType === "candidate" && (
          <>
            <div>
              <label className={labelCls}>{t("propPanel.candidate.count")}</label>
              <input
                type="number" min={1} max={10}
                value={d.candidateCount ?? 3}
                onChange={(e) => onLiveUpdateNodeData(node.id, "candidateCount", Number(e.target.value))}
                onBlur={(e) => {
                  const n = Math.max(1, Math.min(10, Number(e.target.value) || 3));
                  onUpdateNodeData(node.id, "candidateCount", n);
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.candidate.profile")}</label>
              <textarea
                value={d.profile || ""}
                onChange={(e) => onLiveUpdateNodeData(node.id, "profile", e.target.value)}
                onBlur={(e) => onUpdateNodeData(node.id, "profile", e.target.value)}
                className={taCls}
                rows={3}
                placeholder={t("propPanel.candidate.profilePlaceholder")}
              />
            </div>
          </>
        )}

        {/* Model 节点 */}
        {nodeType === "model" && (
          <>
            <div>
              <label className={labelCls}>{t("propPanel.model.selectProvider")}</label>
              <select
                value={d.providerId || ""}
                onChange={(e) => {
                  const prov = providers.find((p) => p.id === e.target.value);
                  onUpdateNodeData(node.id, "providerId", e.target.value);
                  if (prov) {
                    onUpdateNode(node.id, { label: prov.name });
                    onUpdateNodeData(node.id, "modelName", prov.modelName || "");
                  }
                }}
                className={selectCls}
                disabled={loading}
              >
                <option value="">{t("propPanel.common.selectPlaceholder")}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {providers.length === 0 && !loading && (
                <div className="mt-1 text-[10px] text-ide-fg-muted">
                  {t("propPanel.model.noProvider")}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.model.modelName")}</label>
              <input
                value={d.modelName || ""}
                onChange={(e) => onLiveUpdateNodeData(node.id, "modelName", e.target.value)}
                onBlur={(e) => onUpdateNodeData(node.id, "modelName", e.target.value)}
                className={inputCls}
                placeholder={t("propPanel.model.modelNamePlaceholder")}
              />
            </div>
            {/* 高级配置:可折叠 */}
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center gap-1 pt-1 text-[11px] text-ide-fg-muted hover:text-ide-fg"
            >
              {advancedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {t("propPanel.advancedConfig")}
            </button>
            {advancedOpen && (
              <div>
                <label className={labelCls}>{t("propPanel.model.temperature")}</label>
                <input
                  type="number" min={0} max={2} step={0.1}
                  value={d.temperature ?? 0.7}
                  onChange={(e) => onLiveUpdateNodeData(node.id, "temperature", Number(e.target.value))}
                  onBlur={(e) => {
                    const t = Math.max(0, Math.min(2, Number(e.target.value) || 0.7));
                    onUpdateNodeData(node.id, "temperature", t);
                  }}
                  className={inputCls}
                />
              </div>
            )}
          </>
        )}

        {/* Material 节点 */}
        {nodeType === "material" && (
          <div>
            <label className={labelCls}>{t("propPanel.material.selectMulti")}</label>
            <div className="border border-ide-border bg-ide-bg max-h-64 overflow-y-auto">
              {materials.length === 0 && !loading && (
                <div className="px-2 py-3 text-[10px] text-ide-fg-muted">
                  {t("propPanel.material.noMaterial")}
                </div>
              )}
              {materials.map((m) => {
                const selected = (d.materialIds || []).includes(m.id || m.materialId);
                const id = m.id || m.materialId;
                return (
                  <label
                    key={id}
                    className="flex items-center gap-2 px-2 py-1 hover:bg-ide-bg-active cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const current = d.materialIds || [];
                        const next = e.target.checked
                          ? [...current, id]
                          : current.filter((x: string) => x !== id);
                        onUpdateNodeData(node.id, "materialIds", next);
                      }}
                      className="accent-ide-accent"
                    />
                    <span className="text-xs text-ide-fg truncate">{m.title || id}</span>
                    <span className="ml-auto text-[10px] text-ide-fg-muted">{m.type}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Difficulty 节点 */}
        {nodeType === "difficulty" && (
          <>
            <div>
              <label className={labelCls}>
                {(() => {
                  const lvl = typeof d.level === "number" ? d.level : 5;
                  const diffKey = lvl <= 3 ? "easy" : lvl <= 6 ? "normal" : lvl <= 8 ? "hard" : "hell";
                  const label = DIFFICULTY_LABELS[diffKey] || t("propPanel.difficulty.levelFallback");
                  return t("propPanel.difficulty.levelLabel", { level: lvl, label });
                })()}
              </label>
              <input
                type="range" min={1} max={10} step={1}
                value={d.level ?? 5}
                onChange={(e) => onLiveUpdateNodeData(node.id, "level", Number(e.target.value))}
                onMouseUp={(e) => onUpdateNodeData(node.id, "level", Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => onUpdateNodeData(node.id, "level", Number((e.target as HTMLInputElement).value))}
                className="w-full accent-ide-danger"
              />
              <div className="flex justify-between text-[10px] text-ide-fg-muted">
                <span>{t("propPanel.difficulty.easy")}</span>
                <span>{t("propPanel.difficulty.hell")}</span>
              </div>
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.difficulty.duration")}</label>
              <input
                type="number" min={5} max={120} step={5}
                value={d.duration ?? 30}
                onChange={(e) => onLiveUpdateNodeData(node.id, "duration", Number(e.target.value))}
                onBlur={(e) => {
                  const n = Math.max(5, Math.min(120, Number(e.target.value) || 30));
                  onUpdateNodeData(node.id, "duration", n);
                }}
                className={inputCls}
              />
            </div>
          </>
        )}

        {/* Output 节点 */}
        {nodeType === "output" && (
          <>
            <div>
              <label className={labelCls}>{t("propPanel.output.type")}</label>
              <select
                value={d.outputType || "start_interview"}
                onChange={(e) => {
                  const outputType = e.target.value;
                  onUpdateNodeData(node.id, "outputType", outputType);
                  const labelMap: Record<string, string> = {
                    start_interview: t("propPanel.output.startInterviewLabel"),
                    generate_report: t("propPanel.output.generateReportLabel"),
                    save_template: t("propPanel.output.saveTemplateLabel"),
                  };
                  onUpdateNode(node.id, { label: labelMap[outputType] || t("propPanel.output.fallbackLabel") });
                }}
                className={selectCls}
              >
                <option value="start_interview">{t("propPanel.output.type.start_interview")}</option>
                <option value="generate_report">{t("propPanel.output.type.generate_report")}</option>
                <option value="save_template">{t("propPanel.output.type.save_template")}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.output.description")}</label>
              <textarea
                value={d.description || ""}
                onChange={(e) => onLiveUpdateNodeData(node.id, "description", e.target.value)}
                onBlur={(e) => onUpdateNodeData(node.id, "description", e.target.value)}
                className={taCls}
                rows={3}
                placeholder={t("propPanel.output.descriptionPlaceholder")}
              />
            </div>
          </>
        )}

        {/* Start 节点 */}
        {nodeType === "start" && (
          <div>
            <label className={labelCls}>{t("propPanel.start.inputParams")}</label>
            <textarea
              value={d.inputParams || ""}
              onChange={(e) => onLiveUpdateNodeData(node.id, "inputParams", e.target.value)}
              onBlur={(e) => onUpdateNodeData(node.id, "inputParams", e.target.value)}
              className={taCls}
              rows={4}
              placeholder={t("propPanel.start.inputParamsPlaceholder")}
            />
          </div>
        )}

        {/* End 节点 */}
        {nodeType === "end" && (
          <div>
            <label className={labelCls}>{t("propPanel.end.outputVars")}</label>
            <textarea
              value={d.outputTemplate || ""}
              onChange={(e) => onLiveUpdateNodeData(node.id, "outputTemplate", e.target.value)}
              onBlur={(e) => onUpdateNodeData(node.id, "outputTemplate", e.target.value)}
              className={taCls}
              rows={4}
              placeholder='{"answer": "{{llm.output}}", "score": "{{condition.result}}"}'
            />
          </div>
        )}

        {/* Condition 节点 */}
        {nodeType === "condition" && (
          <>
            <div>
              <label className={labelCls}>{t("propPanel.condition.expression")}</label>
              <input
                value={d.expression || ""}
                onChange={(e) => onLiveUpdateNodeData(node.id, "expression", e.target.value)}
                onBlur={(e) => onUpdateNodeData(node.id, "expression", e.target.value)}
                className={inputCls}
                placeholder={t("propPanel.condition.expressionPlaceholder")}
              />
            </div>
            <div className="text-[10px] text-ide-fg-muted leading-relaxed">
              {t("propPanel.condition.hintPrefix")}
              <code className="text-ide-accent">{"{{scenario.type}}"}</code>
              {t("propPanel.condition.hintSuffix")}
            </div>
          </>
        )}

        {/* Loop 节点 */}
        {nodeType === "loop" && (
          <>
            <div>
              <label className={labelCls}>{t("propPanel.loop.iterVar")}</label>
              <input
                value={d.iterVar || ""}
                onChange={(e) => onLiveUpdateNodeData(node.id, "iterVar", e.target.value)}
                onBlur={(e) => onUpdateNodeData(node.id, "iterVar", e.target.value)}
                className={inputCls}
                placeholder={t("propPanel.loop.iterVarPlaceholder")}
              />
            </div>
            <div className="text-[10px] text-ide-fg-muted leading-relaxed">
              {t("propPanel.loop.hintPrefix")}
              <code className="text-ide-accent">{"{{item}}"}</code>
              {t("propPanel.loop.hintMid")}
              <code className="text-ide-accent">{"{{index}}"}</code>
              {t("propPanel.loop.hintSuffix")}
            </div>
          </>
        )}

        {/* LLM 节点 */}
        {nodeType === "llm" && (
          <>
            <div>
              <label className={labelCls}>{t("propPanel.llm.selectProvider")}</label>
              <select
                value={d.providerId || ""}
                onChange={(e) => {
                  const prov = providers.find((p) => p.id === e.target.value);
                  onUpdateNodeData(node.id, "providerId", e.target.value);
                  if (prov) onUpdateNodeData(node.id, "modelName", prov.modelName || "");
                }}
                className={selectCls}
                disabled={loading}
              >
                <option value="">{t("propPanel.common.selectPlaceholder")}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {providers.length === 0 && !loading && (
                <div className="mt-1 text-[10px] text-ide-fg-muted">
                  {t("propPanel.llm.noProvider")}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.llm.modelName")}</label>
              <input
                value={d.modelName || ""}
                onChange={(e) => onLiveUpdateNodeData(node.id, "modelName", e.target.value)}
                onBlur={(e) => onUpdateNodeData(node.id, "modelName", e.target.value)}
                className={inputCls}
                placeholder={t("propPanel.llm.modelNamePlaceholder")}
              />
            </div>
            <div>
              <label className={labelCls}>{t("propPanel.llm.promptTemplate")}</label>
              <textarea
                value={d.promptTemplate || ""}
                onChange={(e) => onLiveUpdateNodeData(node.id, "promptTemplate", e.target.value)}
                onBlur={(e) => onUpdateNodeData(node.id, "promptTemplate", e.target.value)}
                className={taCls}
                rows={6}
                placeholder={t("propPanel.llm.promptPlaceholder")}
              />
            </div>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center gap-1 pt-1 text-[11px] text-ide-fg-muted hover:text-ide-fg"
            >
              {advancedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {t("propPanel.advancedConfig")}
            </button>
            {advancedOpen && (
              <>
                <div>
                  <label className={labelCls}>{t("propPanel.llm.temperature")}</label>
                  <input
                    type="number" min={0} max={2} step={0.1}
                    value={d.temperature ?? 0.7}
                    onChange={(e) => onLiveUpdateNodeData(node.id, "temperature", Number(e.target.value))}
                    onBlur={(e) => {
                      const t = Math.max(0, Math.min(2, Number(e.target.value) || 0.7));
                      onUpdateNodeData(node.id, "temperature", t);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t("propPanel.llm.maxTokens")}</label>
                  <input
                    type="number" min={1} max={8192}
                    value={d.maxTokens ?? 2048}
                    onChange={(e) => onLiveUpdateNodeData(node.id, "maxTokens", Number(e.target.value))}
                    onBlur={(e) => onUpdateNodeData(node.id, "maxTokens", Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* Merge 节点 */}
        {nodeType === "merge" && (
          <div>
            <label className={labelCls}>{t("propPanel.merge.fieldMap")}</label>
            <textarea
              value={d.fieldMap || ""}
              onChange={(e) => onLiveUpdateNodeData(node.id, "fieldMap", e.target.value)}
              onBlur={(e) => onUpdateNodeData(node.id, "fieldMap", e.target.value)}
              className={taCls}
              rows={5}
              placeholder='{"summary": "{{llm.output}}", "scores": "{{loop.loop_result}}"}'
            />
            <div className="mt-1 text-[10px] text-ide-fg-muted">
              {t("propPanel.merge.hint")}
            </div>
          </div>
        )}
      </div>

      {/* ===== 底部操作栏 ===== */}
      <div className="flex shrink-0 gap-2 border-t border-ide-border px-4 py-2.5">
        <button
          onClick={onCopy}
          className="flex flex-1 items-center justify-center gap-1 border border-ide-border py-1.5 text-xs text-ide-fg hover:bg-ide-bg-active"
        >
          <Copy size={12} /> {t("propPanel.action.copy")}
        </button>
        <button
          onClick={onDelete}
          className="flex flex-1 items-center justify-center gap-1 border border-ide-danger/40 py-1.5 text-xs text-ide-danger hover:bg-ide-danger/10"
        >
          <Trash2 size={12} /> {t("propPanel.action.delete")}
        </button>
      </div>
    </div>
  );
}
