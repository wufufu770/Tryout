// flowConfig:流程编辑器共享配置(4 大类 12 种节点 + 连线校验)
// 从第一原理:流程编辑器 = 可视化编排面试会话;节点 = 构建块;分类 = 降低认知负担
import {
  Play, Flag, ClipboardList, UserCheck, Users, Cpu, FileText, Gauge, PlayCircle,
  GitBranch, Repeat, Sparkles, GitMerge,
  type LucideIcon,
} from "lucide-react";

// ===== 节点分类 =====
export type NodeCategory = "io" | "business" | "logic" | "ai";

export interface NodeCategoryDef {
  category: NodeCategory;
  label: string;
  desc: string;
}

export const NODE_CATEGORIES: NodeCategoryDef[] = [
  { category: "io", label: "输入输出", desc: "流程出入口" },
  { category: "business", label: "业务编排", desc: "面试核心节点" },
  { category: "logic", label: "逻辑控制", desc: "条件 / 循环 / 聚合" },
  { category: "ai", label: "AI 计算", desc: "LLM / 提示词" },
];

// ===== 12 种节点类型 =====
export type BusinessNodeType =
  | "start" | "end"
  | "scenario" | "interviewer" | "candidate" | "model" | "material" | "difficulty" | "output"
  | "condition" | "loop"
  | "llm" | "merge";

export interface NodeTypeDef {
  type: BusinessNodeType;
  category: NodeCategory;
  label: string;
  desc: string;
  Icon: LucideIcon;
  color: string; // CSS 变量
  defaultLabel: string;
}

// 节点类型注册表:节点库 + 属性面板 + 颜色映射共用
export const BUSINESS_NODE_TYPES: NodeTypeDef[] = [
  // ===== 输入输出 =====
  {
    type: "start",
    category: "io",
    label: "开始",
    desc: "流程起点,定义入参",
    Icon: Play,
    color: "var(--ide-success)",
    defaultLabel: "开始",
  },
  {
    type: "end",
    category: "io",
    label: "结束",
    desc: "流程终点,定义出参",
    Icon: Flag,
    color: "var(--ide-danger)",
    defaultLabel: "结束",
  },
  // ===== 业务编排 =====
  {
    type: "scenario",
    category: "business",
    label: "场景",
    desc: "面试类型与会话标题",
    Icon: ClipboardList,
    color: "var(--ide-info)",
    defaultLabel: "面试场景",
  },
  {
    type: "interviewer",
    category: "business",
    label: "面试官",
    desc: "选择面试官 Agent",
    Icon: UserCheck,
    color: "var(--ide-warning)",
    defaultLabel: "面试官",
  },
  {
    type: "candidate",
    category: "business",
    label: "候选人",
    desc: "群面候选人画像",
    Icon: Users,
    color: "var(--ide-accent)",
    defaultLabel: "候选人",
  },
  {
    type: "model",
    category: "business",
    label: "模型",
    desc: "选择供应商与模型",
    Icon: Cpu,
    color: "var(--ide-info)",
    defaultLabel: "LLM 模型",
  },
  {
    type: "material",
    category: "business",
    label: "资料",
    desc: "简历 / JD / 题库",
    Icon: FileText,
    color: "var(--ide-fg-muted)",
    defaultLabel: "资料",
  },
  {
    type: "difficulty",
    category: "business",
    label: "难度",
    desc: "难度等级与时长",
    Icon: Gauge,
    color: "var(--ide-danger)",
    defaultLabel: "难度",
  },
  {
    type: "output",
    category: "business",
    label: "输出",
    desc: "启动面试 / 生成报告",
    Icon: PlayCircle,
    color: "var(--ide-success)",
    defaultLabel: "输出",
  },
  // ===== 逻辑控制 =====
  {
    type: "condition",
    category: "logic",
    label: "条件分支",
    desc: "IF/ELSE 条件路由",
    Icon: GitBranch,
    color: "var(--ide-warning)",
    defaultLabel: "条件分支",
  },
  {
    type: "loop",
    category: "logic",
    label: "循环",
    desc: "遍历数组逐条执行",
    Icon: Repeat,
    color: "var(--ide-warning)",
    defaultLabel: "循环",
  },
  // ===== AI 计算 =====
  {
    type: "llm",
    category: "ai",
    label: "LLM 节点",
    desc: "提示词编排 + 模型调用",
    Icon: Sparkles,
    color: "var(--ide-accent)",
    defaultLabel: "LLM",
  },
  {
    type: "merge",
    category: "ai",
    label: "变量聚合",
    desc: "多分支输出收拢",
    Icon: GitMerge,
    color: "var(--ide-accent)",
    defaultLabel: "变量聚合",
  },
];

export const NODE_TYPE_MAP: Record<string, NodeTypeDef> = BUSINESS_NODE_TYPES.reduce(
  (acc, def) => {
    acc[def.type] = def;
    return acc;
  },
  {} as Record<string, NodeTypeDef>,
);

export function nodeColor(type: string): string {
  return NODE_TYPE_MAP[(type || "").toLowerCase()]?.color || "var(--ide-border-active)";
}

