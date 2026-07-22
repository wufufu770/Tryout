// 进步曲线 + 维度演进曲线
// 2026-07 修订:dimensions prop 真正实现,每个维度一条 Line 展示历史趋势
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatTime } from "@/shared";
import { useI18n } from "@/i18n";
import { EVALUATION_DIMENSIONS, getDimensionKey } from "@/lib/evaluation/starEvaluator";

interface ScorePoint {
  score: number;
  date: string;
  sessionId: string;
}

// 维度历史得分:每次评估一个点,按时间排序
export interface DimensionHistoryPoint {
  score: number;
  date: string;
  evaluationId: string;
}

export interface DimensionHistory {
  dimensionName: string; // 中文维度名(来自 LLM)
  points: DimensionHistoryPoint[];
}

interface Props {
  data: ScorePoint[];
  // 维度演进:每个维度的历史得分序列(按时间排序)
  dimensionHistory?: DimensionHistory[];
}

// 颜色池:6 个维度各一种颜色
const DIMENSION_COLORS = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
];

export function ProgressCurve({ data, dimensionHistory }: Props) {
  const { t } = useI18n();

  if (!data || data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-ide-fg-muted">
        {t("history.progressEmpty")}
      </div>
    );
  }

  // 综合评分图表数据
  const overallChartData = data.map((d, i) => ({
    name: `${t("history.sessionN", { n: i + 1 })}`,
    date: formatTime(d.date),
    [t("report.overallScore")]: d.score,
  }));

  // 维度演进图表数据:横轴是第 N 次评估,每个维度一个字段
  // 只有当 dimensionHistory 提供且非空时才渲染
  const hasDimensionHistory = dimensionHistory && dimensionHistory.length > 0 && dimensionHistory.some(d => d.points.length > 0);
  const dimensionChartData = hasDimensionHistory
    ? data.map((d, i) => {
        const point: Record<string, string | number> = {
          name: `${t("history.sessionN", { n: i + 1 })}`,
          date: formatTime(d.date),
        };
        for (const dh of dimensionHistory!) {
          const p = dh.points[i]; // 第 i 次评估的该维度得分
          if (p) {
            // 用维度 key 作为字段名,显示时再翻译
            const key = getDimensionKey(dh.dimensionName);
            point[key || dh.dimensionName] = p.score;
          }
        }
        return point;
      })
    : [];

  return (
    <div className="flex flex-col gap-3">
      {/* 综合评分曲线 */}
      <ResponsiveContainer width="100%" height={hasDimensionHistory ? 160 : 240}>
        <LineChart data={overallChartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--ide-border)" />
          <XAxis dataKey="name" tick={{ fill: "var(--ide-fg-muted)", fontSize: 11 }} />
          <YAxis domain={[0, 10]} tick={{ fill: "var(--ide-fg-muted)", fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: "var(--ide-bg-alt)",
              border: "1px solid var(--ide-border)",
              borderRadius: 4,
            }}
          />
          <Legend />
          <Line type="monotone" dataKey={t("report.overallScore")} stroke="var(--ide-accent)" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>

      {/* 维度演进曲线:每个维度一条 Line */}
      {hasDimensionHistory && (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={dimensionChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--ide-border)" />
            <XAxis dataKey="name" tick={{ fill: "var(--ide-fg-muted)", fontSize: 11 }} />
            <YAxis domain={[0, 5]} tick={{ fill: "var(--ide-fg-muted)", fontSize: 10 }} />
            <Tooltip
              contentStyle={{
                background: "var(--ide-bg-alt)",
                border: "1px solid var(--ide-border)",
                borderRadius: 4,
              }}
            />
            <Legend />
            {EVALUATION_DIMENSIONS.map((dim, i) => {
              // 只渲染有数据的维度
              const hasData = dimensionHistory!.some(dh => dh.dimensionName === dim.name && dh.points.length > 0);
              if (!hasData) return null;
              return (
                <Line
                  key={dim.key}
                  type="monotone"
                  dataKey={dim.key}
                  name={t(`report.dim.${dim.key}`)}
                  stroke={DIMENSION_COLORS[i % DIMENSION_COLORS.length]}
                  strokeWidth={1.5}
                  dot={{ r: 3 }}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
