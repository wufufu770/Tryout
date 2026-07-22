// v6:会议室可视化视图组件
// 展示多 agent 头像作为实体,发言时气泡从头像位置弹出
// 支持点击气泡单独回复,或底部输入统一回复
// 纯 CSS 动画,无新依赖
import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/shared";
import { AgentAvatar } from "@/components/AgentAvatar";
import type { Agent } from "@/types/agent";
import { Send, X, CornerDownLeft, Pin, Volume2 } from "lucide-react";
import { useI18n } from "@/i18n";

export interface MeetingMessage {
  id: string;
  speakerId: string;      // agent.id 或 "user" 或 "interviewer"
  speakerKind: "interviewer" | "candidate" | "user";
  speakerName: string;
  content: string;
  createdAt: number;
  agentRef?: Agent;        // 关联 agent(便于渲染头像)
  replyingToId?: string;   // 回复的某条消息 ID
}

interface Props {
  // 参与者:面试官在上,候选人在下,用户在候选人区
  interviewers: Agent[];
  candidates: Agent[];
  messages: MeetingMessage[];
  activeSpeakerId: string | null;  // 当前发言者(高亮)
  // 用户发言回调
  onUserSend: (content: string, replyToId?: string) => void;
  // 是否禁用输入(流式生成中)
  disabled?: boolean;
  // 当前选中的回复目标(由组件内部管理,通过回调通知父级)
  replyTargetChange?: (msgId: string | null) => void;
  // 视图模式切换回调(由父级提供,组件内只放切换按钮)
  onSwitchToList?: () => void;
  // 标题
  title?: string;
  // 阶段标签
  stageLabel?: string;
}

