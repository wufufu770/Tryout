// FlowPage:流程编辑器页面
// 左侧节点库(4 大类 12 种节点,分类折叠)+ 主区 FlowEditor
// 从第一原理:节点库 = 按业务语义分组的构建块目录,降低用户认知负担
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { InfoTip } from "@/components/InfoTip";
import { FlowEditor, loadFlowState } from "@/components/FlowEditor";
import {
  NODE_CATEGORIES,
  nodesByCategory,
  NODE_I18N_KEYS,
  CATEGORY_I18N_KEYS,
  type BusinessNodeType,
  type NodeCategory,
} from "@/components/flow/flowConfig";
import { FLOW_TEMPLATES } from "@/components/flow/flowTemplates";
import type { FlowEditorHandle, FlowNode, FlowEdge } from "@/components/flow/flowTypes";
import { useI18n } from "@/i18n";

// 初始化:优先从 localStorage 恢复,否则使用技术面试模板
function initFlow(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const saved = loadFlowState();
  if (saved && saved.nodes.length > 0) return saved;
  return FLOW_TEMPLATES[0].build();
}

export function FlowPage() {
  // 惰性初始化:仅在首次渲染时调用 initFlow(),避免每次渲染都读 localStorage
  const [initial] = useState(initFlow);
  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(initial.edges);
  const [panelOpen, setPanelOpen] = useState(true);
  // 分类折叠状态:默认业务编排展开,其他收起
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set(["io", "logic", "ai"]));
  const editorRef = useRef<FlowEditorHandle>(null);
  const { t } = useI18n();

  // 节点/分类 label/desc 渲染:优先 i18n,查不到 fallback 到 typeDef 原值
  const catLabel = (cat: NodeCategory, fallback: string): string => {
    const k = CATEGORY_I18N_KEYS[cat]?.labelKey;
    if (!k) return fallback;
    const v = t(k);
    return v === k ? fallback : v;
  };
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

  const handleChange = (n: FlowNode[], e: FlowEdge[]) => {
    setNodes(n);
    setEdges(e);
  };

  const addNode = (type: string, label: string) => {
    editorRef.current?.addNodeAtCenter(type, label, {});
  };

  const toggleCat = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 标题栏 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ide-border bg-ide-bg-alt px-3 text-xs">
        <span className="font-semibold text-ide-fg">{t("flow.editorTitle")}</span>
        <InfoTip text={t("flow.editorTip")} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左侧节点库(可折叠,分类展示) */}
        {panelOpen ? (
          <aside className="flex w-60 shrink-0 flex-col border-r border-ide-border bg-ide-bg-alt">
            <div className="flex h-8 items-center justify-between border-b border-ide-border px-3 text-xs font-semibold uppercase text-ide-fg-muted">
              <span>{t("flow.nodeLibrary")}</span>
              <button
                onClick={() => setPanelOpen(false)}
                title={t("flow.collapseNodeLibrary")}
                aria-label={t("flow.collapseNodeLibrary")}
                className="flex h-5 w-5 items-center justify-center hover:bg-ide-bg-active hover:text-ide-fg"
              >
                <ChevronLeft size={14} />
              </button>
            </div>

            {/* 分类列表(可滚动) */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {NODE_CATEGORIES.map((cat) => {
                const catNodes = nodesByCategory(cat.category);
                if (catNodes.length === 0) return null;
                const collapsed = collapsedCats.has(cat.category);
                return (
                  <div key={cat.category} className="border-b border-ide-border/50">
                    {/* 分类标题(可折叠) */}
                    <button
                      onClick={() => toggleCat(cat.category)}
                      className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-semibold uppercase text-ide-fg-muted hover:bg-ide-bg-active"
                    >
                      {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                      <span>{catLabel(cat.category, cat.label)}</span>
                      <span className="ml-auto text-[10px] font-normal text-ide-fg-muted/60">{catNodes.length}</span>
                    </button>
                    {/* 分类下的节点 */}
                    {!collapsed && (
                      <div className="flex flex-col gap-px px-1.5 pb-1.5">
                        {catNodes.map(({ type, label, desc, Icon, color }) => {
                          const titleLabel = nodeLabel(type, label);
                          const titleDesc = nodeDesc(type, desc);
                          return (
                            <button
                              key={type}
                              onClick={() => addNode(type, titleLabel)}
                              className="group flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg"
                              title={t("flow.addNodeTip", { label: titleLabel, desc: titleDesc })}
                            >
                              <span
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
                                style={{ backgroundColor: color + "18", color }}
                              >
                                <Icon size={13} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-ide-fg">{titleLabel}</div>
                                <div className="truncate text-[10px] text-ide-fg-muted">{titleDesc}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 底部提示 */}
            <div className="shrink-0 border-t border-ide-border px-3 py-2 text-[10px] leading-relaxed text-ide-fg-muted">
              {t("flow.bottomHint")}
            </div>
          </aside>
        ) : (
          <button
            onClick={() => setPanelOpen(true)}
            title={t("flow.expandNodeLibrary")}
            aria-label={t("flow.expandNodeLibrary")}
            className="flex w-6 shrink-0 flex-col items-center justify-center border-r border-ide-border bg-ide-bg-alt text-ide-fg-muted hover:text-ide-fg"
          >
            <ChevronRight size={14} />
          </button>
        )}

        {/* 编辑器 */}
        <FlowEditor ref={editorRef} nodes={nodes} edges={edges} onChange={handleChange} />
      </div>
    </div>
  );
}
