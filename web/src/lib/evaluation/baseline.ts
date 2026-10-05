// 评估基准 —— 从"硬编码假数据"改为"用户自己的历史分位"
//
// 背景(P2-4,挂了两轮才处理):
//   `PEER_BENCHMARK` 原为 `EVALUATION_DIMENSIONS.map(d => ({..., score: 3.5}))`,
//   六个维度全写死 3.5,`EvaluationRadar` 却把它标为"同岗位平均"展示。
//   —— **零数据来源的常数被包装成行业基准**,属于可信度问题。
//
// 为什么不用"同岗位真实平均":
//   我们**没有**任何真实面试数据。任何声称"同岗位平均"的数字都是编的,
//   即使数值看起来合理(如 3.5)也一样。
//
// 改为什么:用户自己的历史分位。
//   - 数据真实存在(用户自己跑出来的评估)
//   - 对用户有意义:"你这次技术深度低于你自己平均的 30%"
//   - 冷启动无数据时不显示,而不是画一条假线
//
// 参照 HireVue 的教训:放弃摄像头判决、保留麦克风判决,
// "并不是修复了问题,只是把它移到了更难被看见的地方"。
// 诚实的数据边界比好看的图表重要。

export interface DimensionScoreInput {
  dimensionName: string;
  score: number;
}

export type PercentileMap = Record<string, number>;

/**
 * 计算每个维度的历史中位数,作为该用户的个人基准。
 * @param history 该用户所有历史评估的维度分数
 * @returns 维度名 → 中位数;无足够数据时返回空对象
 */
export function computePersonalBaseline(
  history: DimensionScoreInput[][],
  minSamples = 3
): PercentileMap {
  const byDim = new Map<string, number[]>();
  for (const evalRow of history || []) {
    for (const d of evalRow || []) {
      if (typeof d?.score !== "number" || !Number.isFinite(d.score)) continue;
      const arr = byDim.get(d.dimensionName) || [];
      arr.push(d.score);
      byDim.set(d.dimensionName, arr);
    }
  }
  const out: PercentileMap = {};
  for (const [dim, arr] of byDim) {
    // 样本太少就不给基准 —— 3 个点算出的"中位数"没有统计意义
    if (arr.length < minSamples) continue;
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    out[dim] = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }
  return out;
}

/**
 * 某次评估相对个人基准的位置。
 * @returns 高于/低于/持平;无基准时为 null(UI 应隐藏这条线)
 */
export function compareToBaseline(
  dim: string,
  score: number,
  baseline: PercentileMap
): "above" | "below" | "on" | null {
  const b = baseline?.[dim];
  if (typeof b !== "number") return null;
  if (score > b) return "above";
  if (score < b) return "below";
  return "on";
}

/**
 * 数据是否足够支撑展示个人基准。
 * 冷启动(0-2 次评估)时返回 false —— 此时画线只会误导。
 */
export function shouldShowBaseline(evalCount: number, minSamples = 3): boolean {
  return Number.isFinite(evalCount) && evalCount >= minSamples;
}
