// GitHub 风格贡献热力图:最近 53 周(一整年),每列一周(周一到周日)
// 5 级色阶,12px 方格带 2px 圆角,顶部统计概览(总贡献/当前连续/最长连续)
// 横向溢出时支持滚动,避免在小容器里被压缩
import { useMemo, useState } from "react";
import type { HeatmapDay } from "@/lib/heatmapData";
import { useI18n } from "@/i18n";

interface HeatmapProps {
  data: HeatmapDay[];
}

const WEEKS = 53;
const DAYS_PER_WEEK = 7;
const CELL = 12;   // 方格 12px(GitHub 实际尺寸,比原 11px 更醒目)
const GAP = 3;     // 间距 3px
const RADIUS = 2;  // 圆角 2px(GitHub 同款)

// 星期/月份的 i18n key 映射(Mon=0 ... Sun=6)
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_LABEL_INDICES = [0, 2, 4]; // 仅显示 一/三/五(Mon/Wed/Fri)
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// 5 级色阶(0-4),与 GitHub 一致:0=无活动,1-4 由浅到深
const LEVEL_COLORS = [
  "var(--ide-bg-active)",                                            // 0 次
  "color-mix(in srgb, var(--ide-accent) 25%, var(--ide-bg-active))", // 1 次
  "color-mix(in srgb, var(--ide-accent) 50%, var(--ide-bg-active))", // 2-3 次
  "color-mix(in srgb, var(--ide-accent) 75%, var(--ide-bg-active))", // 4-5 次
  "var(--ide-accent)",                                               // 6+ 次
];

function levelFor(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekdayIdx(d: Date): number {
  const g = d.getDay(); // 0=Sun ... 6=Sat
  return g === 0 ? 6 : g - 1; // 映射到 Mon=0 ... Sun=6
}

/** 计算当前连续天数(从今天往前数,遇到 0 次即停) */
function calcCurrentStreak(byDate: Map<string, HeatmapDay>, today: Date): number {
  let streak = 0;
  const cur = new Date(today);
  while (true) {
    const key = formatYMD(cur);
    const day = byDate.get(key);
    if (day && day.count > 0) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    } else break;
  }
  return streak;
}

/** 计算最长连续天数(遍历整个数据期) */
function calcLongestStreak(byDate: Map<string, HeatmapDay>, start: Date, end: Date): number {
  let longest = 0;
  let cur = 0;
  const d = new Date(start);
  while (d <= end) {
    const key = formatYMD(d);
    const day = byDate.get(key);
    if (day && day.count > 0) {
      cur++;
      if (cur > longest) longest = cur;
    } else {
      cur = 0;
    }
    d.setDate(d.getDate() + 1);
  }
  return longest;
}

