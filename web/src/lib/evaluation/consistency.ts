/*
 * 一致性度量 —— 把 V6「单维度评分一致率 >= 85%」变成可计算的指标
 *
 * 为什么需要它:ADR-001 声称"独立评分比联合评估更稳定",
 * 依据是 arXiv:2608.14684 的 Qwen3-32B 36% 样本级一致率。
 * 但那是**别人的数字、别人的模型、别人的题目**。
 * 我们必须能在自己的题库、自己的 prompt、自己的模型上复现这个结论 ——
 * 否则 ADR-001 只是一条没有本地证据的外部引用。
 *
 * 度量方式:**两两比较**
 *   同一组输入跑 N 次,任取两次比较该维度分数是否相同,
 *   一致率 = 相同对数 / 总对数 = 1 - C(N,2 中不相等的对数) / C(N,2)
 *
 * 选它而不是众数占比/标准差的理由:
 *   - N=3 时众数占比退化(众数可能是 1/3 也可能是 2/3,区分度差)
 *   - 分数是 1-5 序数量,均值/方差没有直觉意义
 *   - 它直接回答真实问题:"换个模型版本试试,结论会不会翻盘"
 */

export interface RunResult {
  [dimensionName: string]: number | undefined;
}

export interface DimensionStats {
  scores: number[];
  /** 有效观测次数 */
  sampleCount: number;
  consistency: number;
  mean: number;
}

export type RunSummary = Record<string, DimensionStats>;

/**
 * 单个维度的两两一致率。
 * N<=1 时返回 1:只有一次观测就没有"不一致"的证据,
 * 返回 0 会把单次运行误判为不稳定。
 */
export function dimensionConsistency(scores: number[]): number {
  const valid = scores.filter((s) => typeof s === "number" && Number.isFinite(s));
  const n = valid.length;
  if (n <= 1) return 1;
  let agree = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      total++;
      if (valid[i] === valid[j]) agree++;
    }
  }
  return total === 0 ? 1 : agree / total;
}

/** 把 N 次运行的「维度名 → 分数」聚合成每个维度的统计 */
export function summarizeRuns(runs: RunResult[]): RunSummary {
  const byDim = new Map<string, number[]>();
  for (const run of runs) {
    for (const [dim, score] of Object.entries(run || {})) {
      if (typeof score !== "number" || !Number.isFinite(score)) continue;
      const arr = byDim.get(dim) || [];
      arr.push(score);
      byDim.set(dim, arr);
    }
  }
  const out: RunSummary = {};
  for (const [dim, scores] of byDim) {
    const sum = scores.reduce((a, b) => a + b, 0);
    out[dim] = {
      scores,
      sampleCount: scores.length,
      consistency: dimensionConsistency(scores),
      mean: scores.length ? sum / scores.length : 0,
    };
  }
  return out;
}

export interface ConsistencyComparison {
  isolated: number;
  joint: number;
  delta: number;
}

export interface CompareResult {
  [dimensionName: string]: ConsistencyComparison;
  overall: ConsistencyComparison;
}

/**
 * 比较两种模式在共同维度上的稳定性。
 * 某模式缺席的维度不参与比较,避免污染总体均值。
 */
export function compareConsistency(summaries: {
  isolated: RunSummary;
  joint: RunSummary;
}): CompareResult {
  const shared = Object.keys(summaries.isolated).filter((d) => summaries.joint[d]);
  const out: CompareResult = {} as CompareResult;

  for (const d of shared) {
    const i = summaries.isolated[d].consistency;
    const j = summaries.joint[d].consistency;
    out[d] = { isolated: i, joint: j, delta: i - j };
  }

  // 总体:对共同维度的一致率取平均。两边都空时返回 1(而非 NaN)
  const overall: ConsistencyComparison =
    shared.length === 0
      ? { isolated: 1, joint: 1, delta: 0 }
      : {
          isolated: shared.reduce((a, d) => a + summaries.isolated[d].consistency, 0) / shared.length,
          joint: shared.reduce((a, d) => a + summaries.joint[d].consistency, 0) / shared.length,
          delta: 0,
        };
  overall.delta = overall.isolated - overall.joint;
  out.overall = overall;
  return out;
}
