// v5:分组归纳卡片
// 展示某分组的总场次/平均分/趋势/进步维度/弱项维度/建议
// 支持点击"生成 LLM 归纳"获取自然语言归纳
import { useState } from "react";
import { cn, formatTime } from "@/shared";
import { useI18n } from "@/i18n";
import type { GroupSummary } from "@/lib/groupSummary";
import { generateGroupSummaryLLM, shouldRefreshSummary } from "@/lib/groupSummary";
import { useGroupStore } from "@/stores/groupStore";
import {
  TrendingUp, TrendingDown, Minus, Activity, Award, AlertTriangle,
  Sparkles, Loader2, Calendar, Target,
} from "lucide-react";

interface Props {
  groupId: string;
  groupName: string;
  summary: GroupSummary;
  cachedLlmAdvice?: string;
  cachedSummaryGeneratedAt?: string;
}

const TREND_META = {
  up: { icon: TrendingUp, color: "text-ide-success", bg: "bg-ide-success/10" },
  down: { icon: TrendingDown, color: "text-ide-danger", bg: "bg-ide-danger/10" },
  stable: { icon: Minus, color: "text-ide-fg-muted", bg: "bg-ide-bg-active" },
  insufficient: { icon: Activity, color: "text-ide-fg-muted", bg: "bg-ide-bg-active" },
};