export function Heatmap({ data }: HeatmapProps) {
  const { t } = useI18n();
  const [hover, setHover] = useState<{ rect: DOMRect; day: HeatmapDay } | null>(null);

  const byDate = useMemo(() => {
    const m = new Map<string, HeatmapDay>();
    for (const d of data || []) m.set(d.date, d);
    return m;
  }, [data]);

  // 起始日期:本周周一往前 52 周(共 53 周);today 用于隐藏未来日期
  const { start, today } = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const day = t.getDay();
    const offset = day === 0 ? 6 : day - 1;
    const s = new Date(t);
    s.setDate(s.getDate() - offset - (WEEKS - 1) * 7);
    return { start: s, today: t };
  }, []);

  // 53 周 x 7 天矩阵
  const weeks = useMemo(() => {
    const arr: { date: string; day: HeatmapDay | null; future: boolean }[][] = [];
    for (let w = 0; w < WEEKS; w++) {
      const week: { date: string; day: HeatmapDay | null; future: boolean }[] = [];
      for (let d = 0; d < DAYS_PER_WEEK; d++) {
        const date = new Date(start);
        date.setDate(date.getDate() + w * 7 + d);
        const dateStr = formatYMD(date);
        week.push({
          date: dateStr,
          day: byDate.get(dateStr) || null,
          future: date > today,
        });
      }
      arr.push(week);
    }
    return arr;
  }, [start, today, byDate]);

  // 月份标签:每月首次出现的周列上显示
  const monthLabels = useMemo(() => {
    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < weeks.length; w++) {
      const firstDay = new Date(weeks[w][0].date);
      const m = firstDay.getMonth();
      if (m !== lastMonth) {
        labels.push({ col: w, label: t("heatmap.month." + MONTH_KEYS[m]) });
        lastMonth = m;
      }
    }
    return labels;
  }, [weeks, t]);

  // 统计概览:总贡献数 + 当前连续 + 最长连续
  const stats = useMemo(() => {
    const total = (data || []).reduce((s, d) => s + (d.count || 0), 0);
    const currentStreak = calcCurrentStreak(byDate, today);
    const longestStreak = calcLongestStreak(byDate, start, today);
    return { total, currentStreak, longestStreak };
  }, [data, byDate, today, start]);

  const hasData = (data || []).some((d) => d.count > 0);

  const colWidth = CELL + GAP;
  // 内部网格总宽:53 周 × (12+3) - 3 = 788px
  const gridWidth = WEEKS * colWidth - GAP;
  const tooltipTop = hover
    ? hover.rect.top - 58 < 4
      ? hover.rect.bottom + 6
      : hover.rect.top - 58
    : 0;
  const tooltipLeft = hover
    ? Math.max(4, Math.min(hover.rect.left + hover.rect.width + 6, window.innerWidth - 170))
    : 0;

  return (
    <div className="relative">
      {/* 空数据引导 */}
      {!hasData && (
        <div className="mb-2 border border-ide-border bg-ide-bg-alt px-2 py-1.5 text-[11px] text-ide-fg-muted">
          {t("heatmap.empty")}
        </div>
      )}

      {/* 统计概览:仿 GitHub 顶部 "X contributions in the last year" */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-ide-fg-muted">
        <span>
          <span className="font-semibold text-ide-fg">{stats.total}</span>
          {" " + t("heatmap.practicesUnit")}
          <span className="ml-1 text-ide-fg-muted/70">{t("heatmap.lastYear")}</span>
        </span>
        <span>
          {t("heatmap.currentStreakLabel")} <span className="font-semibold text-ide-fg">{stats.currentStreak}</span> {t("heatmap.daysUnit")}
        </span>
        <span>
          {t("heatmap.longestStreakLabel")} <span className="font-semibold text-ide-fg">{stats.longestStreak}</span> {t("heatmap.daysUnit")}
        </span>
      </div>

      {/* 横向滚动容器:窄屏不被压缩,可拖动查看全年 */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-start gap-1" style={{ minWidth: "fit-content" }}>
          {/* 左侧星期标签(一/三/五) */}
          <div className="flex flex-col" style={{ gap: GAP, marginTop: 20 }}>
            {Array.from({ length: 7 }).map((_, i) => {
              const showIdx = WEEKDAY_LABEL_INDICES.indexOf(i);
              const label = showIdx >= 0 ? t("heatmap.weekday." + WEEKDAY_KEYS[i]) : "";
              return (
                <div
                  key={i}
                  className="text-[10px] text-ide-fg-muted"
                  style={{ height: CELL, lineHeight: `${CELL}px`, width: 14 }}
                >
                  {label}
                </div>
              );
            })}
          </div>

          {/* 月份标签 + 周列网格 */}
          <div>
            {/* 月份标签行 */}
            <div
              className="relative mb-1"
              style={{ height: 16, width: gridWidth }}
            >
              {monthLabels.map(({ col, label }) => (
                <div
                  key={col}
                  className="absolute text-[10px] text-ide-fg-muted"
                  style={{ left: col * colWidth, top: 0, lineHeight: "16px" }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* 周列网格:每列一周,每行一天 */}
            <div className="flex" style={{ gap: GAP }}>
              {weeks.map((week, wIdx) => (
                <div key={wIdx} className="flex flex-col" style={{ gap: GAP }}>
                  {week.map((cell, dIdx) => {
                    if (cell.future) {
                      return <div key={dIdx} style={{ width: CELL, height: CELL }} />;
                    }
                    const count = cell.day?.count ?? 0;
                    const level = levelFor(count);
                    const bg = LEVEL_COLORS[level];
                    const dayData: HeatmapDay = cell.day || { date: cell.date, count: 0 };
                    return (
                      <div
                        key={dIdx}
                        className="transition-[transform,opacity] duration-100 hover:scale-110 hover:opacity-90"
                        style={{ width: CELL, height: CELL, background: bg, borderRadius: RADIUS }}
                        onMouseEnter={(e) => {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setHover({ rect, day: dayData });
                        }}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 图例:Less → 5 级色阶 → More */}
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-ide-fg-muted">
        <span>{t("heatmap.less")}</span>
        {LEVEL_COLORS.map((c, i) => (
          <div
            key={i}
            style={{ width: CELL, height: CELL, background: c, borderRadius: RADIUS }}
          />
        ))}
        <span>{t("heatmap.more")}</span>
      </div>

      {/* Tooltip:日期 + 星期 + 次数 + 平均分 */}
      {hover && (
        <div
          className="pointer-events-none fixed z-40 border border-ide-border bg-ide-bg-alt px-2.5 py-1.5 text-[11px] leading-relaxed text-ide-fg shadow-xl"
          style={{ left: tooltipLeft, top: tooltipTop }}
        >
          <div className="font-medium">
            {t("heatmap.tooltipDate", {
              date: hover.day.date,
              weekday: t("heatmap.weekday." + WEEKDAY_KEYS[weekdayIdx(new Date(hover.day.date))]),
            })}
          </div>
          <div className="text-ide-fg-muted">
            {hover.day.count > 0
              ? t("heatmap.tooltipCount", { n: hover.day.count })
              : t("heatmap.tooltipNoRecord")}
          </div>
          {hover.day.score != null && (
            <div className="text-ide-fg-muted">{t("heatmap.tooltipAvgScore", { score: hover.day.score.toFixed(1) })}</div>
          )}
        </div>
      )}
    </div>
  );
}
