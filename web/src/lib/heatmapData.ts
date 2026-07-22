// 热力图数据聚合:接收评估列表,按日期聚合,返回最近 53 周的逐日数据(仿 GitHub 一整年)
export interface HeatmapDay {
  date: string; // YYYY-MM-DD
  count: number;
  score?: number; // 当天平均分
}

const WEEKS = 53;

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 接收评估列表(含 generatedAt/createdAt/sessionId/overallScore),
 * 按日期聚合 count 与平均分,补全最近 26 周内无数据的日期(count=0)。
 */
export function buildHeatmapData(evaluations: any[]): HeatmapDay[] {
  // 按日期聚合
  const byDate = new Map<string, { count: number; scoreSum: number; scoreCount: number }>();
  for (const e of evaluations || []) {
    const raw = e?.generatedAt || e?.createdAt;
    if (!raw) continue;
    const d = new Date(raw);
    if (isNaN(d.getTime())) continue;
    const date = formatYMD(d);
    const cur = byDate.get(date) || { count: 0, scoreSum: 0, scoreCount: 0 };
    cur.count += 1;
    if (typeof e.overallScore === "number" && isFinite(e.overallScore)) {
      cur.scoreSum += e.overallScore;
      cur.scoreCount += 1;
    }
    byDate.set(date, cur);
  }

  // 起始日期:本周周一往前 52 周,共 53 周(每列一周,周一到周日)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDay = today.getDay(); // 0=Sun ... 6=Sat
  const mondayOffset = todayDay === 0 ? 6 : todayDay - 1;
  const start = new Date(today);
  start.setDate(start.getDate() - mondayOffset - (WEEKS - 1) * 7);

  const totalDays = WEEKS * 7;
  const result: HeatmapDay[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const date = formatYMD(d);
    const agg = byDate.get(date);
    if (agg) {
      result.push({
        date,
        count: agg.count,
        score: agg.scoreCount > 0 ? agg.scoreSum / agg.scoreCount : undefined,
      });
    } else {
      result.push({ date, count: 0 });
    }
  }
  return result;
}
