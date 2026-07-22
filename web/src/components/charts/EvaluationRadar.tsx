import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { useI18n } from "@/i18n";

interface Dimension {
  dimensionName: string;
  score: number;
  comment?: string;
}

export function EvaluationRadar({
  dimensions,
  maxScore = 5,
  /** 同岗位平均水平基准(可选),用于对比展示 */
  benchmark,
}: {
  dimensions: Dimension[];
  maxScore?: number;
  benchmark?: { dimensionName: string; score: number }[];
}) {
  const { locale } = useI18n();
  if (!dimensions || dimensions.length === 0) return null;
  const yourScoreLabel = locale === "zh-CN" ? "你的得分" : "Your Score";
  const peerLabel = locale === "zh-CN" ? "同岗位平均" : "Peer Average";
  // 合并维度与基准
  const data = dimensions.map((d) => {
    const bm = benchmark?.find((b) => b.dimensionName === d.dimensionName);
    return {
      dimension: d.dimensionName,
      score: d.score,
      fullMark: maxScore,
      benchmark: bm?.score ?? 0,
    };
  });
  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data}>
        <PolarGrid stroke="var(--ide-border)" />
        <PolarAngleAxis dataKey="dimension" tick={{ fill: "var(--ide-fg-muted)", fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, maxScore]} tick={{ fill: "var(--ide-fg-muted)", fontSize: 10 }} />
        <Radar name={yourScoreLabel} dataKey="score" stroke="var(--ide-accent)" fill="var(--ide-accent)" fillOpacity={0.3} />
        {benchmark && benchmark.length > 0 && (
          <Radar name={peerLabel} dataKey="benchmark" stroke="var(--ide-fg-muted)" fill="var(--ide-fg-muted)" fillOpacity={0.1} strokeDasharray="4 2" />
        )}
        <Tooltip
          contentStyle={{
            background: "var(--ide-bg-alt)",
            border: "1px solid var(--ide-border)",
            borderRadius: 4,
            fontSize: 12,
          }}
        />
        {benchmark && benchmark.length > 0 && (
          <Legend wrapperStyle={{ fontSize: 11 }} />
        )}
      </RadarChart>
    </ResponsiveContainer>
  );
}
