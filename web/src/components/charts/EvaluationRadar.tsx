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
import { buildRadarData } from "./radarData";

interface Dimension {
  dimensionName: string;
  score: number;
  comment?: string;
}

export function EvaluationRadar({
  dimensions,
  maxScore = 5,
  /**
   * 个人历史基准(可选):该用户自己历次评估的中位数。
   *
   * W5-1(P2-4):此前这里用的是 `PEER_BENCHMARK` —— 六个维度全写死 3.5,
   * 却标为"同岗位平均"展示。**那是零数据来源的假基准。**
   * 现在改为用户自己的历史中位数:数据真实、对用户有意义、冷启动不显示。
   */
  baseline,
}: {
  dimensions: Dimension[];
  maxScore?: number;
  /** 维度名 → 个人历史中位数;缺项则该维度不画基准线 */
  baseline?: Record<string, number>;
}) {
  const { locale } = useI18n();
  if (!dimensions || dimensions.length === 0) return null;
  const yourScoreLabel = locale === "zh-CN" ? "你的得分" : "Your Score";
  const baseLabel = locale === "zh-CN" ? "你的历史中位" : "Your Median";
  /*
   * R22:数据构造抽到 radarData.ts(纯函数 + 8 例测试)。
   * 关键修正:缺基准的维度填 **null 而非 0** ——
   * 0 会被画到原点,读起来像"这个维度你历史上一分没有",
   * 而真相是"样本不足,还没算出来"。
   */
  const { data, hasBaseline, missingBaselineCount } = buildRadarData(dimensions, baseline, maxScore);
  return (
    <>
    {hasBaseline && missingBaselineCount > 0 && (
      <div className="mb-1 text-[10px] leading-relaxed text-ide-fg-muted">
        {locale === "zh-CN"
          ? `${missingBaselineCount} 个维度暂无历史数据(样本不足 3 次),基准线未覆盖`
          : `${missingBaselineCount} dimension(s) have no history yet (fewer than 3 samples); baseline not drawn for them`}
      </div>
    )}
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data}>
        <PolarGrid stroke="var(--ide-border)" />
        <PolarAngleAxis dataKey="dimension" tick={{ fill: "var(--ide-fg-muted)", fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, maxScore]} tick={{ fill: "var(--ide-fg-muted)", fontSize: 10 }} />
        <Radar name={yourScoreLabel} dataKey="score" stroke="var(--ide-accent)" fill="var(--ide-accent)" fillOpacity={0.3} />
        {hasBaseline && (
          <Radar name={baseLabel} dataKey="benchmark" stroke="var(--ide-fg-muted)" fill="var(--ide-fg-muted)" fillOpacity={0.1} strokeDasharray="4 2" />
        )}
        <Tooltip
          contentStyle={{
            background: "var(--ide-bg-alt)",
            border: "1px solid var(--ide-border)",
            borderRadius: 4,
            fontSize: 12,
          }}
        />
        {hasBaseline && (
          <Legend wrapperStyle={{ fontSize: 11 }} />
        )}
      </RadarChart>
    </ResponsiveContainer>
    </>
  );
}
