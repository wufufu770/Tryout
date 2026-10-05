// 实时教练面板 —— 面试现场可见的评估反馈
//
// 设计取舍(这些不是随手定的):
//   1. **只展示 weaknesses / 锚点 / 依据,不展示 betterAnswerSample** ——
//      面试中给出"更好的回答"等于让用户照抄,会打断心流且降低练习价值。
//      完整示范留到会话结束。
//   2. **弱项优先,强项折叠** —— 面试中用户能改进的是弱项,不是强项。
//   3. **显示"缺依据"与"评分失败"** —— 不藏问题。分数可信度取决于有没有原文支撑,
//      藏起来等于给出虚假的精确感。
import { useI18n } from "@/i18n";
import { cn } from "@/shared";
import type { AggregateResult } from "@/lib/evaluation/scoringEngine";

export interface LiveCoachState {
  status: "idle" | "evaluating" | "ready" | "failed";
  result?: AggregateResult;
  /** 本次评估是否用了题库参考 */
  bankReferenced?: boolean;
}

export function LiveCoachPanel({ state }: { state: LiveCoachState }) {
  const { t } = useI18n();
  const r = state.result;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ide-fg">
        <span className="text-ide-accent">◆</span>
        {t("liveCoach.title")}
        {state.status === "ready" && r && (
          <span className="ml-auto font-mono text-ide-accent">
            {r.overallScore.toFixed(1)}
            <span className="text-ide-fg-muted">/10</span>
          </span>
        )}
      </div>

      {/* idle / evaluating / failed */}
      {state.status !== "ready" && (
        <div className="rounded border-l-2 border-ide-border bg-ide-bg/40 px-3 py-2 text-[11px] leading-relaxed text-ide-fg-muted">
          {state.status === "evaluating" && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 animate-pulse bg-ide-accent" />
              {t("liveCoach.evaluating")}
            </span>
          )}
          {state.status === "idle" && t("liveCoach.idle")}
          {state.status === "failed" && (
            <>
              <div className="mb-0.5 font-semibold text-ide-warning">{t("liveCoach.failedTitle")}</div>
              {t("liveCoach.unavailable")}
            </>
          )}
        </div>
      )}

      {state.status === "ready" && r && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {/* 基准来源:让用户知道这个分数有没有客观依据 */}
          <div
            className={cn(
              "rounded border-l-2 px-3 py-1.5 text-[10px] leading-relaxed",
              state.bankReferenced
                ? "border-ide-success bg-ide-success/5 text-ide-fg-muted"
                : "border-ide-border bg-ide-bg/40 text-ide-fg-muted"
            )}
          >
            {state.bankReferenced ? t("liveCoach.bankBased") : t("liveCoach.freeBased")}
          </div>

          {/* 弱项优先 */}
          {r.weaknesses.length > 0 && (
            <div className="rounded border-l-2 border-ide-warning bg-ide-warning/5 px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold text-ide-warning">
                {t("liveCoach.weakness")}
              </div>
              <ul className="space-y-1">
                {r.weaknesses.map((d) => (
                  <li key={d.key} className="text-[11px] leading-relaxed text-ide-fg">
                    <span className="font-medium">{d.dimensionName}</span>
                    <span className="ml-1 font-mono text-ide-fg-muted">
                      {d.score}/5 · {t("liveCoach.anchor", { id: d.matchedAnchorId })}
                    </span>
                    {d.evidence.length > 0 && (
                      <div className="mt-0.5 border-l border-ide-border pl-1.5 text-[10px] text-ide-fg-muted">
                        {t("liveCoach.evidence")}:「{d.evidence[0].slice(0, 60)}」
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 全部维度(折叠展示) */}
          <details className="rounded border-l-2 border-ide-border bg-ide-bg/30 px-3 py-2">
            <summary className="cursor-pointer text-[10px] text-ide-fg-muted">
              {t("liveCoach.overall")} · {r.dimensions.length} 维度
            </summary>
            <ul className="mt-1.5 space-y-1">
              {r.dimensions.map((d) => (
                <li key={d.key} className="flex items-baseline gap-1.5 text-[10px]">
                  <span className="w-16 shrink-0 text-ide-fg-muted">{d.dimensionName}</span>
                  <span className="h-1 w-16 shrink-0 bg-ide-border">
                    <span
                      className="block h-1 bg-ide-accent"
                      style={{ width: `${(d.score / 5) * 100}%` }}
                    />
                  </span>
                  <span className="font-mono text-ide-fg">{d.score}/5</span>
                  {d.noEvidence && <span className="text-ide-warning">·</span>}
                </li>
              ))}
            </ul>
          </details>

          {/* 可信度提示:不藏问题 */}
          {(r.noEvidenceCount > 0 || r.missingCount > 0) && (
            <div className="rounded border-l-2 border-ide-border bg-ide-bg/30 px-3 py-1.5 text-[10px] leading-relaxed text-ide-fg-muted">
              {r.noEvidenceCount > 0 && (
                <div>{t("liveCoach.noEvidence", { n: r.noEvidenceCount })}</div>
              )}
              {r.missingCount > 0 && (
                <div>{t("liveCoach.missing", { n: r.missingCount })}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
