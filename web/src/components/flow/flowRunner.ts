// flowRunner:流程校验 + 从流程提取会话配置 + 创建会话
import { api } from "@/api/client";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session } from "@/api/types";
import {
  CONNECTION_RULES,
  difficultyFromLevel,
} from "./flowConfig";
import type { FlowNode, FlowEdge, ValidationIssue, FlowSessionConfig } from "./flowTypes";

// 环检测:DFS 三色标记法
export function detectCycle(nodes: FlowNode[], edges: FlowEdge[]): { hasCycle: boolean; cycleNodes: string[] } {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
  }
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, 0);
  const cycleNodes = new Set<string>();
  let hasCycle = false;

  const dfs = (u: string, path: string[]): boolean => {
    color.set(u, 1);
    path.push(u);
    for (const v of adj.get(u) || []) {
      if (!color.has(v)) continue;
      const c = color.get(v)!;
      if (c === 1) {
        hasCycle = true;
        const idx = path.indexOf(v);
        for (let i = idx; i < path.length; i++) cycleNodes.add(path[i]);
        cycleNodes.add(v);
        return true;
      } else if (c === 0) {
        if (dfs(v, path)) return true;
      }
    }
    path.pop();
    color.set(u, 2);
    return false;
  };

  for (const n of nodes) {
    if (color.get(n.id) === 0) dfs(n.id, []);
  }
  return { hasCycle, cycleNodes: Array.from(cycleNodes) };
}

// 拓扑排序:Kahn 算法
export function topoSort(nodes: FlowNode[], edges: FlowEdge[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
    if (inDegree.has(e.target)) inDegree.set(e.target, inDegree.get(e.target)! + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }
  const result: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    result.push(u);
    for (const v of adj.get(u) || []) {
      inDegree.set(v, inDegree.get(v)! - 1);
      if (inDegree.get(v) === 0) queue.push(v);
    }
  }
  if (result.length < nodes.length) {
    const inResult = new Set(result);
    for (const n of nodes) {
      if (!inResult.has(n.id)) result.push(n.id);
    }
  }
  return result;
}

// 流程校验:孤立节点 / 环 / 缺失必需连线 / 无输出节点
export function validateFlow(nodes: FlowNode[], edges: FlowEdge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. 孤立节点
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    if (degree.has(e.source)) degree.set(e.source, degree.get(e.source)! + 1);
    if (degree.has(e.target)) degree.set(e.target, degree.get(e.target)! + 1);
  }
  const isolated = nodes.filter((n) => degree.get(n.id) === 0);
  if (isolated.length > 0) {
    issues.push({
      kind: "isolated",
      message: `存在 ${isolated.length} 个孤立节点(无连线)`,
      nodeIds: isolated.map((n) => n.id),
    });
  }

  // 2. 环检测
  const { hasCycle, cycleNodes } = detectCycle(nodes, edges);
  if (hasCycle) {
    issues.push({
      kind: "cycle",
      message: `检测到环(共 ${cycleNodes.length} 个节点参与)`,
      nodeIds: cycleNodes,
    });
  }

  // 3. 必需连线缺失校验
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const rule of CONNECTION_RULES) {
    if (!rule.required) continue;
    const hasConnection = edges.some((e) => {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      return s?.type === rule.from && t?.type === rule.to;
    });
    if (!hasConnection) {
      issues.push({
        kind: "missing-connection",
        message: `缺少必需连线:${rule.label}`,
        nodeIds: [],
      });
    }
  }

  // 4. 无 output 节点
  const hasOutput = nodes.some((n) => n.type === "output");
  if (!hasOutput) {
    issues.push({
      kind: "no-output",
      message: "流程缺少输出节点(无法启动面试)",
      nodeIds: [],
    });
  }

  // 5. 关键节点 data 必填校验(防止创建空会话)
  // interviewer 节点必须选了 agentId;model 节点必须选了 providerId
  for (const n of nodes) {
    if (n.type === "interviewer" && !n.data?.agentId) {
      issues.push({
        kind: "missing-data",
        message: `面试官节点「${n.label}」未选择 Agent`,
        nodeIds: [n.id],
      });
    }
    if (n.type === "model" && !n.data?.providerId) {
      issues.push({
        kind: "missing-data",
        message: `模型节点「${n.label}」未选择供应商`,
        nodeIds: [n.id],
      });
    }
  }

  return issues;
}

