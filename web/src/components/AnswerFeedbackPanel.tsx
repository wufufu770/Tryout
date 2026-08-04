// 逐题反馈面板(语音答题闭环的反馈层)
// 展示本会话的逐题评估卡片:题目 / 回答 / 评分 / 短板标签 / 改进建议 / 更好的回答
// 提供:对上一轮对话评分、标记错题、删除
// 数据源:question_feedback 表,每 8s 轮询(面试进行中自动同步)
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { useI18n } from "@/i18n";
import { cn } from "@/shared";
import { Loader2, Sparkles, ChevronDown, ChevronRight, X, Bookmark, RefreshCw } from "lucide-react";

export interface AnswerFeedback {
  feedbackId: string;
  sessionId: string;
  question: string;
  answer: string;
  score: number | null;
  weaknessTags: string[];
  improvement: string | null;
  betterAnswer: string | null;
  isMissed: boolean;
  createdAt: string;
}

interface AnswerFeedbackPanelProps {
  sessionId: string | null;
  /** 最近一轮问答(评分用):[问题, 回答] */
  lastExchange: { question: string; answer: string } | null;
  provider: string;
}

export function AnswerFeedbackPanel({ sessionId, lastExchange, provider }: AnswerFeedbackPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<AnswerFeedback[]>([]);
  const [loading, setLoading] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const list = (await api.listAnswers(sessionId)) || [];
      setItems(list);
    } catch { /* 轮询失败静默,下轮重试 */ }
  }, [sessionId]);

  // 会话变化时加载 + 8s 轮询
  useEffect(() => {
    setItems([]);
    setScoreError(null);
    if (!sessionId) return;
    load();
    timerRef.current = window.setInterval(load, 8000);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [sessionId, load]);

  // 对最近一轮问答评分(LLM 单题评估)
  const handleScore = useCallback(async () => {
    if (!sessionId || !lastExchange || !provider || scoring) return;
    setScoring(true);
    setScoreError(null);
    try {
      const result = await api.scoreAnswer(sessionId, {
        provider,
        question: lastExchange.question,
        answer: lastExchange.answer,
      });
      if (result?.ok === false) {
        setScoreError(result.error || t("voice.scoreFailed"));
      } else {
        setExpanded(true);
        await load();
      }
    } catch (e: any) {
      setScoreError(e?.message || t("voice.scoreFailed"));
    } finally {
      setScoring(false);
    }
  }, [sessionId, lastExchange, provider, scoring, load, t]);

  const handleToggleMissed = useCallback(async (fb: AnswerFeedback) => {
    try {
      await api.markAnswerMissed(fb.feedbackId, !fb.isMissed);
      setItems((prev) => prev.map((x) => (x.feedbackId === fb.feedbackId ? { ...x, isMissed: !x.isMissed } : x)));
    } catch { /* ignore */ }
  }, []);

  const handleDelete = useCallback(async (fb: AnswerFeedback) => {
    try {
      await api.deleteAnswer(fb.feedbackId);
      setItems((prev) => prev.filter((x) => x.feedbackId !== fb.feedbackId));
    } catch { /* ignore */ }
  }, []);

  const count = items.length;

  return (
    <div className="shrink-0 border-t border-ide-border bg-ide-bg-alt">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ide-fg-muted hover:bg-ide-bg-active"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Sparkles size={12} className="text-ide-accent" />
        <span className="text-ide-fg">{t("voice.feedbackTitle")}</span>
        {count > 0 && <span className="rounded bg-ide-accent/10 px-1 text-[10px] text-ide-accent">{count}</span>}
        {lastExchange && (
          <button
            onClick={(e) => { e.stopPropagation(); handleScore(); }}
            disabled={scoring || !provider}
            className="ml-auto flex items-center gap-1 border border-ide-accent/40 bg-ide-accent/10 px-2 py-0.5 text-[10px] text-ide-accent hover:bg-ide-accent/20 disabled:opacity-50"
            title={t("voice.scoreTip")}
          >
            {scoring ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            {t("voice.scoreLastAnswer")}
          </button>
        )}
      </button>

      {expanded && (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto px-3 pb-2">
          {scoreError && (
            <div className="border border-ide-danger/40 bg-ide-danger/10 px-2 py-1 text-[11px] text-ide-danger">
              {scoreError}
            </div>
          )}
          {loading && items.length === 0 && (
            <div className="flex items-center gap-1 py-2 text-[11px] text-ide-fg-muted">
              <RefreshCw size={10} className="animate-spin" /> {t("voice.loading")}
            </div>
          )}
          {items.length === 0 && !loading && (
            <div className="py-2 text-[11px] text-ide-fg-muted">{t("voice.feedbackEmpty")}</div>
          )}
          {items.map((fb) => (
            <div key={fb.feedbackId} className={cn("border border-ide-border bg-ide-bg p-2", fb.isMissed && "border-ide-warning/50")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-ide-fg">{fb.question}</div>
                  <div className="mt-0.5 line-clamp-2 text-[10px] text-ide-fg-muted">{fb.answer}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {fb.score !== null && (
                    <span className={cn("text-sm font-bold",
                      fb.score >= 8 ? "text-ide-accent" : fb.score >= 5 ? "text-ide-warning" : "text-ide-danger")}>
                      {fb.score.toFixed(1)}
                    </span>
                  )}
                  <button
                    onClick={() => handleToggleMissed(fb)}
                    title={t("voice.markMissed")}
                    className={cn("p-1", fb.isMissed ? "text-ide-warning" : "text-ide-fg-muted hover:text-ide-warning")}
                  >
                    <Bookmark size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(fb)}
                    title={t("common.delete")}
                    className="p-1 text-ide-fg-muted hover:text-ide-danger"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              {fb.weaknessTags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {fb.weaknessTags.map((tag, i) => (
                    <span key={i} className="bg-ide-danger/10 px-1 text-[9px] text-ide-danger">{tag}</span>
                  ))}
                </div>
              )}
              {fb.improvement && (
                <details className="mt-1 text-[10px] text-ide-fg-muted">
                  <summary className="cursor-pointer text-ide-accent">{t("voice.improvement")}</summary>
                  <p className="mt-0.5 whitespace-pre-wrap">{fb.improvement}</p>
                  {fb.betterAnswer && (
                    <>
                      <div className="mt-1 text-ide-accent">{t("voice.betterAnswer")}</div>
                      <p className="whitespace-pre-wrap border-l-2 border-ide-accent/40 pl-2">{fb.betterAnswer}</p>
                    </>
                  )}
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
