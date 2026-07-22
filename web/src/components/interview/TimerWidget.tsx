// InterviewPage 子组件:思考计时器
// 抽出 C8 计时器 UI 和逻辑(自动启停 + tick),职责单一,便于单独测试与复用
import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { cn } from "@/shared";
import { useI18n } from "@/i18n";
import type { Message } from "@/components/interview/MessageBubble";

const TIMER_DEFAULT = 60; // 默认 60 秒

export function TimerWidget({ messages }: { messages: Message[] }) {
  const { t } = useI18n();
  const [timerRemaining, setTimerRemaining] = useState(TIMER_DEFAULT);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerExpired, setTimerExpired] = useState(false);
  const lastAssistantMsgIdRef = useRef<string | null>(null);

  // C8:思考计时器 - 监听 messages 变化,自动启停
  // 规则:最后一条是 assistant(面试官提问)→ 启动倒计时;最后一条是 user(用户回答)→ 停止
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1] as Message;
    const msgId = last.messageId || last.id || `content-${last.content.slice(0, 32)}`;
    if (last.role === "assistant") {
      // 新面试官消息:启动计时器(避免对同一条消息重复启动)
      if (lastAssistantMsgIdRef.current !== msgId) {
        lastAssistantMsgIdRef.current = msgId;
        setTimerRemaining(TIMER_DEFAULT);
        setTimerRunning(true);
        setTimerExpired(false);
      }
    } else if (last.role === "user") {
      // 用户回答:停止计时器
      setTimerRunning(false);
    }
  }, [messages]);

  // C8:计时器 tick - 每秒减少 remaining,到 0 标记 expired
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      setTimerRemaining((r) => {
        if (r <= 1) {
          setTimerRunning(false);
          setTimerExpired(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  // 仅在有面试官提问(计时器已启动或已过期)时显示
  if (!timerRunning && !timerExpired) return null;

  return (
    <div className="shrink-0 border-t border-ide-border bg-ide-bg-alt px-3 py-1">
      <div className="flex items-center gap-3 text-xs">
        <Timer
          size={12}
          className={cn(
            timerExpired ? "text-ide-danger" : timerRemaining <= 10 ? "text-ide-warning" : "text-ide-accent"
          )}
        />
        <span className="text-ide-fg-muted">{t("timer.title")}</span>
        <span
          className={cn(
            "font-mono text-sm font-bold",
            timerExpired ? "text-ide-danger" : timerRemaining <= 10 ? "text-ide-warning" : "text-ide-fg"
          )}
        >
          {timerExpired ? t("timer.expired") : `${t("timer.remaining")} ${timerRemaining}s`}
        </span>
        {timerExpired && (
          <span className="text-[10px] text-ide-danger">{t("timer.expiredHint")}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!timerRunning && !timerExpired && (
            <button
              onClick={() => setTimerRunning(true)}
              className="px-1.5 py-0.5 text-[10px] text-ide-accent hover:bg-ide-accent/10"
            >
              {t("timer.resume")}
            </button>
          )}
          {timerRunning && (
            <button
              onClick={() => setTimerRunning(false)}
              className="px-1.5 py-0.5 text-[10px] text-ide-fg-muted hover:bg-ide-bg-active"
            >
              {t("timer.pause")}
            </button>
          )}
          <button
            onClick={() => {
              setTimerRemaining(TIMER_DEFAULT);
              setTimerRunning(false);
              setTimerExpired(false);
            }}
            className="px-1.5 py-0.5 text-[10px] text-ide-fg-muted hover:bg-ide-bg-active"
          >
            {t("timer.reset")}
          </button>
        </div>
      </div>
    </div>
  );
}