export function GroupSummaryCard({ groupId, groupName, summary, cachedLlmAdvice, cachedSummaryGeneratedAt }: Props) {
  const { t } = useI18n();
  const [generating, setGenerating] = useState(false);
  const [llmAdvice, setLlmAdvice] = useState<string | undefined>(cachedLlmAdvice);
  const [error, setError] = useState<string | null>(null);
  const refreshSummary = useGroupStore((s) => s.refreshSummary);

  const trend = TREND_META[summary.trend];
  const TrendIcon = trend.icon;

  const handleGenerateLlm = async () => {
    setError(null);
    setGenerating(true);
    try {
      const advice = await generateGroupSummaryLLM(groupId, summary);
      setLlmAdvice(advice);
      refreshSummary(groupId, advice);
    } catch (e: any) {
      setError(t("groupSummary.generateFailed", { msg: e.message }));
    } finally {
      setGenerating(false);
    }
  };

  const needRefresh = shouldRefreshSummary(cachedSummaryGeneratedAt);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ide-fg">{groupName}</span>
          <span className="bg-ide-accent/20 px-1.5 py-0.5 text-[10px] text-ide-accent">
            {t("groupSummary.title")}
          </span>
        </div>
        <button
          onClick={handleGenerateLlm}
          disabled={generating || summary.totalSessions === 0}
          className="flex h-6 items-center gap-1 bg-ide-accent px-2 text-[11px] text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
          title={needRefresh ? t("groupSummary.regenerateTip") : t("groupSummary.generateTip")}
        >
          {generating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          {llmAdvice ? t("groupSummary.regenerate") : t("groupSummary.generate")}
        </button>
      </div>

      {error && (
        <div className="border border-ide-danger/30 bg-ide-danger/10 px-2 py-1 text-[11px] text-ide-danger">
          {error}
        </div>
      )}

      {/* 统计概览 */}
      <div className="grid grid-cols-4 gap-2">
        <StatBox label={t("groupSummary.totalSessions")} value={String(summary.totalSessions)} />
        <StatBox label={t("groupSummary.avgScore")} value={summary.avgScore > 0 ? summary.avgScore.toFixed(1) : "-"} />
        <StatBox label={t("groupSummary.maxScore")} value={summary.maxScore > 0 ? summary.maxScore.toFixed(1) : "-"} />
        <StatBox label={t("groupSummary.minScore")} value={summary.minScore > 0 ? summary.minScore.toFixed(1) : "-"} />
      </div>

      {/* 趋势 + 时间范围 */}
      <div className="grid grid-cols-2 gap-2">
        <div className={cn("border border-ide-border p-2", trend.bg)}>
          <div className="mb-0.5 text-[10px] uppercase text-ide-fg-muted">{t("groupSummary.trend")}</div>
          <div className={cn("flex items-center gap-1 text-xs font-semibold", trend.color)}>
            <TrendIcon size={12} />
            {t(`groupSummary.trend.${summary.trend}`)}
          </div>
        </div>
        <div className="border border-ide-border bg-ide-bg-alt p-2">
          <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase text-ide-fg-muted">
            <Calendar size={10} /> {t("groupSummary.dateRange")}
          </div>
          <div className="text-[11px] text-ide-fg">
            {summary.dateRange
              ? `${formatTime(summary.dateRange.start)} - ${formatTime(summary.dateRange.end)}`
              : t("groupSummary.noData")}
          </div>
        </div>
      </div>

      {/* 进步曲线(简易条形) */}
      {summary.progressPoints.length > 0 && (
        <div className="border border-ide-border bg-ide-bg-alt p-2">
          <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-ide-fg-muted">
            <Activity size={11} /> {t("groupSummary.progressCurve")}
          </div>
          <div className="flex h-16 items-end gap-1">
            {summary.progressPoints.map((p, i) => {
              const heightPct = Math.max(10, (p.score / 10) * 100);
              const isLast = i === summary.progressPoints.length - 1;
              return (
                <div
                  key={i}
                  className="group relative flex-1"
                  title={`${p.title}: ${p.score.toFixed(1)}`}
                >
                  <div
                    className={cn(
                      "w-full transition-all",
                      isLast ? "bg-ide-accent" : "bg-ide-accent/40 hover:bg-ide-accent/60"
                    )}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-ide-fg-muted">
            <span>{t("groupSummary.sessionsCount", { n: summary.progressPoints.length })}</span>
            <span>{t("groupSummary.latest", { score: summary.progressPoints[summary.progressPoints.length - 1].score.toFixed(1) })}</span>
          </div>
        </div>
      )}

      {/* 已提升维度 */}
      {summary.improvedDimensions.length > 0 && (
        <div className="border border-ide-border bg-ide-success/5 p-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-ide-success">
            <Award size={11} /> {t("groupSummary.dimensionsChange")}
          </div>
          <div className="space-y-0.5">
            {summary.improvedDimensions.slice(0, 5).map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-ide-fg">{d.name}</span>
                <span className="flex items-center gap-1 font-mono text-[10px]">
                  <span className="text-ide-fg-muted">{d.earlyAvg.toFixed(1)}</span>
                  <span className="text-ide-fg-muted">→</span>
                  <span className="text-ide-fg">{d.lateAvg.toFixed(1)}</span>
                  <span className={cn("px-1", d.delta > 0 ? "bg-ide-success/20 text-ide-success" : "bg-ide-danger/20 text-ide-danger")}>
                    {d.delta > 0 ? "+" : ""}{d.delta.toFixed(1)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 仍需加强维度 */}
      {summary.weakDimensions.length > 0 && (
        <div className="border border-ide-border bg-ide-danger/5 p-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-ide-danger">
            <AlertTriangle size={11} /> {t("groupSummary.weakDimensions")}
          </div>
          <div className="flex flex-wrap gap-1">
            {summary.weakDimensions.slice(0, 5).map((d, i) => (
              <span key={i} className="flex items-center gap-1 bg-ide-danger/10 px-1.5 py-0.5 text-[10px] text-ide-danger">
                {d.name}
                <span className="font-mono">{d.avgScore.toFixed(1)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 本地建议 */}
      {summary.advice && (
        <div className="border border-ide-border bg-ide-bg-alt p-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-ide-fg-muted">
            <Target size={11} /> {t("groupSummary.advice")}
          </div>
          <div className="whitespace-pre-wrap text-xs text-ide-fg">{summary.advice}</div>
        </div>
      )}

      {/* LLM 归纳 */}
      {llmAdvice && (
        <div className="border border-ide-accent/30 bg-ide-accent/5 p-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-ide-accent">
            <Sparkles size={11} /> {t("groupSummary.aiSummary")}
          </div>
          <div className="whitespace-pre-wrap text-xs text-ide-fg">{llmAdvice}</div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ide-border bg-ide-bg-alt p-2 text-center">
      <div className="text-[10px] uppercase text-ide-fg-muted">{label}</div>
      <div className="font-mono text-sm font-bold text-ide-fg">{value}</div>
    </div>
  );
}
