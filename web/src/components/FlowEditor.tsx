// FlowEditor:流程编辑器(重构版)
// 7 类业务节点 + 图标化工具栏 + 运行流程 + mini-map + localStorage 持久化
// 从第一原理:流程编辑器 = 可视化编排面试会话,运行流程 = 转化为真实会话
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload, Download, Trash2, Maximize2, Copy, Clipboard, Search, Pencil,
  Sparkles, Undo2, Redo2, CheckCircle2, Play, Square,
  SlidersHorizontal, Map as MapIcon, Save, Wand2, Image as ImageIcon,
} from "lucide-react";
import { autoLayout, type LayoutMode } from "./flow/autoLayout";
import {
  BUSINESS_NODE_TYPES, nodeColor, nodeTypeDef, isConnectionAllowed,
} from "./flow/flowConfig";
import { FLOW_TEMPLATES } from "./flow/flowTemplates";
import {
  validateFlow, topoSort, runFlow,
} from "./flow/flowRunner";
import type {
  FlowNode, FlowEdge, FlowEditorHandle, ValidationIssue,
} from "./flow/flowTypes";
import { PropertyPanel } from "./flow/PropertyPanel";
import { toastError } from "@/shared";
import { useI18n } from "@/i18n";

const NODE_W = 168;
const NODE_H = 64;

// 工具栏图标按钮:统一样式(图标 + tooltip,无文字,解决重叠)
interface ToolBtnProps {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
}

function ToolBtn({ onClick, disabled, title, children, active, danger }: ToolBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "flex h-7 w-7 items-center justify-center border border-transparent",
        "hover:bg-ide-bg-active hover:border-ide-border",
        "disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:border-transparent",
        active ? "bg-ide-accent/15 text-ide-accent" : danger ? "text-ide-danger hover:bg-ide-danger/10" : "text-ide-fg-muted hover:text-ide-fg",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// 解析 langflow .flow JSON
export function parseLangflow(raw: any): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const srcNodes: any[] = raw?.data?.nodes || raw?.nodes || [];
  const srcEdges: any[] = raw?.data?.edges || raw?.edges || [];
  const nodes: FlowNode[] = srcNodes.map((n: any) => {
    const data = n?.data || {};
    const pos = n?.position || data?.position || data?.node?.position || { x: 0, y: 0 };
    // type 统一小写,与 BUSINESS_NODE_TYPES / PropertyPanel 的 === 比较保持一致
    const rawType = String(n?.type ?? data?.type ?? "scenario").toLowerCase();
    return {
      id: String(n?.id ?? data?.id ?? `node-${Math.random().toString(36).slice(2, 8)}`),
      type: rawType,
      label: String(data?.display_name ?? data?.node?.display_name ?? data?.title ?? n?.id ?? "节点"),
      x: Number(pos?.x ?? 0),
      y: Number(pos?.y ?? 0),
      data,
    };
  });
  const idSet = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = srcEdges
    .map((e: any, i: number) => {
      const src = String(e?.source ?? e?.data?.source ?? "");
      const tgt = String(e?.target ?? e?.data?.target ?? "");
      if (!src || !tgt) return null;
      return {
        id: String(e?.id ?? `edge-${i}`),
        source: src,
        target: tgt,
        label: e?.data?.display_name || e?.label || undefined,
      } as FlowEdge;
    })
    .filter((e): e is FlowEdge => !!e && idSet.has(e.source) && idSet.has(e.target));
  return { nodes, edges };
}

type Snap = { nodes: FlowNode[]; edges: FlowEdge[] };

interface DragState {
  type: "node" | "pan" | "connect";
  id?: string;
  startClientX: number;
  startClientY: number;
  startNodeX?: number;
  startNodeY?: number;
  startTransX: number;
  startTransY: number;
}

interface ConnectDragState {
  sourceId: string;
  mx: number;
  my: number;
}

const STORAGE_KEY = "interviewx:flow_state";

// localStorage 持久化:保存/加载流程状态
function saveFlowState(nodes: FlowNode[], edges: FlowEdge[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges, ts: Date.now() }));
  } catch { /* 忽略配额或隐私模式异常 */ }
}

function loadFlowState(): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return { nodes: parsed.nodes, edges: parsed.edges };
    }
  } catch { /* 忽略损坏数据 */ }
  return null;
}

