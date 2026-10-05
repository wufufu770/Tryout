// 雷达图数据构造
//
// 抽成纯函数的原因:Recharts 的 `benchmark: number | null` 语义
// —— `null` 表示该维度无数据(Recharts 会在该轴断开),
// `0` 表示"确实是 0 分"。这个区别在图上完全看不出来,但含义相反。
export interface RadarDimensionInput {
  dimensionName: string;
  score: number;
}

export interface RadarDatum {
  dimension: string;
  score: number;
  fullMark: number;
  /** null = 该维度无基准数据(样本不足);0 = 基准确实是 0 */
  benchmark: number | null;
}

export interface RadarDataResult {
  data: RadarDatum[];
  hasBaseline: boolean;
  /** 有多少维度缺少基准 —— 供 UI 提示"部分维度无历史数据" */
  missingBaselineCount: number;
}

export function buildRadarData(
  dimensions: RadarDimensionInput[],
  baseline: Record<string, number> | undefined,
  maxScore = 5
): RadarDataResult {
  const list = Array.isArray(dimensions) ? dimensions : [];
  const base = baseline && typeof baseline === "object" ? baseline : {};

  const data: RadarDatum[] = list.map((d) => ({
    dimension: d.dimensionName,
    score: d.score,
    fullMark: maxScore,
    // ⚠️ 缺失必须是 null,不能是 0。
    // 0 会被画成"基准在原点",读起来像"这个维度你历史上一分没有";
    // 而真相是"样本不足,还没算出来"。
    benchmark: typeof base[d.dimensionName] === "number" ? base[d.dimensionName] : null,
  }));

  const missingBaselineCount = data.filter((d) => d.benchmark === null).length;
  return {
    data,
    hasBaseline: data.length > 0 && missingBaselineCount < data.length,
    missingBaselineCount,
  };
}