// 从流程图中提取会话配置
export function extractSessionConfig(nodes: FlowNode[], edges: FlowEdge[]): FlowSessionConfig | null {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 找场景节点
  const scenario = nodes.find((n) => n.type === "scenario");
  if (!scenario) return null;

  // 找面试官节点(通过 scenario→interviewer 连线)
  const interviewerIds = edges
    .filter((e) => {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      return s?.type === "scenario" && t?.type === "interviewer";
    })
    .map((e) => e.target);
  const interviewers = interviewerIds
    .map((id) => nodeMap.get(id))
    .filter((n): n is FlowNode => !!n);

  // 提取 agentIds(从面试官节点的 data.agentId)
  const agentIds = interviewers
    .map((n) => n.data?.agentId)
    .filter((id): id is string => !!id);

  // 找模型节点(通过 interviewer→model 连线)
  const modelNodeId = edges.find((e) => {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    return s?.type === "interviewer" && t?.type === "model";
  })?.target;
  const modelNode = modelNodeId ? nodeMap.get(modelNodeId) : undefined;
  // 注:此处 modelId 实际承载的是 providerId(模型节点选择的供应商 ID),
  // 后端 createSession 接受 modelId 字段并据此激活对应供应商。
  const modelId = modelNode?.data?.providerId;

  // 找资料节点:从 material 节点的 data.materialIds 取实际资料 ID
  // (material 节点的 data.materialIds 是用户在属性面板多选的结果)
  const materialNodes = nodes.filter((n) => n.type === "material");
  const materialIdsFromData = materialNodes
    .flatMap((n) => n.data?.materialIds || [])
    .filter((id): id is string => !!id);

  // 找难度节点(通过 difficulty→scenario 连线)
  const difficultyNodeId = edges.find((e) => {
    const s = nodeMap.get(e.source);
    const t = nodeMap.get(e.target);
    return s?.type === "difficulty" && t?.type === "scenario";
  })?.source;
  const difficultyNode = difficultyNodeId ? nodeMap.get(difficultyNodeId) : undefined;
  const level = difficultyNode?.data?.level ?? 5;
  const difficulty = difficultyFromLevel(level);

  return {
    title: scenario.data?.sessionTitle || scenario.label || "流程面试",
    modelId,
    difficulty,
    flowTemplate: "custom",
    agentIds,
    materialIds: materialIdsFromData,
    scenarioType: scenario.data?.scenarioType || "single",
    description: scenario.data?.description,
  };
}

// 运行流程:校验 → 创建会话 → 注册 Agent → 设置全局 store → 返回 sessionId
export async function runFlow(nodes: FlowNode[], edges: FlowEdge[]): Promise<{
  success: boolean;
  sessionId?: string;
  error?: string;
  issues?: ValidationIssue[];
  partial?: boolean;
  agentFailures?: string[];
}> {
  // 1. 校验(missing-data 也作为 blocking,防止创建无 Agent 的空会话)
  const issues = validateFlow(nodes, edges);
  const blockingIssues = issues.filter(
    (i) => i.kind === "missing-connection" || i.kind === "no-output" || i.kind === "cycle" || i.kind === "missing-data",
  );
  if (blockingIssues.length > 0) {
    return { success: false, issues, error: blockingIssues[0].message };
  }

  // 2. 提取配置
  const config = extractSessionConfig(nodes, edges);
  if (!config) {
    return { success: false, error: "未找到场景节点" };
  }

  // 3. 创建会话
  let sess: Session;
  try {
    sess = await api.createSession({
      title: config.title,
      modelId: config.modelId || "",
      flowTemplate: config.flowTemplate,
      difficulty: config.difficulty,
    });
  } catch (e: any) {
    return { success: false, error: e.message || "创建会话失败" };
  }

  // 4. 注册 Agent:记录失败列表,全部失败则视为整体失败
  const agentFailures: string[] = [];
  for (const agentId of config.agentIds) {
    try {
      await api.addSessionAgent(sess.sessionId, {
        agentId,
        roleInSession: "primary",
      });
    } catch {
      agentFailures.push(agentId);
    }
  }

  // 全部 Agent 注册失败:无法继续面试,返回失败
  if (config.agentIds.length > 0 && agentFailures.length === config.agentIds.length) {
    return {
      success: false,
      sessionId: sess.sessionId,
      error: `所有面试官 Agent 注册失败(共 ${agentFailures.length} 个),请检查 Agent 是否已被删除`,
      agentFailures,
    };
  }

  // 5. 设置全局 store,InterviewPage 会自动感知
  const store = useSessionStore.getState();
  store.setSession(sess);
  // 仅把注册成功的 agent 放入 team,避免 UI 显示不存在的 agent
  const successAgentIds = config.agentIds.filter((id) => !agentFailures.includes(id));
  store.setAgentTeam(successAgentIds);
  store.setDifficulty(config.difficulty);

  return {
    success: true,
    sessionId: sess.sessionId,
    partial: agentFailures.length > 0,
    agentFailures,
  };
}