export const FlowEditor = forwardRef<FlowEditorHandle, {
  nodes: FlowNode[];
  edges: FlowEdge[];
  onChange?: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  readOnly?: boolean;
}>(function FlowEditor(
  { nodes, edges, onChange, readOnly },
  ref,
) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [connectDrag, setConnectDrag] = useState<ConnectDragState | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const transRef = useRef(transform);
  transRef.current = transform;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // ===== 撤销/重做 =====
  const historyRef = useRef<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] });
  const [, setHistVer] = useState(0);
  const dragStartSnapRef = useRef<Snap | null>(null);

  const pushHistory = (snap: Snap) => {
    const h = historyRef.current;
    h.past.push(snap);
    if (h.past.length > 50) h.past.shift();
    h.future = [];
    setHistVer((v) => v + 1);
  };

  const update = (n: FlowNode[], e: FlowEdge[]) => {
    pushHistory({ nodes: nodesRef.current, edges: edgesRef.current });
    onChangeRef.current?.(n, e);
    saveFlowState(n, e);
  };
  const liveUpdate = (n: FlowNode[], e: FlowEdge[]) => {
    onChangeRef.current?.(n, e);
  };

  const undo = () => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past.pop()!;
    h.future.push({ nodes: nodesRef.current, edges: edgesRef.current });
    onChangeRef.current?.(prev.nodes, prev.edges);
    saveFlowState(prev.nodes, prev.edges);
    setHistVer((v) => v + 1);
  };
  const redo = () => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future.pop()!;
    h.past.push({ nodes: nodesRef.current, edges: edgesRef.current });
    onChangeRef.current?.(next.nodes, next.edges);
    saveFlowState(next.nodes, next.edges);
    setHistVer((v) => v + 1);
  };

  // ===== 复制/粘贴 =====
  const clipboardRef = useRef<FlowNode[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdSet = (): string[] => {
    if (selectedIds.size > 0) return Array.from(selectedIds);
    return selectedId ? [selectedId] : [];
  };
  const copySelected = () => {
    const ids = selectedIdSet();
    const nodesToCopy = nodesRef.current.filter((n) => ids.includes(n.id));
    if (nodesToCopy.length === 0) return;
    clipboardRef.current = nodesToCopy.map((n) => ({ ...n }));
  };
  const paste = (offsetX = 30, offsetY = 30) => {
    if (!clipboardRef.current || clipboardRef.current.length === 0) return;
    const newNodes: FlowNode[] = clipboardRef.current.map((n) => ({
      ...n,
      id: `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      label: t("flowEditor.copySuffix", { name: n.label }),
      x: n.x + offsetX,
      y: n.y + offsetY,
    }));
    update([...nodesRef.current, ...newNodes], edgesRef.current);
    if (newNodes.length > 0) {
      setSelectedIds(new Set());
      setSelectedId(newNodes[newNodes.length - 1].id);
    }
  };

  // ===== 双击编辑 label =====
  const [editing, setEditing] = useState<{ id: string; kind: "node" | "edge"; value: string } | null>(null);
  const commitEdit = (val: string) => {
    if (!editing) return;
    const v = val.trim();
    if (editing.kind === "node") {
      update(
        nodesRef.current.map((n) => (n.id === editing.id ? { ...n, label: v || n.label } : n)),
        edgesRef.current,
      );
    } else {
      update(
        nodesRef.current,
        edgesRef.current.map((ed) => (ed.id === editing.id ? { ...ed, label: v || undefined } : ed)),
      );
    }
    setEditing(null);
  };

  // ===== 属性面板 =====
  const [propsOpen, setPropsOpen] = useState(false);
  useEffect(() => { if (readOnly) setPropsOpen(false); }, [readOnly]);

  const updateNode = (id: string, patch: Partial<FlowNode>) => {
    update(
      nodesRef.current.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      edgesRef.current,
    );
  };
  const liveUpdateNode = (id: string, patch: Partial<FlowNode>) => {
    liveUpdate(
      nodesRef.current.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      edgesRef.current,
    );
  };
  const updateNodeData = (id: string, key: string, value: any) => {
    update(
      nodesRef.current.map((n) => (n.id === id ? { ...n, data: { ...(n.data || {}), [key]: value } } : n)),
      edgesRef.current,
    );
  };
  const liveUpdateNodeData = (id: string, key: string, value: any) => {
    liveUpdate(
      nodesRef.current.map((n) => (n.id === id ? { ...n, data: { ...(n.data || {}), [key]: value } } : n)),
      edgesRef.current,
    );
  };

  // ===== 右键菜单 =====
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);
  const [addSubOpen, setAddSubOpen] = useState(false);

  // ===== 模板下拉 =====
  const [templateOpen, setTemplateOpen] = useState(false);
  const applyTemplate = (tpl: typeof FLOW_TEMPLATES[number]) => {
    if (!confirm(t("flowEditor.confirmApplyTemplate", { name: t(tpl.name) }))) return;
    const { nodes: tn, edges: te } = tpl.build();
    update(tn, te);
    setTransform({ scale: 1, x: 0, y: 0 });
    setSelectedId(null);
    setSelectedIds(new Set());
    setTemplateOpen(false);
  };

  // ===== 节点搜索 =====
  const [search, setSearch] = useState<{ open: boolean; query: string }>({ open: false, query: "" });
  const normQ = search.query.trim().toLowerCase();
  const isMatched = (id: string): boolean => {
    if (!search.open || !normQ) return false;
    const n = nodesRef.current.find((x) => x.id === id);
    return !!n && n.label.toLowerCase().includes(normQ);
  };
  const searchActive = search.open && !!normQ;

  // ===== 对齐辅助线 =====
  const [guides, setGuides] = useState<{ v?: number; h?: number }>({});

  // ===== mini-map 切换 =====
  const [miniMapOpen, setMiniMapOpen] = useState(true);

  // ===== 自动布局 =====
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("horizontal");
  // 统一管理布局相关的 setTimeout,卸载时清理
  const layoutTimerRef = useRef<number | null>(null);
  const scheduleResetZoom = () => {
    if (layoutTimerRef.current !== null) clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = window.setTimeout(() => {
      resetZoom();
      layoutTimerRef.current = null;
    }, 100);
  };
  const handleAutoLayout = () => {
    if (nodesRef.current.length === 0) return;
    if (!confirm(t("flowEditor.confirmAutoLayout"))) return;
    const newNodes = autoLayout(nodesRef.current, edgesRef.current, { mode: layoutMode });
    update(newNodes, edgesRef.current);
    scheduleResetZoom();
  };
  const toggleLayoutMode = () => {
    const next: LayoutMode = layoutMode === "horizontal" ? "vertical" : "horizontal";
    if (nodesRef.current.length > 0) {
      if (!confirm(t("flowEditor.confirmSwitchLayout", { mode: t(next === "horizontal" ? "flowEditor.layoutMode.horizontal" : "flowEditor.layoutMode.vertical") }))) return;
      const newNodes = autoLayout(nodesRef.current, edgesRef.current, { mode: next });
      update(newNodes, edgesRef.current);
    }
    setLayoutMode(next);
    if (nodesRef.current.length > 0) scheduleResetZoom();
  };

  // ===== 流程校验 =====
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [validationOpen, setValidationOpen] = useState(false);

  const runValidation = () => {
    const issues = validateFlow(nodesRef.current, edgesRef.current);
    setValidationIssues(issues);
    setValidationOpen(true);
  };

  const problematicNodeIds = new Set<string>();
  for (const iss of validationIssues) {
    for (const id of iss.nodeIds) problematicNodeIds.add(id);
  }

  // ===== 模拟运行(纯视觉高亮) =====
  const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(new Set());
  const [isSimulating, setIsSimulating] = useState(false);
  const [simComplete, setSimComplete] = useState(false);
  const simTimerRef = useRef<number | null>(null);
  const simCompleteTimerRef = useRef<number | null>(null);

  const simulateRun = () => {
    if (nodesRef.current.length === 0) return;
    // 清旧 timer,防止重复点击导致新旧高亮链并行
    if (simTimerRef.current !== null) {
      clearTimeout(simTimerRef.current);
      simTimerRef.current = null;
    }
    if (simCompleteTimerRef.current !== null) {
      clearTimeout(simCompleteTimerRef.current);
      simCompleteTimerRef.current = null;
    }
    setSimComplete(false);
    setIsSimulating(true);
    const order = topoSort(nodesRef.current, edgesRef.current);
    let i = 0;
    setRunningNodeIds(new Set([order[0]]));
    const step = () => {
      i++;
      if (i >= order.length) {
        setRunningNodeIds(new Set());
        setIsSimulating(false);
        setSimComplete(true);
        simTimerRef.current = null;
        simCompleteTimerRef.current = window.setTimeout(() => {
          setSimComplete(false);
          simCompleteTimerRef.current = null;
        }, 3000);
        return;
      }
      setRunningNodeIds(new Set([order[i]]));
      simTimerRef.current = window.setTimeout(step, 1000);
    };
    simTimerRef.current = window.setTimeout(step, 1000);
  };

  const stopSim = () => {
    if (simTimerRef.current !== null) {
      clearTimeout(simTimerRef.current);
      simTimerRef.current = null;
    }
    setIsSimulating(false);
    setRunningNodeIds(new Set());
  };

  // ===== 运行流程:校验 → 创建会话 → 跳转面试页 =====
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ success: boolean; message: string } | null>(null);
  // 管理 navigate / runResult 自动消失的 setTimeout,卸载时清理
  const navTimerRef = useRef<number | null>(null);
  const resultTimerRef = useRef<number | null>(null);
  const showRunResult = (result: { success: boolean; message: string }, autoClear = true) => {
    setRunResult(result);
    if (resultTimerRef.current !== null) clearTimeout(resultTimerRef.current);
    if (autoClear) {
      resultTimerRef.current = window.setTimeout(() => {
        setRunResult(null);
        resultTimerRef.current = null;
      }, 2500);
    }
  };

  const handleRunFlow = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const result = await runFlow(nodesRef.current, edgesRef.current);
      if (result.success) {
        // partial:部分 Agent 注册失败,仍跳转但提示用户
        if (result.partial && result.agentFailures?.length) {
          showRunResult({
            success: true,
            message: t("flowEditor.runPartialFailure", { n: result.agentFailures.length }),
          }, false);
        } else {
          showRunResult({ success: true, message: t("flowEditor.runSuccess") }, false);
        }
        if (navTimerRef.current !== null) clearTimeout(navTimerRef.current);
        navTimerRef.current = window.setTimeout(() => {
          navigate("/interview");
          navTimerRef.current = null;
        }, 1200);
      } else {
        const errMsg = result.error || t("flowEditor.runValidationError");
        showRunResult({ success: false, message: errMsg }, false);
        if (result.issues) {
          setValidationIssues(result.issues);
          setValidationOpen(true);
        }
      }
    } catch (e: any) {
      showRunResult({ success: false, message: e.message || t("flowEditor.runFailed") });
    } finally {
      setRunning(false);
    }
  };

  // ===== 导出为 PNG =====
  const svgRef = useRef<SVGSVGElement>(null);
  const exportAsImage = () => {
    const svg = svgRef.current;
    if (!svg || nodesRef.current.length === 0) return;
    const padding = 40;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodesRef.current) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    }
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("viewBox", `${minX - padding} ${minY - padding} ${width} ${height}`);
    const style = document.createElement("style");
    const computed = getComputedStyle(document.documentElement);
    const vars = ["--ide-bg", "--ide-bg-alt", "--ide-fg", "--ide-fg-muted", "--ide-accent", "--ide-border", "--ide-info", "--ide-warning", "--ide-success", "--ide-danger"];
    const cssVars = vars.map((v) => `${v}: ${computed.getPropertyValue(v).trim()};`).join("");
    const bgColor = computed.getPropertyValue("--ide-bg").trim();
    style.textContent = `:root { ${cssVars} } svg { background: ${bgColor}; }`;
    clone.insertBefore(style, clone.firstChild);
    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = document.createElement("img");
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = "interviewx-flow.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => { URL.revokeObjectURL(url); URL.revokeObjectURL(pngUrl); }, 0);
      });
    };
    img.src = url;
  };

  // ===== 手动保存到 localStorage =====
  const handleSave = () => {
    saveFlowState(nodesRef.current, edgesRef.current);
    showRunResult({ success: true, message: t("flowEditor.saveSuccess") });
  };

  useImperativeHandle(ref, () => ({
    addNodeAtCenter: (type: string, label?: string, data?: any) => {
      const el = containerRef.current;
      const trans = transRef.current;
      const rect = el?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 200;
      const cy = rect ? rect.height / 2 : 200;
      const wx = (cx - trans.x) / trans.scale - NODE_W / 2;
      const wy = (cy - trans.y) / trans.scale - NODE_H / 2;
      const id = `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const def = nodeTypeDef(type);
      const node: FlowNode = {
        id, type,
        label: label || def?.defaultLabel || type,
        x: wx, y: wy, data: data || {},
      };
      update([...nodesRef.current, node], edgesRef.current);
    },
  }));

  // ===== 全局鼠标事件(拖动/平移/连线) =====
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.type === "node" && d.id && !readOnlyRef.current) {
        const t = transRef.current;
        const dx = (e.clientX - d.startClientX) / t.scale;
        const dy = (e.clientY - d.startClientY) / t.scale;
        const newNodes = nodesRef.current.map((n) =>
          n.id === d.id ? { ...n, x: d.startNodeX! + dx, y: d.startNodeY! + dy } : n,
        );
        liveUpdate(newNodes, edgesRef.current);
        const dragged = newNodes.find((n) => n.id === d.id);
        if (dragged) {
          const cx = dragged.x + NODE_W / 2;
          const cy = dragged.y + NODE_H / 2;
          const g: { v?: number; h?: number } = {};
          for (const other of nodesRef.current) {
            if (other.id === d.id) continue;
            const ocx = other.x + NODE_W / 2;
            const ocy = other.y + NODE_H / 2;
            if (Math.abs(cx - ocx) < 5) g.v = ocx;
            if (Math.abs(cy - ocy) < 5) g.h = ocy;
          }
          setGuides(g);
        }
      } else if (d.type === "pan") {
        setTransform((t) => ({
          ...t,
          x: d.startTransX + (e.clientX - d.startClientX),
          y: d.startTransY + (e.clientY - d.startClientY),
        }));
      } else if (d.type === "connect" && d.id) {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const t = transRef.current;
        const wx = (e.clientX - rect.left - t.x) / t.scale;
        const wy = (e.clientY - rect.top - t.y) / t.scale;
        setConnectDrag({ sourceId: d.id, mx: wx, my: wy });
      }
    };
    const onUp = (e: MouseEvent) => {
      const d = dragRef.current;
      if (d && d.type === "node" && dragStartSnapRef.current) {
        const snap = dragStartSnapRef.current;
        const before = snap.nodes.find((n) => n.id === d.id);
        const after = nodesRef.current.find((n) => n.id === d.id);
        if (before && after && (before.x !== after.x || before.y !== after.y)) {
          pushHistory(snap);
          saveFlowState(nodesRef.current, edgesRef.current);
        }
        dragStartSnapRef.current = null;
      }
      setGuides({});
      if (d && d.type === "connect" && d.id) {
        const el = containerRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const trans = transRef.current;
          const wx = (e.clientX - rect.left - trans.x) / trans.scale;
          const wy = (e.clientY - rect.top - trans.y) / trans.scale;
          const target = nodesRef.current.find(
            (n) => n.id !== d.id && wx >= n.x && wx <= n.x + NODE_W && wy >= n.y && wy <= n.y + NODE_H,
          );
          if (target) {
            const sourceNode = nodesRef.current.find((n) => n.id === d.id);
            // 连线类型校验:只允许规则内的 from→to
            if (sourceNode && isConnectionAllowed(sourceNode.type, target.type)) {
              const exists = edgesRef.current.some((ed) => ed.source === d.id && ed.target === target.id);
              if (!exists) {
                const newEdge: FlowEdge = {
                  id: `${d.id}-${target.id}-${Date.now()}`,
                  source: d.id,
                  target: target.id,
                };
                update(nodesRef.current, [...edgesRef.current, newEdge]);
              }
            } else if (sourceNode) {
              // 非法连线提示
              showRunResult({
                success: false,
                message: t("flowEditor.connectionNotAllowed", { source: sourceNode.type, target: target.type }),
              });
            }
          }
        }
        setConnectDrag(null);
      }
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // 滚轮缩放
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const scale = Math.min(3, Math.max(0.2, t.scale * factor));
        const wx = (cx - t.x) / t.scale;
        const wy = (cy - t.y) / t.scale;
        return { scale, x: cx - wx * scale, y: cy - wy * scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 卸载清理:清除所有未完成的 timer,防止对已卸载组件调用 setState
  useEffect(() => {
    return () => {
      if (simTimerRef.current !== null) clearTimeout(simTimerRef.current);
      if (simCompleteTimerRef.current !== null) clearTimeout(simCompleteTimerRef.current);
      if (navTimerRef.current !== null) clearTimeout(navTimerRef.current);
      if (resultTimerRef.current !== null) clearTimeout(resultTimerRef.current);
      if (layoutTimerRef.current !== null) clearTimeout(layoutTimerRef.current);
    };
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        if (editing) setEditing(null);
        else if (contextMenu) setContextMenu(null);
        else if (search.open) setSearch({ open: false, query: "" });
        else if (templateOpen) setTemplateOpen(false);
        else if (validationOpen) setValidationOpen(false);
        else if (propsOpen) setPropsOpen(false);
        return;
      }
      if (ctrl && !inInput && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearch((s) => ({ ...s, open: true }));
        return;
      }
      if (ctrl && !inInput && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
      if (inInput) return;
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === "z" && !readOnlyRef.current) {
        e.preventDefault();
        undo();
        return;
      }
      if (ctrl && !readOnlyRef.current && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === "c" && selectedIdSet().length > 0) {
        e.preventDefault();
        copySelected();
        return;
      }
      if (ctrl && !readOnlyRef.current && e.key.toLowerCase() === "v") {
        e.preventDefault();
        paste();
        return;
      }
      if (!readOnlyRef.current && (e.key === "Delete" || e.key === "Backspace") && selectedIdSet().length > 0) {
        e.preventDefault();
        const ids = selectedIdSet();
        const idSet = new Set(ids);
        update(
          nodesRef.current.filter((n) => !idSet.has(n.id)),
          edgesRef.current.filter((ed) => !idSet.has(ed.source) && !idSet.has(ed.target)),
        );
        setSelectedId(null);
        setSelectedIds(new Set());
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedIds, editing, contextMenu, search.open, templateOpen, validationOpen, propsOpen]);

  const startNodeDrag = (e: React.MouseEvent, node: FlowNode) => {
    e.stopPropagation();
    setSelectedId(node.id);
    setSelectedIds(new Set());
    if (readOnly) return;
    dragStartSnapRef.current = {
      nodes: nodesRef.current.map((n) => ({ ...n })),
      edges: edgesRef.current.map((ed) => ({ ...ed })),
    };
    dragRef.current = {
      type: "node", id: node.id,
      startClientX: e.clientX, startClientY: e.clientY,
      startNodeX: node.x, startNodeY: node.y,
      startTransX: transform.x, startTransY: transform.y,
    };
    setDragging(true);
  };

  const startPan = (e: React.MouseEvent) => {
    setSelectedId(null);
    setSelectedIds(new Set());
    dragRef.current = {
      type: "pan",
      startClientX: e.clientX, startClientY: e.clientY,
      startTransX: transform.x, startTransY: transform.y,
    };
    setDragging(true);
  };

  const startConnect = (e: React.MouseEvent, node: FlowNode) => {
    e.stopPropagation();
    if (readOnly) return;
    const el = containerRef.current;
    const t = transRef.current;
    let wx = node.x + NODE_W;
    let wy = node.y + NODE_H / 2;
    if (el) {
      const rect = el.getBoundingClientRect();
      wx = (e.clientX - rect.left - t.x) / t.scale;
      wy = (e.clientY - rect.top - t.y) / t.scale;
    }
    dragRef.current = {
      type: "connect", id: node.id,
      startClientX: e.clientX, startClientY: e.clientY,
      startTransX: t.x, startTransY: t.y,
    };
    setConnectDrag({ sourceId: node.id, mx: wx, my: wy });
    setDragging(true);
  };

  const handleDeleteSelected = () => {
    const ids = selectedIdSet();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    update(
      nodesRef.current.filter((n) => !idSet.has(n.id)),
      edgesRef.current.filter((ed) => !idSet.has(ed.source) && !idSet.has(ed.target)),
    );
    setSelectedId(null);
    setSelectedIds(new Set());
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const { nodes: pn, edges: pe } = parseLangflow(json);
      update(pn, pe);
      setTransform({ scale: 1, x: 0, y: 0 });
      setSelectedId(null);
      setSelectedIds(new Set());
    } catch (err: any) {
      toastError(t("flowEditor.importFailed", { msg: err.message }));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = () => {
    const payload = { version: "interviewx-flow-2", nodes, edges };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flow-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleClear = () => {
    if (!confirm(t("flowEditor.confirmClearCanvas"))) return;
    update([], []);
    setSelectedId(null);
    setSelectedIds(new Set());
  };

  const resetZoom = () => setTransform({ scale: 1, x: 0, y: 0 });

  const onNodeDoubleClick = (e: React.MouseEvent, node: FlowNode) => {
    if (readOnly) return;
    e.stopPropagation();
    setEditing({ id: node.id, kind: "node", value: node.label });
  };
  const onEdgeDoubleClick = (e: React.MouseEvent, edge: FlowEdge) => {
    if (readOnly) return;
    e.stopPropagation();
    setEditing({ id: edge.id, kind: "edge", value: edge.label || "" });
  };
  const onCanvasContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setAddSubOpen(false);
    setContextMenu({ x: e.clientX, y: e.clientY });
  };
  const onNodeContextMenu = (e: React.MouseEvent, node: FlowNode) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(node.id);
    setSelectedIds(new Set());
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
  };

  const addNodeAtScreen = (type: string, sx: number, sy: number) => {
    const el = containerRef.current;
    const t = transRef.current;
    const rect = el?.getBoundingClientRect();
    const ox = rect ? rect.left : 0;
    const oy = rect ? rect.top : 0;
    const wx = (sx - ox - t.x) / t.scale - NODE_W / 2;
    const wy = (sy - oy - t.y) / t.scale - NODE_H / 2;
    const id = `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const def = nodeTypeDef(type);
    const node: FlowNode = {
      id, type,
      label: def?.defaultLabel || type,
      x: wx, y: wy,
    };
    update([...nodesRef.current, node], edgesRef.current);
    setSelectedId(id);
    setContextMenu(null);
    setAddSubOpen(false);
  };

  const selectAll = () => {
    setSelectedIds(new Set(nodesRef.current.map((n) => n.id)));
    setContextMenu(null);
  };

  const pasteAt = (sx: number, sy: number) => {
    if (!clipboardRef.current || clipboardRef.current.length === 0) {
      setContextMenu(null);
      return;
    }
    const first = clipboardRef.current[0];
    const el = containerRef.current;
    const t = transRef.current;
    const rect = el?.getBoundingClientRect();
    const ox = rect ? rect.left : 0;
    const oy = rect ? rect.top : 0;
    const targetWx = (sx - ox - t.x) / t.scale;
    const targetWy = (sy - oy - t.y) / t.scale;
    const offsetX = targetWx - NODE_W / 2 - first.x;
    const offsetY = targetWy - NODE_H / 2 - first.y;
    paste(offsetX, offsetY);
    setContextMenu(null);
  };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // ===== mini-map 视口计算 =====
  const bounds = (() => {
    if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    }
    const pad = 50;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  })();
  const mapScale = Math.min(160 / (bounds.maxX - bounds.minX), 100 / (bounds.maxY - bounds.minY));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ===== 顶部工具栏(精简为 3 组,Coze 风格) ===== */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-ide-border bg-ide-bg-alt px-2 text-xs">
        {/* 组 1:文件 */}
        <ToolBtn onClick={() => fileInputRef.current?.click()} disabled={readOnly} title={t("flowEditor.importJson")}>
          <Upload size={14} />
        </ToolBtn>
        <ToolBtn onClick={handleExport} title={t("flowEditor.exportJson")}>
          <Download size={14} />
        </ToolBtn>
        <ToolBtn onClick={exportAsImage} disabled={nodes.length === 0} title={t("flowEditor.exportPng")}>
          <ImageIcon size={14} />
        </ToolBtn>
        <ToolBtn onClick={handleSave} title={t("flowEditor.saveLocal")}>
          <Save size={14} />
        </ToolBtn>

        {/* 模板下拉(合并到文件组) */}
        <div className="relative">
          <ToolBtn onClick={() => setTemplateOpen((v) => !v)} disabled={readOnly} title={t("flowEditor.flowTemplate")} active={templateOpen}>
            <Sparkles size={14} />
          </ToolBtn>
          {templateOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setTemplateOpen(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 w-60 border border-ide-border bg-ide-bg-alt py-1 text-xs shadow-lg">
                <div className="px-3 py-1 text-ide-fg-muted">{t("flowEditor.selectTemplateHint")}</div>
                {FLOW_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.name}
                    onClick={() => applyTemplate(tpl)}
                    className="block w-full px-3 py-1.5 text-left text-ide-fg hover:bg-ide-bg-active"
                  >
                    <div className="font-medium">{t(tpl.name)}</div>
                    <div className="text-ide-fg-muted">{t(tpl.desc)}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mx-1 h-4 w-px bg-ide-border" />

        {/* 组 2:编辑 */}
        <ToolBtn onClick={undo} disabled={historyRef.current.past.length === 0 || readOnly} title={t("flowEditor.undo")}>
          <Undo2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={redo} disabled={historyRef.current.future.length === 0 || readOnly} title={t("flowEditor.redo")}>
          <Redo2 size={14} />
        </ToolBtn>
        {/* 自动布局:核心新功能,魔法棒图标 */}
        <ToolBtn onClick={handleAutoLayout} disabled={nodes.length === 0 || readOnly} title={t("flowEditor.autoLayoutTitle", { mode: t(layoutMode === "horizontal" ? "flowEditor.layoutMode.horizontal" : "flowEditor.layoutMode.vertical") })}>
          <Wand2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={toggleLayoutMode} disabled={nodes.length === 0 || readOnly} title={t("flowEditor.switchLayoutTitle", { mode: t(layoutMode === "horizontal" ? "flowEditor.layoutMode.vertical" : "flowEditor.layoutMode.horizontal") })} active={layoutMode === "vertical"}>
          <Maximize2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => setSearch((s) => ({ ...s, open: true }))} title={t("flowEditor.searchNode")}>
          <Search size={14} />
        </ToolBtn>

        <div className="mx-1 h-4 w-px bg-ide-border" />

        {/* 组 3:运行 */}
        <ToolBtn onClick={runValidation} title={t("flowEditor.validateFlow")}>
          <CheckCircle2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => setMiniMapOpen((v) => !v)} title={t("flowEditor.minimap")} active={miniMapOpen}>
          <MapIcon size={14} />
        </ToolBtn>
        {/* 模拟运行:纯视觉高亮,不创建会话;运行中切换为停止按钮 */}
        {isSimulating ? (
          <ToolBtn onClick={stopSim} title={t("flowEditor.stopSim")} danger>
            <Square size={14} />
          </ToolBtn>
        ) : (
          <ToolBtn onClick={simulateRun} disabled={nodes.length === 0 || readOnly} title={t("flowEditor.simulateRun")}>
            <Play size={14} />
          </ToolBtn>
        )}

        {/* 运行流程按钮(核心主操作:强调色突出) */}
        <button
          onClick={handleRunFlow}
          disabled={running || nodes.length === 0}
          className="ml-2 flex items-center gap-1.5 bg-ide-accent px-3 py-1 text-xs font-medium text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("flowEditor.runFlowTitle")}
        >
          <Play size={12} />
          {running ? t("flowEditor.running") : t("flowEditor.runFlowBtn")}
        </button>

        {/* 右侧状态 */}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-ide-fg-muted">
          <span>{t("flowEditor.nodeCount", { n: nodes.length })}</span>
          <span>{t("flowEditor.edgeCount", { n: edges.length })}</span>
          <span>{Math.round(transform.scale * 100)}%</span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.flow,application/json"
        className="hidden"
        onChange={handleImport}
      />

      {/* ===== 画布 ===== */}
      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-ide-bg"
        style={{
          backgroundImage:
            "linear-gradient(var(--ide-border) 1px, transparent 1px), linear-gradient(90deg, var(--ide-border) 1px, transparent 1px)",
          backgroundSize: `${24 * transform.scale}px ${24 * transform.scale}px`,
          backgroundPosition: `${transform.x}px ${transform.y}px`,
        }}
      >
        <svg
          ref={svgRef}
          className="absolute inset-0 h-full w-full"
          style={{ cursor: readOnly ? "default" : dragging ? "grabbing" : "grab" }}
        >
          <defs>
            <style>{`
              @keyframes flow-node-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
              @keyframes flow-edge-pulse { 0%, 100% { stroke-opacity: 1; } 50% { stroke-opacity: 0.4; } }
              .flow-node-running { animation: flow-node-pulse 1s ease-in-out infinite; }
              .flow-edge-running { animation: flow-edge-pulse 1s ease-in-out infinite; }
            `}</style>
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ide-fg-muted)" />
            </marker>
          </defs>
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
            {/* 空白捕获区 */}
            <rect
              x={-10000} y={-10000} width={20000} height={20000}
              fill="transparent" pointerEvents="all"
              onMouseDown={startPan}
              onContextMenu={onCanvasContextMenu}
            />

            {/* 对齐辅助线 */}
            {guides.v !== undefined && (
              <line x1={guides.v} y1={-10000} x2={guides.v} y2={10000}
                stroke="var(--ide-danger)" strokeWidth={1 / transform.scale}
                strokeDasharray="4 3" pointerEvents="none" />
            )}
            {guides.h !== undefined && (
              <line x1={-10000} y1={guides.h} x2={10000} y2={guides.h}
                stroke="var(--ide-danger)" strokeWidth={1 / transform.scale}
                strokeDasharray="4 3" pointerEvents="none" />
            )}

            {/* 连线 */}
            {edges.map((edge) => {
              const s = nodeMap.get(edge.source);
              const t = nodeMap.get(edge.target);
              if (!s || !t) return null;
              const x1 = s.x + NODE_W / 2;
              const y1 = s.y + NODE_H / 2;
              const x2 = t.x + NODE_W / 2;
              const y2 = t.y + NODE_H / 2;
              const d = Math.max(40, Math.abs(x2 - x1) / 2);
              const path = `M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`;
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              const labelW = edge.label ? edge.label.length * 6 + 8 : 0;
              const edgeRunning = runningNodeIds.has(edge.source);
              return (
                <g key={edge.id}>
                  <path d={path} fill="none" stroke="transparent" strokeWidth={12}
                    pointerEvents="stroke" style={{ cursor: readOnly ? "default" : "text" }}
                    onDoubleClick={(e) => onEdgeDoubleClick(e, edge)} />
                  <path d={path} fill="none"
                    stroke={edgeRunning ? "var(--ide-accent)" : "var(--ide-fg-muted)"}
                    strokeOpacity={edgeRunning ? 1 : 0.55}
                    strokeWidth={edgeRunning ? 3 : 1.5}
                    markerEnd="url(#flow-arrow)" pointerEvents="none"
                    className={edgeRunning ? "flow-edge-running" : undefined} />
                  {edge.label && (
                    <g>
                      <rect x={mx - labelW / 2} y={my - 8} width={labelW} height={16}
                        fill="var(--ide-bg-alt)" stroke="var(--ide-border)" strokeWidth={0.5} />
                      <text x={mx} y={my + 3} textAnchor="middle" fontSize={10} fill="var(--ide-fg-muted)">
                        {edge.label.length > 14 ? edge.label.slice(0, 14) + "…" : edge.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* 节点 */}
            {nodes.map((node) => {
              const color = nodeColor(node.type);
              const def = nodeTypeDef(node.type);
              const selected = selectedId === node.id || selectedIds.has(node.id);
              const hovered = hoveredId === node.id;
              const matched = searchActive && isMatched(node.id);
              const dimmed = searchActive && !matched;
              const problematic = problematicNodeIds.has(node.id);
              const running = runningNodeIds.has(node.id);
              const stroke = running ? "var(--ide-accent)"
                : problematic ? "var(--ide-danger)"
                : matched ? "var(--ide-warning)"
                : selected ? "var(--ide-accent)"
                : color;
              const strokeW = running || problematic || matched || selected ? 2.5 : hovered ? 1.5 : 1;
              const Icon = def?.Icon;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className={running ? "flow-node-running" : undefined}
                  onMouseDown={(e) => startNodeDrag(e, node)}
                  onDoubleClick={(e) => onNodeDoubleClick(e, node)}
                  onContextMenu={(e) => onNodeContextMenu(e, node)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId((id) => (id === node.id ? null : id))}
                  style={{ cursor: readOnly ? "default" : "move", opacity: dimmed ? 0.4 : 1 }}
                >
                  {/* 卡片背景:圆角 8px,选中/悬停时微弱发光 */}
                  <rect width={NODE_W} height={NODE_H} rx={6}
                    fill={hovered || selected ? "var(--ide-bg-active)" : "var(--ide-bg-alt)"}
                    stroke={stroke} strokeWidth={strokeW}
                    filter={selected ? "drop-shadow(0 0 4px var(--ide-accent))" : hovered ? "drop-shadow(0 1px 3px rgba(0,0,0,0.2))" : undefined} />
                  {/* 顶部色条:4px 高,圆角 */}
                  <rect width={NODE_W} height={4} rx={2} fill={color} />
                  {/* 左侧图标区:24x24 带背景色 */}
                  {Icon && (
                    <g transform="translate(8, 12)">
                      <rect width={20} height={20} rx={3}
                        fill={color} fillOpacity={0.15} />
                      <g transform="translate(4, 4)">
                        <Icon size={12} color={color} />
                      </g>
                    </g>
                  )}
                  {/* 类型标签(小字,类型色) */}
                  <text x={36} y={24} fontSize={9} fill={color} fontWeight={500} opacity={0.8}>
                    {(def?.label || node.type).toUpperCase()}
                  </text>
                  {/* 节点 label(主标题) */}
                  <text x={36} y={40} fontSize={12} fill="var(--ide-fg)" fontWeight={600}>
                    {node.label.length > 16 ? node.label.slice(0, 16) + "…" : node.label}
                  </text>
                  {/* 关键配置摘要(第二行,灰色小字) */}
                  {node.data && (() => {
                    let summary = "";
                    const nt = (node.type || "").toLowerCase();
                    if (nt === "interviewer" && node.data.agentId) summary = t("flowEditor.summary.agentSelected");
                    else if (nt === "model" && node.data.providerId) summary = node.data.modelName || t("flowEditor.summary.providerSelected");
                    else if (nt === "scenario" && node.data.scenarioType) {
                      const m: Record<string, string> = {
                        single: t("flowEditor.scenarioType.single"),
                        multi: t("flowEditor.scenarioType.multi"),
                        group: t("flowEditor.scenarioType.group"),
                      };
                      summary = m[node.data.scenarioType] || "";
                    }
                    else if (nt === "difficulty" && node.data.level) summary = `Lv.${node.data.level}`;
                    else if (nt === "material" && node.data.materialIds?.length) summary = t("flowEditor.summary.materialCount", { n: node.data.materialIds.length });
                    else if (nt === "output" && node.data.outputType) {
                      const m: Record<string, string> = {
                        start_interview: t("flowEditor.outputType.startInterview"),
                        generate_report: t("flowEditor.outputType.generateReport"),
                        save_template: t("flowEditor.outputType.saveTemplate"),
                      };
                      summary = m[node.data.outputType] || "";
                    }
                    else if (nt === "llm" && node.data.promptTemplate) summary = t("flowEditor.summary.promptConfigured");
                    else if (nt === "condition" && node.data.expression) summary = t("flowEditor.summary.conditionSet");
                    else if (nt === "loop" && node.data.iterVar) summary = t("flowEditor.summary.loopConfigured");
                    if (!summary) return null;
                    return (
                      <text x={36} y={54} fontSize={9} fill="var(--ide-fg-muted)">
                        {summary}
                      </text>
                    );
                  })()}
                  {/* 连接锚点:右侧,悬停时放大 */}
                  {!readOnly && (
                    <circle cx={NODE_W} cy={NODE_H / 2} r={hovered ? 5 : 4}
                      fill="var(--ide-bg-alt)" stroke="var(--ide-accent)" strokeWidth={1.5}
                      style={{ cursor: "crosshair", transition: "r 0.15s" }}
                      onMouseDown={(e) => startConnect(e, node)} />
                  )}
                  {/* 校验失败标记:右上角红点 */}
                  {problematic && (
                    <circle cx={NODE_W - 8} cy={8} r={3} fill="var(--ide-danger)" />
                  )}
                </g>
              );
            })}

            {/* 临时连线 */}
            {connectDrag && (() => {
              const s = nodeMap.get(connectDrag.sourceId);
              if (!s) return null;
              const x1 = s.x + NODE_W;
              const y1 = s.y + NODE_H / 2;
              const x2 = connectDrag.mx;
              const y2 = connectDrag.my;
              const d = Math.max(40, Math.abs(x2 - x1) / 2);
              const path = `M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`;
              return <path d={path} fill="none" stroke="var(--ide-accent)" strokeWidth={1.5}
                strokeDasharray="4 3" pointerEvents="none" />;
            })()}
          </g>
        </svg>

        {/* ===== 空状态引导 ===== */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-ide-fg-muted text-sm mb-2">{t("flowEditor.canvasEmpty")}</div>
              <div className="text-ide-fg-muted text-xs">
                {t("flowEditor.emptyHintPrefix")}
                <Sparkles size={11} className="inline mx-1" />
                {t("flowEditor.emptyHintSuffix")}
              </div>
            </div>
          </div>
        )}

        {/* ===== mini-map(右下角,极简风格,可拖动视口) ===== */}
        {miniMapOpen && nodes.length > 0 && (
          <div className="absolute bottom-3 right-3 z-20 overflow-hidden border border-ide-border bg-ide-bg/80 backdrop-blur-sm rounded">
            <svg
              width={160} height={100} className="block"
              style={{ cursor: "move" }}
              onMouseDown={(e) => {
                if (!containerRef.current) return;
                e.preventDefault();
                e.stopPropagation();
                const svg = e.currentTarget;
                const svgRect = svg.getBoundingClientRect();
                const startMx = e.clientX - svgRect.left;
                const startMy = e.clientY - svgRect.top;
                const startTx = transform.x;
                const startTy = transform.y;
                const scale = transform.scale;
                const onMove = (ev: MouseEvent) => {
                  const mx = ev.clientX - svgRect.left;
                  const my = ev.clientY - svgRect.top;
                  // mini-map 位移 → 画布位移(反向,mini-map 是缩略图)
                  const dx = (mx - startMx) / mapScale * scale;
                  const dy = (my - startMy) / mapScale * scale;
                  setTransform((t) => ({ ...t, x: startTx - dx, y: startTy - dy }));
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
            >
              {/* 节点缩略:用 2x2 小圆点表示,按类型着色 */}
              {nodes.map((n) => {
                const x = (n.x - bounds.minX) * mapScale + (NODE_W * mapScale) / 2;
                const y = (n.y - bounds.minY) * mapScale + (NODE_H * mapScale) / 2;
                const isSelected = selectedId === n.id || selectedIds.has(n.id);
                return (
                  <circle key={n.id} cx={x} cy={y} r={isSelected ? 2.5 : 1.8}
                    fill={nodeColor(n.type)} fillOpacity={isSelected ? 1 : 0.7} />
                );
              })}
              {/* 视口框:1px 虚线 + 半透明强调色填充 */}
              {containerRef.current && (() => {
                const rect = containerRef.current.getBoundingClientRect();
                const vx = (-transform.x / transform.scale - bounds.minX) * mapScale;
                const vy = (-transform.y / transform.scale - bounds.minY) * mapScale;
                const vw = (rect.width / transform.scale) * mapScale;
                const vh = (rect.height / transform.scale) * mapScale;
                return (
                  <rect x={vx} y={vy} width={vw} height={vh}
                    fill="var(--ide-accent)" fillOpacity={0.08}
                    stroke="var(--ide-accent)" strokeWidth={1} strokeDasharray="2 2" strokeOpacity={0.7} />
                );
              })()}
            </svg>
          </div>
        )}

        {/* ===== 右键菜单 ===== */}
        {contextMenu && (
          <>
            <div className="fixed inset-0 z-40"
              onClick={() => setContextMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
            <div className="fixed z-50 min-w-[168px] border border-ide-border bg-ide-bg-alt py-1 text-xs shadow-lg"
              style={{ left: contextMenu.x, top: contextMenu.y }}>
              {contextMenu.nodeId ? (
                <>
                  <button onClick={() => {
                    setSelectedId(contextMenu.nodeId!);
                    setSelectedIds(new Set());
                    setPropsOpen(true);
                    setContextMenu(null);
                  }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-fg hover:bg-ide-bg-active">
                    <SlidersHorizontal size={12} /> {t("flowEditor.ctxEditProps")}
                  </button>
                  <button onClick={() => {
                    const n = nodesRef.current.find((x) => x.id === contextMenu.nodeId!);
                    if (n) setEditing({ id: n.id, kind: "node", value: n.label });
                    setContextMenu(null);
                  }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-fg hover:bg-ide-bg-active">
                    <Pencil size={12} /> {t("flowEditor.ctxEditLabel")}
                  </button>
                  <button onClick={() => {
                    setSelectedId(contextMenu.nodeId!);
                    setSelectedIds(new Set());
                    copySelected();
                    setContextMenu(null);
                  }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-fg hover:bg-ide-bg-active">
                    <Copy size={12} /> {t("flowEditor.ctxCopy")}
                  </button>
                  <button onClick={() => {
                    const id = contextMenu.nodeId!;
                    update(
                      nodesRef.current.filter((n) => n.id !== id),
                      edgesRef.current.filter((ed) => ed.source !== id && ed.target !== id),
                    );
                    setSelectedId(null);
                    setContextMenu(null);
                  }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-danger hover:bg-ide-danger/10">
                    <Trash2 size={12} /> {t("flowEditor.ctxDelete")}
                  </button>
                </>
              ) : (
                <>
                  <div className="relative">
                    <button onClick={() => setAddSubOpen((v) => !v)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-fg hover:bg-ide-bg-active">
                      {t("flowEditor.ctxAddNode")}
                    </button>
                    {addSubOpen && (
                      <div className="absolute left-full top-0 ml-0.5 min-w-[128px] border border-ide-border bg-ide-bg-alt py-1 shadow-lg">
                        {BUSINESS_NODE_TYPES.map((nt) => (
                          <button key={nt.type}
                            onClick={() => addNodeAtScreen(nt.type, contextMenu.x, contextMenu.y)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-fg hover:bg-ide-bg-active">
                            <nt.Icon size={12} style={{ color: nt.color }} /> {nt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => pasteAt(contextMenu.x, contextMenu.y)}
                    disabled={!clipboardRef.current || clipboardRef.current.length === 0}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-fg hover:bg-ide-bg-active disabled:opacity-40">
                    <Clipboard size={12} /> {t("flowEditor.ctxPaste")}
                  </button>
                  <button onClick={selectAll}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-fg hover:bg-ide-bg-active">
                    {t("flowEditor.ctxSelectAll")}
                  </button>
                  <button onClick={() => { resetZoom(); setContextMenu(null); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ide-fg hover:bg-ide-bg-active">
                    <Maximize2 size={12} /> {t("flowEditor.ctxResetView")}
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* ===== 搜索框(右上角,不与工具栏重叠) ===== */}
        {search.open && (
          <div className="absolute right-3 top-12 z-50 flex items-center gap-1.5 border border-ide-border bg-ide-bg-alt px-2 py-1 text-xs shadow-lg">
            <Search size={12} className="text-ide-fg-muted" />
            <input autoFocus value={search.query}
              onChange={(e) => setSearch((s) => ({ ...s, query: e.target.value }))}
              placeholder={t("flowEditor.searchPlaceholder")}
              className="w-48 bg-transparent text-ide-fg outline-none placeholder:text-ide-fg-muted" />
            {normQ && (
              <span className="text-ide-fg-muted">
                {nodes.filter((n) => n.label.toLowerCase().includes(normQ)).length}/{nodes.length}
              </span>
            )}
            <button onClick={() => setSearch({ open: false, query: "" })}
              className="text-ide-fg-muted hover:text-ide-fg" title={t("flowEditor.closeEsc")}>
              ✕
            </button>
          </div>
        )}

        {/* ===== 校验结果面板(右上角) ===== */}
        {validationOpen && (
          <div className="absolute right-3 top-12 z-50 w-80 border border-ide-border bg-ide-bg-alt py-2 text-xs shadow-lg">
            <div className="flex items-center justify-between px-3 pb-1.5">
              <div className="font-medium text-ide-fg">{t("flowEditor.validationTitle")}</div>
              <button onClick={() => setValidationOpen(false)}
                className="text-ide-fg-muted hover:text-ide-fg" title={t("flowEditor.closeEsc")}>
                ✕
              </button>
            </div>
            <div className="border-t border-ide-border" />
            {validationIssues.length === 0 ? (
              <div className="px-3 py-2 text-ide-success">{t("flowEditor.validationPassed")}</div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {validationIssues.map((iss, i) => (
                  <div key={i} className="border-b border-ide-border px-3 py-1.5 last:border-b-0">
                    <div className="text-ide-danger">{iss.message}</div>
                    {iss.nodeIds.length > 0 && (
                      <div className="mt-0.5 text-ide-fg-muted">
                        {t("flowEditor.involvedNodes")}{iss.nodeIds.map((id) => {
                          const n = nodes.find((x) => x.id === id);
                          return n ? n.label : id;
                        }).join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== 模拟运行状态(左下角) ===== */}
        {(isSimulating || simComplete) && (
          <div className="absolute bottom-3 left-3 z-50 border border-ide-border bg-ide-bg-alt px-3 py-1.5 text-xs shadow-lg">
            {isSimulating ? (
              <span className="text-ide-accent">{t("flowEditor.simRunning")}</span>
            ) : (
              <span className="text-ide-success">{t("flowEditor.simComplete")}</span>
            )}
          </div>
        )}

        {/* ===== 运行流程结果提示(底部居中) ===== */}
        {runResult && (
          <div className={[
            "absolute bottom-3 left-1/2 -translate-x-1/2 z-50 border px-4 py-2 text-xs shadow-lg",
            runResult.success
              ? "border-ide-success/50 bg-ide-success/10 text-ide-success"
              : "border-ide-danger/50 bg-ide-danger/10 text-ide-danger",
          ].join(" ")}>
            {runResult.success ? "✓ " : "✗ "}{runResult.message}
          </div>
        )}

        {/* ===== inline 编辑 input ===== */}
        {editing && (() => {
          const el = containerRef.current;
          const rect = el?.getBoundingClientRect();
          const t = transform;
          const ox = rect ? rect.left : 0;
          const oy = rect ? rect.top : 0;
          let wx = 0, wy = 0;
          if (editing.kind === "node") {
            const n = nodesRef.current.find((x) => x.id === editing.id);
            if (!n) return null;
            wx = n.x + NODE_W / 2;
            wy = n.y;
          } else {
            const ed = edgesRef.current.find((x) => x.id === editing.id);
            if (!ed) return null;
            const s = nodeMap.get(ed.source);
            const tg = nodeMap.get(ed.target);
            if (!s || !tg) return null;
            wx = (s.x + tg.x) / 2 + NODE_W / 2;
            wy = (s.y + tg.y) / 2 + NODE_H / 2;
          }
          const sx = ox + t.x + wx * t.scale;
          const sy = oy + t.y + wy * t.scale;
          const top = editing.kind === "node" ? sy - 30 : sy - 14;
          return (
            <div className="fixed z-50" style={{ left: sx, top, transform: "translateX(-50%)" }}>
              <input
                key={`${editing.kind}-${editing.id}`}
                autoFocus defaultValue={editing.value}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit((e.target as HTMLInputElement).value);
                  }
                }}
                onBlur={(e) => commitEdit(e.target.value)}
                className="w-44 border border-ide-accent bg-ide-bg-alt px-2 py-1 text-xs text-ide-fg outline-none shadow-lg" />
            </div>
          );
        })()}

        {/* ===== 属性面板(右侧滑出) ===== */}
        {propsOpen && selectedId && !readOnly && (() => {
          const node = nodes.find((n) => n.id === selectedId);
          if (!node) return null;
          return (
            <PropertyPanel
              node={node}
              onClose={() => setPropsOpen(false)}
              onUpdateNode={updateNode}
              onUpdateNodeData={updateNodeData}
              onLiveUpdateNode={liveUpdateNode}
              onLiveUpdateNodeData={liveUpdateNodeData}
              onCopy={() => {
                setSelectedId(node.id);
                copySelected();
              }}
              onDelete={() => {
                update(
                  nodesRef.current.filter((n) => n.id !== node.id),
                  edgesRef.current.filter((ed) => ed.source !== node.id && ed.target !== node.id),
                );
                setSelectedId(null);
                setPropsOpen(false);
              }}
            />
          );
        })()}
      </div>
    </div>
  );
});

export type { FlowNode, FlowEdge, FlowEditorHandle } from "./flow/flowTypes";

// 导出 loadFlowState 供 FlowPage 初始化使用
export { loadFlowState, saveFlowState };