export function MeetingRoomView({
  interviewers, candidates, messages, activeSpeakerId,
  onUserSend, disabled, onSwitchToList, title, stageLabel,
}: Props) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [replyTarget, setReplyTarget] = useState<MeetingMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 点击气泡:设为回复目标
  const handleBubbleClick = useCallback((msg: MeetingMessage) => {
    if (msg.speakerKind === "user") return; // 不能回复自己
    setReplyTarget(msg);
    inputRef.current?.focus();
  }, []);

  // 取消回复目标
  const cancelReply = () => {
    setReplyTarget(null);
  };

  const handleSend = () => {
    if (!input.trim() || disabled) return;
    onUserSend(input.trim(), replyTarget?.id);
    setInput("");
    setReplyTarget(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  // 所有参与者(用于头像查找)
  const allAgents = [...interviewers, ...candidates];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶栏 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-ide-border bg-ide-bg-alt px-3 text-xs">
        <div className="flex items-center gap-2">
          {title && <span className="truncate text-ide-fg">{title}</span>}
          {stageLabel && (
            <span className="bg-ide-accent/20 px-1.5 py-0.5 text-[10px] text-ide-accent">
              {stageLabel}
            </span>
          )}
        </div>
        {onSwitchToList && (
          <button
            onClick={onSwitchToList}
            className="px-2 py-0.5 text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg"
          >
            {t("meeting.switchToList")}
          </button>
        )}
      </div>

      {/* 会议室场景区 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 面试官区(顶部一排) */}
        <div className="flex shrink-0 flex-wrap items-start justify-center gap-4 border-b border-ide-border bg-ide-bg-alt/50 p-3">
          {interviewers.map((a) => (
            <ParticipantSlot
              key={a.id}
              agent={a}
              isActive={activeSpeakerId === a.id}
              label={t("meeting.interviewer")}
            />
          ))}
          {interviewers.length === 0 && (
            <div className="text-[10px] text-ide-fg-muted">{t("meeting.noInterviewer")}</div>
          )}
        </div>

        {/* 圆桌分隔线 */}
        <div className="flex shrink-0 items-center gap-2 px-3 py-1 text-[9px] text-ide-fg-muted">
          <div className="h-px flex-1 bg-ide-border" />
          <span>{t("meeting.roundTable")}</span>
          <div className="h-px flex-1 bg-ide-border" />
        </div>

        {/* 候选人区(含用户) */}
        <div className="flex shrink-0 flex-wrap items-start justify-center gap-3 border-b border-ide-border p-3">
          {/* 用户头像 */}
          <div className="flex flex-col items-center gap-1">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold",
              activeSpeakerId === "user"
                ? "border-ide-accent bg-ide-accent/20 text-ide-accent pulse-ring"
                : "border-ide-border bg-ide-bg text-ide-fg"
            )}>
              {t("meeting.me")}
            </div>
            <span className="text-[9px] text-ide-fg-muted">{t("meeting.youCandidate")}</span>
          </div>
          {candidates.map((a) => (
            <ParticipantSlot
              key={a.id}
              agent={a}
              isActive={activeSpeakerId === a.id}
              label={t("meeting.candidate")}
            />
          ))}
        </div>

        {/* 消息气泡流(发言历史) */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-ide-fg-muted">
              {t("meeting.waitingForStart")}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.map((msg) => (
                <BubbleMessage
                  key={msg.id}
                  msg={msg}
                  isReplyTarget={replyTarget?.id === msg.id}
                  onClick={() => handleBubbleClick(msg)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 输入区:带 > 提示符 */}
      <div className="shrink-0 border-t border-ide-border bg-ide-bg-alt p-2">
        {/* 回复目标指示条 */}
        {replyTarget && (
          <div className="mb-1 flex items-center gap-2 bg-ide-accent/10 px-2 py-1 text-[10px] text-ide-accent">
            <Pin size={10} />
            <span>{t("meeting.replyTo", { name: replyTarget.speakerName })}</span>
            <span className="ml-1 truncate text-ide-fg-muted">"{replyTarget.content.slice(0, 30)}..."</span>
            <button onClick={cancelReply} className="ml-auto hover:text-ide-fg">
              <X size={11} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <span className="pb-1.5 text-ide-accent">&gt;</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("meeting.inputPlaceholder")}
            rows={2}
            disabled={disabled}
            className="min-h-[2.5rem] flex-1 resize-none border border-ide-border bg-ide-bg px-2 py-1 text-xs text-ide-fg outline-none focus:border-ide-accent disabled:opacity-60"
          />
          <button
            onClick={handleSend}
            disabled={disabled || !input.trim()}
            className="flex h-8 items-center gap-1 bg-ide-accent px-3 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
          >
            <Send size={12} /> {t("meeting.send")}
          </button>
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[9px] text-ide-fg-muted">
          <span>{t("meeting.clickToReplyTip")}</span>
          <span className="flex items-center gap-0.5"><CornerDownLeft size={9} /> Ctrl+Enter</span>
        </div>
      </div>
    </div>
  );
}

// 参与者头像槽位
function ParticipantSlot({ agent, isActive, label }: { agent: Agent; isActive: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn(
        "relative rounded-full transition-all",
        isActive && "pulse-ring"
      )}>
        <div className={cn(
          "rounded-full border-2",
          isActive ? "border-ide-accent" : "border-ide-border"
        )}>
          <AgentAvatar agent={agent} size={40} />
        </div>
        {isActive && (
          <div className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-ide-accent">
            <Volume2 size={7} className="text-ide-accent-fg" />
          </div>
        )}
      </div>
      <span className={cn(
        "max-w-[60px] truncate text-[9px]",
        isActive ? "text-ide-accent" : "text-ide-fg-muted"
      )}>
        {agent.name}
      </span>
      <span className="text-[8px] text-ide-fg-muted">{label}</span>
    </div>
  );
}

// 终端流式气泡消息(左色条 + 无圆角 + 角色前缀)
function BubbleMessage({
  msg, isReplyTarget, onClick,
}: {
  msg: MeetingMessage;
  isReplyTarget: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const isUser = msg.speakerKind === "user";
  const isInterviewer = msg.speakerKind === "interviewer";
  const agent = msg.agentRef;

  return (
    <div className={cn("flex w-full gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="shrink-0">{agent && <AgentAvatar agent={agent} size={20} />}</div>
      )}
      <div
        className={cn(
          "group max-w-[75%] cursor-pointer px-3 py-1.5 text-xs transition-all bubble-pop",
          // 用户气泡改用 .bubble .bubble-user(index.css 已定义 color-mix fallback),
          // 避免不支持 color-mix 的旧浏览器渲染出无背景的透明气泡
          isUser ? "bubble bubble-user text-ide-accent" : "bg-bubble-assistant text-ide-fg",
          isReplyTarget && "ring-1 ring-ide-accent"
        )}
        style={!isUser ? { borderLeft: "2px solid var(--ide-accent)" } : undefined}
        onClick={onClick}
      >
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-ide-fg-muted">
          <span className="text-ide-accent">{isUser ? ">" : "●"}</span>
          <span className="text-ide-fg">{msg.speakerName}</span>
          <span className="text-ide-fg-muted">[{isUser ? t("meeting.you") : isInterviewer ? t("meeting.interviewer") : t("meeting.candidate")}]</span>
          {msg.replyingToId && <span className="text-ide-accent">↩</span>}
        </div>
        <div className={cn("whitespace-pre-wrap", isUser && "text-ide-accent")}>{msg.content}</div>
        <div className="mt-1 flex items-center justify-between opacity-0 group-hover:opacity-60">
          <span className="text-[9px]">{new Date(msg.createdAt).toLocaleTimeString()}</span>
          {!isUser && <span className="flex items-center gap-0.5 text-[9px]"><CornerDownLeft size={8} /> {t("meeting.reply")}</span>}
        </div>
      </div>
    </div>
  );
}
