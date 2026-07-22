// autoLayout:流程图自动布局算法
// 从第一原理:布局 = 把图结构映射到 2D 坐标,让节点不重叠、连线不交叉、流向从左到右
// 算法:Kahn 拓扑排序 → 按层分层 → 每层垂直居中分布
import type { FlowNode, FlowEdge } from "./flowTypes";

export type LayoutMode = "horizontal" | "vertical";

interface LayoutOptions {
  mode?: LayoutMode;
  layerGap?: number; // 层间距(水平布局=横向间距,垂直布局=纵向间距)
  nodeGap?: number; // 同层节点间距
  startX?: number;
  startY?: number;
}

const NODE_W = 168;
const NODE_H = 64;

// 计算每个节点的层级(最长路径长度)
function computeLayers(nodes: FlowNode[], edges: FlowEdge[]): Map<string, number> {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (adj.has(e.source) && inDegree.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      inDegree.set(e.target, inDegree.get(e.target)! + 1);
    }
  }
  // 最长路径:BFS 松弛
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      layer.set(id, 0);
      queue.push(id);
    }
  }
  // Kahn 拓扑序(用头指针替代 shift(),避免 O(n²))
  const order: string[] = [];
  const inDegCopy = new Map(inDegree);
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    order.push(u);
    for (const v of adj.get(u) || []) {
      inDegCopy.set(v, inDegCopy.get(v)! - 1);
      if (inDegCopy.get(v) === 0) queue.push(v);
    }
  }
  // 按拓扑序计算最长路径层级
  for (const id of order) {
    if (!layer.has(id)) layer.set(id, 0);
  }
  for (const u of order) {
    const ul = layer.get(u)!;
    for (const v of adj.get(u) || []) {
      const vl = layer.get(v) ?? 0;
      if (ul + 1 > vl) layer.set(v, ul + 1);
    }
  }
  // 环内节点(未在 order 中)放到最后一层
  const inOrder = new Set(order);
  let maxLayer = 0;
  for (const l of layer.values()) maxLayer = Math.max(maxLayer, l);
  for (const n of nodes) {
    if (!inOrder.has(n.id)) layer.set(n.id, maxLayer + 1);
  }
  return layer;
}

// 自动布局:返回新的节点坐标(不修改原数组)
export function autoLayout(nodes: FlowNode[], edges: FlowEdge[], options: LayoutOptions = {}): FlowNode[] {
  const {
    mode = "horizontal",
    layerGap = 220,
    nodeGap = 90,
    startX = 80,
    startY = 80,
  } = options;

  if (nodes.length === 0) return nodes;

  const layer = computeLayers(nodes, edges);

  // 按层分组
  const layers = new Map<number, FlowNode[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(n);
  }

  // 计算每层的最大节点数,用于整体居中
  const maxNodesInLayer = Math.max(...Array.from(layers.values()).map((ns) => ns.length));
  const totalSpan = (maxNodesInLayer - 1) * nodeGap + NODE_H;

  // 分配坐标
  const result: FlowNode[] = [];
  const sortedLayers = Array.from(layers.keys()).sort((a, b) => a - b);
  for (const l of sortedLayers) {
    const layerNodes = layers.get(l)!;
    const layerSpan = (layerNodes.length - 1) * nodeGap + NODE_H;
    const offset = (totalSpan - layerSpan) / 2;
    layerNodes.forEach((n, idx) => {
      if (mode === "horizontal") {
        // 水平布局:层在 X 轴,同层节点在 Y 轴分布
        result.push({
          ...n,
          x: startX + l * layerGap,
          y: startY + offset + idx * nodeGap,
        });
      } else {
        // 垂直布局:层在 Y 轴,同层节点在 X 轴分布
        result.push({
          ...n,
          x: startX + offset + idx * nodeGap,
          y: startY + l * layerGap,
        });
      }
    });
  }
  return result;
}
