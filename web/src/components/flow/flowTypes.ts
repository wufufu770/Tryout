// flowTypes:流程编辑器共享类型
export interface FlowNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  data?: any;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface FlowEditorHandle {
  addNodeAtCenter: (type: string, label?: string, data?: any) => void;
}

// 流程校验问题
export interface ValidationIssue {
  kind: "isolated" | "cycle" | "missing-connection" | "no-output" | "missing-data";
  message: string;
  nodeIds: string[];
}

// 从流程中提取的会话配置(运行流程用)
export interface FlowSessionConfig {
  title: string;
  modelId?: string;
  difficulty: "easy" | "normal" | "hard" | "hell";
  flowTemplate: string;
  agentIds: string[];
  materialIds: string[];
  scenarioType: string;
  description?: string;
}