export function nodeTypeDef(type: string): NodeTypeDef | undefined {
  return NODE_TYPE_MAP[(type || "").toLowerCase()];
}

// 按分类分组(供左侧节点库使用)
export function nodesByCategory(category: NodeCategory): NodeTypeDef[] {
  return BUSINESS_NODE_TYPES.filter((n) => n.category === category);
}

// ===== 连线校验规则 =====
// required:流程必须有此连线;optional:可选增强
export interface ConnectionRule {
  from: BusinessNodeType;
  to: BusinessNodeType;
  required: boolean;
  label: string;
}

export const CONNECTION_RULES: ConnectionRule[] = [
  { from: "scenario", to: "interviewer", required: true, label: "场景→面试官" },
  { from: "interviewer", to: "model", required: true, label: "面试官→模型" },
  { from: "model", to: "output", required: true, label: "模型→输出" },
  { from: "material", to: "interviewer", required: false, label: "资料→面试官" },
  { from: "difficulty", to: "scenario", required: false, label: "难度→场景" },
  // 逻辑/AI 节点允许自由连线(不强制)
  { from: "start", to: "scenario", required: false, label: "开始→场景" },
  { from: "output", to: "end", required: false, label: "输出→结束" },
  { from: "interviewer", to: "llm", required: false, label: "面试官→LLM" },
  { from: "llm", to: "model", required: false, label: "LLM→模型" },
  { from: "model", to: "condition", required: false, label: "模型→条件" },
  { from: "condition", to: "output", required: false, label: "条件→输出" },
  { from: "condition", to: "loop", required: false, label: "条件→循环" },
  { from: "loop", to: "merge", required: false, label: "循环→聚合" },
  { from: "merge", to: "output", required: false, label: "聚合→输出" },
];

// 校验连线是否合法:start 只允许出边、end 只允许入边;逻辑/AI 节点灵活
export function isConnectionAllowed(fromType: string, toType: string): boolean {
  const f = (fromType || "").toLowerCase();
  const t = (toType || "").toLowerCase();
  // 不允许自连
  if (f === t) return false;
  // start 只允许出边(不能作为 target),end 只允许入边(不能作为 source)
  if (t === "start") return false;
  if (f === "end") return false;
  // 规则内允许
  if (CONNECTION_RULES.some((r) => r.from === f && r.to === t)) return true;
  // 逻辑/AI 节点允许自由连入连出(不含 start/end)
  const flexible = new Set(["condition", "loop", "llm", "merge"]);
  if (flexible.has(f) || flexible.has(t)) return true;
  return false;
}

// ===== 难度映射(数字 → 会话难度枚举) =====
export function difficultyFromLevel(level: number): "easy" | "normal" | "hard" | "hell" {
  if (level <= 3) return "easy";
  if (level <= 6) return "normal";
  if (level <= 8) return "hard";
  return "hell";
}

export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "简单",
  normal: "常规",
  hard: "困难",
  hell: "地狱",
};

// ===== i18n key 映射 =====
// 节点 label/desc 与分类 label 的 i18n key 映射;组件层渲染时优先用 t(key),
// 查不到则 fallback 到原 label/desc(数据层保留中文以兼容直接消费 typeDef.label 的场景)
export const NODE_I18N_KEYS: Record<BusinessNodeType, { labelKey: string; descKey: string }> = {
  start:       { labelKey: "flow.node.start.label",       descKey: "flow.node.start.desc" },
  end:         { labelKey: "flow.node.end.label",         descKey: "flow.node.end.desc" },
  scenario:    { labelKey: "flow.node.scenario.label",    descKey: "flow.node.scenario.desc" },
  interviewer: { labelKey: "flow.node.interviewer.label", descKey: "flow.node.interviewer.desc" },
  candidate:   { labelKey: "flow.node.candidate.label",   descKey: "flow.node.candidate.desc" },
  model:       { labelKey: "flow.node.model.label",       descKey: "flow.node.model.desc" },
  material:    { labelKey: "flow.node.material.label",    descKey: "flow.node.material.desc" },
  difficulty:  { labelKey: "flow.node.difficulty.label",  descKey: "flow.node.difficulty.desc" },
  output:      { labelKey: "flow.node.output.label",      descKey: "flow.node.output.desc" },
  condition:   { labelKey: "flow.node.condition.label",   descKey: "flow.node.condition.desc" },
  loop:        { labelKey: "flow.node.loop.label",        descKey: "flow.node.loop.desc" },
  llm:         { labelKey: "flow.node.llm.label",         descKey: "flow.node.llm.desc" },
  merge:       { labelKey: "flow.node.merge.label",       descKey: "flow.node.merge.desc" },
};

export const CATEGORY_I18N_KEYS: Record<NodeCategory, { labelKey: string; descKey: string }> = {
  io:       { labelKey: "flow.category.io.label",       descKey: "flow.category.io.desc" },
  business: { labelKey: "flow.category.business.label", descKey: "flow.category.business.desc" },
  logic:    { labelKey: "flow.category.logic.label",    descKey: "flow.category.logic.desc" },
  ai:       { labelKey: "flow.category.ai.label",       descKey: "flow.category.ai.desc" },
};
