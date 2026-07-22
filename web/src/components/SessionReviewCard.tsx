// v5:整场面试回顾评价卡片
// 展示优势/不足/改进建议/下次重点
import { cn, formatTime } from "@/shared";
import { useI18n } from "@/i18n";
import type { SessionReview } from "@/types/session";
import { Star, CheckCircle2, AlertTriangle, Lightbulb, Target, Loader2, FileText } from "lucide-react";

interface Props {
  review: SessionReview | null;
  loading?: boolean;
  compact?: boolean; // 紧凑模式(用于弹窗)
}

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-ide-danger/20 text-ide-danger",
  medium: "bg-ide-warning/20 text-ide-warning",
  low: "bg-ide-accent/20 text-ide-accent",
};

function scoreColor(score: number): string {
  if (score >= 8) return "text-ide-success";
  if (score >= 6) return "text-ide-accent";
  if (score >= 4) return "text-ide-warning";
  return "text-ide-danger";
}

export function SessionReviewCard({ review, loading, compact }: Props) {
  const { t } = useI18n();

  const PRIORITY_LABEL: Record<string, string> = {
    high: t("sessionReview.priority.high"),
    medium: t("sessionReview.priority.medium"),
    low: t("sessionReview.priority.low"),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 border border-ide-border bg-ide-bg-alt p-6 text-xs text-ide-fg-muted">
        <Loader2 size={14} className="animate-spin" />
        {t("sessionReview.generating")}
      </div>
    );
  }

  if (!review) {
    return (
      <div className="border border-dashed border-ide-border bg-ide-bg-alt p-4 text-center text-xs text-ide-fg-muted">
        <FileText size={16} className="mx-auto mb-1 opacity-50" />
        {t("sessionReview.empty")}
      </div>
    );
  }

  return (
    <div className={cn("border border-ide-border bg-ide-bg-alt", compact ? "p-3" : "p-4")}>
      {/* 头部:综合评分 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star size={14} className="text-ide-warning" />
          <span className="text-xs font-semibold uppercase text-ide-fg-muted">{t("sessionReview.title")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ide-fg-muted">{t("sessionReview.score")}</span>
          <span className={cn("bg-ide-bg px-2 py-0.5 font-mono text-sm font-bold", scoreColor(review.overallScore))}>
            {review.overallScore?.toFixed(1) ?? "-"}
          </span>
          {review.generatedAt && (
            <span className="text-[10px] text-ide-fg-muted">{formatTime(review.generatedAt)}</span>
          )}
        </div>
      </div>

      {/* 整体表现 */}
      {review.performance && (
        <div className="mb-3 bg-ide-bg p-2 text-xs text-ide-fg">
          <div className="mb-1 text-[10px] uppercase text-ide-fg-muted">{t("sessionReview.performance")}</div>
          <div className="whitespace-pre-wrap">{review.performance}</div>
        </div>
      )}

      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-2")}>
        {/* 优势 */}
        {review.strengths && review.strengths.length > 0 && (
          <div className="bg-ide-success/5 p-2">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-ide-success">
              <CheckCircle2 size={11} /> {t("sessionReview.strengths")}
            </div>
            <ul className="space-y-0.5">
              {review.strengths.map((s, i) => (
                <li key={i} className="flex gap-1 text-xs text-ide-fg">
                  <span className="text-ide-success">•</span>
                  <span className="flex-1">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 不足 */}
        {review.weaknesses && review.weaknesses.length > 0 && (
          <div className="bg-ide-danger/5 p-2">
            <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-ide-danger">
              <AlertTriangle size={11} /> {t("sessionReview.weaknesses")}
            </div>
            <ul className="space-y-0.5">
              {review.weaknesses.map((s, i) => (
                <li key={i} className="flex gap-1 text-xs text-ide-fg">
                  <span className="text-ide-danger">•</span>
                  <span className="flex-1">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 改进建议 */}
      {review.improvements && review.improvements.length > 0 && (
        <div className="mt-3 bg-ide-bg p-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-ide-fg-muted">
            <Lightbulb size={11} /> {t("sessionReview.improvements")}
          </div>
          <div className="space-y-1">
            {review.improvements.map((imp, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className={cn("shrink-0 px-1 py-0.5 text-[9px]", PRIORITY_STYLE[imp.priority] || PRIORITY_STYLE.low)}>
                  {PRIORITY_LABEL[imp.priority] || imp.priority}
                </span>
                <div className="flex-1">
                  <span className="text-ide-fg">{imp.area}</span>
                  <span className="text-ide-fg-muted"> — {imp.suggestion}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 下次重点 */}
      {review.nextFocus && (
        <div className="mt-3 bg-ide-accent/5 p-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-ide-accent">
            <Target size={11} /> {t("sessionReview.nextFocus")}
          </div>
          <div className="whitespace-pre-wrap text-xs text-ide-fg">{review.nextFocus}</div>
        </div>
      )}
    </div>
  );
}
