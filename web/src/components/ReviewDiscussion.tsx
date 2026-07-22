// 方案 5:多 agent 复盘群聊
// 全屏覆盖层:多个 AI 面试官围绕本场面试进行圆桌讨论点评
// 系统发起话题 → 各 Agent 依次发言(流式)→ 用户可加入讨论
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api/client";
import { cn, formatTime } from "@/shared";
import { InfoTip } from "@/components/InfoTip";
import { AgentAvatar } from "@/components/AgentAvatar";
import { MessagesSquare, X, Send, Loader2, AlertCircle } from "lucide-react";
import { useI18n } from "@/i18n";

// 复盘群聊用到的消息(来自面试会话)
interface ReviewMessage {
  role: "system" | "user" | "assistant";
  content: string;
  agentName?: string;
  agentRole?: string;
  agentId?: string;
}

// 复盘群聊用到的评价信息(只覆盖本组件实际访问的字段)
interface ReviewEvaluation {
  overallScore?: number;
  report?: string;
  improvementAdvice?: string;
}

// 复盘群聊用到的 Agent(覆盖 runAgentRound/buildAgentPrompt 实际访问的字段)
interface ReviewAgentConfig {
  tone?: string;
  focusAreas?: string[];
  promptTemplate?: string;
}

interface ReviewAgent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  iconType?: "emoji" | "preset" | "uploaded";
  iconValue?: string;
  config?: ReviewAgentConfig;
}

interface ReviewDiscussionProps {
  sessionId: string;
  messages: ReviewMessage[];
  evaluation: ReviewEvaluation | null;
  agents: ReviewAgent[];
  onClose: () => void;
}

interface DiscussionMessage {
  id: string;
  speaker: "system" | "user" | "agent";
  speakerName: string;
  agentId?: string;
  agentRef?: ReviewAgent;
  content: string;
  createdAt: number;
  streaming?: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  hr: "HR",
  tech: "技术官",
  ceo: "CEO",
  custom: "面试官",
};

const TONE_LABEL: Record<string, string> = {
  gentle: "温和",
  direct: "直接",
  aggressive: "犀利",
  neutral: "中立",
};

// 提取关键问答对(assistant 提问 + 紧随的 user 回答),取前 N 个
function extractQAPairs(messages: ReviewMessage[], limit = 3): { question: string; answer: string }[] {
  const pairs: { question: string; answer: string }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "assistant") {
      const next = messages[i + 1];
      if (next && next.role === "user") {
        pairs.push({ question: m.content || "", answer: next.content || "" });
      }
    }
    if (pairs.length >= limit) break;
  }
  return pairs;
}

// 构建本场面试摘要文本(用于注入 prompt)
function buildSessionSummary(messages: ReviewMessage[], evaluation: ReviewEvaluation | null): string {
  const lines: string[] = [];
  lines.push(`【本场面试摘要】`);
  lines.push(`消息总数:${messages.length}`);
  if (evaluation) {
    lines.push(`综合评分:${evaluation.overallScore ?? "未评估"}`);
    if (evaluation.report) {
      lines.push(`评估报告摘要:${(evaluation.report as string).slice(0, 300)}`);
    }
    if (evaluation.improvementAdvice) {
      lines.push(`改进建议摘要:${(evaluation.improvementAdvice as string).slice(0, 200)}`);
    }
  } else {
    lines.push(`评估:暂无评估报告`);
  }

  const pairs = extractQAPairs(messages, 3);
  if (pairs.length > 0) {
    lines.push(`\n【关键问答 Top${pairs.length}】`);
    pairs.forEach((p, i) => {
      lines.push(`Q${i + 1}: ${p.question.slice(0, 200)}`);
      lines.push(`A${i + 1}: ${p.answer.slice(0, 200)}`);
    });
  }

  return lines.join("\n");
}

// 构建单个 Agent 的发言 prompt
function buildAgentPrompt(agent: ReviewAgent, summary: string, recentAgentMsgs: DiscussionMessage[]): string {
  const role = agent.role || "custom";
  const roleLabel = ROLE_LABEL[role] || "面试官";
  const focus = agent.config?.focusAreas?.length
    ? agent.config.focusAreas.join("、")
    : "综合能力";
  const tone = agent.config?.tone || "neutral";
  const toneLabel = TONE_LABEL[tone] || "中立";
  const tmpl = agent.config?.promptTemplate || "通用面试官";

  let prompt = `你正在参与一场面试复盘群聊,你的角色是「${agent.name}」(${roleLabel})。
你关注的领域:${focus}。
你的语气风格:${toneLabel}。
你的角色设定:${tmpl}

${summary}

请基于上述本场面试情况,以你的角色视角进行复盘点评。要求:
1. 用 100-200 字简短发言,直接给出你的观察与建议
2. 站在你的角色立场,突出你关注的维度
3. 不要重复其他面试官已说过的观点,要有差异化
4. 用第一人称,直接输出点评内容,不要前后缀,不要使用 markdown 标题`;

  // 注入最近其他面试官的发言,提示不要重复
  if (recentAgentMsgs.length > 0) {
    prompt += `\n\n【其他面试官最近发言,请勿重复其观点】`;
    recentAgentMsgs.forEach((m) => {
      prompt += `\n${m.speakerName}: ${m.content.slice(0, 200)}`;
    });
  }

  return prompt;
}

export function ReviewDiscussion({
  sessionId,
  messages,
  evaluation,
  agents,
  onClose,
}: ReviewDiscussionProps) {
  const [discussion, setDiscussion] = useState<DiscussionMessage[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [providerChecked, setProviderChecked] = useState(false);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const historyRef = useRef<DiscussionMessage[]>([]);
  // 卸载标志:组件卸载后置 true,中断后续流式回调与 setState,避免内存泄漏与 React 警告
  const cancelledRef = useRef(false);

  const { t } = useI18n();
  // 角色显示标签(用于左侧参与面试官列表的 role 显示;模块级的 ROLE_LABEL 仅用于 prompt 构建)
  const roleDisplayLabel: Record<string, string> = {
    hr: t("reviewDiscussion.role.hr"),
    tech: t("reviewDiscussion.role.tech"),
    ceo: t("reviewDiscussion.role.ceo"),
    custom: t("reviewDiscussion.role.custom"),
  };

  const summaryText = useMemo(() => buildSessionSummary(messages, evaluation), [messages, evaluation]);
  const topQAPairs = useMemo(() => extractQAPairs(messages, 3), [messages]);

  // 同步 historyRef 到 discussion
  const syncHistory = useCallback((updater: (prev: DiscussionMessage[]) => DiscussionMessage[]) => {
    setDiscussion((prev) => {
      const next = updater(prev);
      historyRef.current = next;
      return next;
    });
  }, []);

  // 检查 provider(无 provider 时无法生成讨论)
  useEffect(() => {
    let cancelled = false;
    api
      .listProviders()
      .then((list: any[]) => {
        if (cancelled) return;
        const arr = list || [];
        const active = arr.find((p) => p.isActive) || arr[0];
        setProviderId(active?.id || null);
      })
      .catch(() => {
        if (!cancelled) setProviderId(null);
      })
      .finally(() => {
        if (!cancelled) setProviderChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [discussion]);

  // 卸载时标记取消,中断后续流式回调与 setState
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Esc 关闭覆盖层(running 时禁用,避免中断发言)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onClose]);

  // 发起一轮 agent 发言(history 为已存在的消息列表)
  const runAgentRound = useCallback(
    async (history: DiscussionMessage[], userMessage?: string) => {
      if (!providerId || agents.length === 0) return;
      setRunning(true);
      setError(null);
      let localHistory = history;
      try {
        for (const agent of agents) {
          if (cancelledRef.current) return;
          const recent = localHistory.filter((m) => m.speaker === "agent").slice(-3);
          const prompt = userMessage
            ? `用户在复盘群聊中说:「${userMessage}」\n\n${summaryText}\n\n${buildAgentPrompt(agent, summaryText, recent)}`
            : buildAgentPrompt(agent, summaryText, recent);

          const msgId = `agent-${Date.now()}-${agent.id}-${Math.random().toString(36).slice(2, 6)}`;
          const newMsg: DiscussionMessage = {
            id: msgId,
            speaker: "agent",
            speakerName: agent.name || t("interview.interviewer"),
            agentId: agent.id,
            agentRef: agent,
            content: "",
            createdAt: Date.now(),
            streaming: true,
          };
          syncHistory((prev) => [...prev, newMsg]);
          localHistory = [...localHistory, newMsg];

          let acc = "";
          try {
            const result = (await api.chat(
              providerId,
              { messages: [{ role: "user", content: prompt }] },
              (t: string) => {
                // 卸载后不再更新流式内容
                if (cancelledRef.current) return;
                acc += t;
                setDiscussion((prev) =>
                  prev.map((m) => (m.id === msgId ? { ...m, content: acc } : m))
                );
              }
            )) as any;
            // await 点之后、setState 之前检查卸载标志
            if (cancelledRef.current) return;
            const text = result?.content || acc;
            const finalMsg = { ...newMsg, content: text, streaming: false };
            syncHistory((prev) => prev.map((m) => (m.id === msgId ? finalMsg : m)));
            localHistory = localHistory.map((m) => (m.id === msgId ? finalMsg : m));
          } catch (e: any) {
            // await 点之后、setState 之前检查卸载标志
            if (cancelledRef.current) return;
            const errText = t("reviewDiscussion.errors.agentFailedInline", {
              name: agent.name,
              msg: e.message || t("reviewDiscussion.errors.unknown"),
            });
            const finalMsg = { ...newMsg, content: errText, streaming: false };
            syncHistory((prev) => prev.map((m) => (m.id === msgId ? finalMsg : m)));
            localHistory = localHistory.map((m) => (m.id === msgId ? finalMsg : m));
            setError(t("reviewDiscussion.errors.agentFailed", { msg: e.message }));
          }
        }
      } finally {
        // 仅在未卸载时恢复 running 状态
        if (!cancelledRef.current) setRunning(false);
      }
    },
    [providerId, agents, summaryText, syncHistory, t]
  );

  // 启动讨论:加入 system 消息 + 触发首轮 agent 发言
  useEffect(() => {
    if (startedRef.current) return;
    if (!providerChecked) return;
    if (!providerId) return;
    if (agents.length === 0) return; // 0 Agent 时不启动讨论
    startedRef.current = true;

    const sysMsg: DiscussionMessage = {
      id: `sys-${Date.now()}`,
      speaker: "system",
      speakerName: t("group.system"),
      content: t("reviewDiscussion.systemPrompt"),
      createdAt: Date.now(),
    };
    syncHistory(() => [sysMsg]);
    runAgentRound([sysMsg]);
  }, [providerChecked, providerId, runAgentRound, syncHistory, t]);

  const handleSendUser = async () => {
    const text = input.trim();
    if (!text || running || !providerId) return;
    const userMsg: DiscussionMessage = {
      id: `user-${Date.now()}`,
      speaker: "user",
      speakerName: t("history.roleUser"),
      content: text,
      createdAt: Date.now(),
    };
    syncHistory((prev) => [...prev, userMsg]);
    setInput("");
    await runAgentRound([...historyRef.current, userMsg], text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      handleSendUser();
    }
  };

  const noProvider = providerChecked && !providerId;

  // 0 Agent 防御性空状态:不进入群聊流程,显式提示用户并允许关闭
  if (agents.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ide-bg p-6">
        <div className="flex max-w-md flex-col items-center gap-3 border border-ide-border bg-ide-bg-alt p-6 text-center text-xs">
          <AlertCircle size={24} className="text-ide-warning" />
          <div className="font-semibold text-ide-fg">{t("reviewDiscussion.noInterviewer")}</div>
          <div className="text-ide-fg-muted">
            {t("reviewDiscussion.createAgentHint")}
          </div>
          <button
            onClick={onClose}
            className="mt-2 flex h-7 items-center gap-1 border border-ide-border bg-ide-bg px-3 text-ide-fg hover:bg-ide-bg-active"
          >
            <X size={12} />
            {t("common.close")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ide-bg">
      {/* 顶部标题栏 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-ide-border bg-ide-bg-alt px-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-ide-fg">
          <MessagesSquare size={14} className="text-ide-accent" />
          {t("reviewDiscussion.title")}
          <InfoTip text={t("reviewDiscussion.tip")} />
          <span className="text-ide-fg-muted">{t("reviewDiscussion.interviewerCount", { n: agents.length })}</span>
          {running && (
            <span className="flex items-center gap-1 bg-ide-accent/15 px-1.5 py-0.5 text-[10px] text-ide-accent">
              <Loader2 size={9} className="animate-spin" />
              {t("reviewDiscussion.speaking")}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg"
          title={t("common.close")}
        >
          <X size={14} />
        </button>
      </div>

      {/* 主体:左右分栏 */}
      <div className="flex min-h-0 flex-1">
        {/* 左侧:本场摘要 */}
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-ide-border bg-ide-bg-alt p-3 text-xs">
          <div className="mb-2 flex items-center gap-1.5 font-semibold uppercase text-ide-fg-muted">
            <MessagesSquare size={12} />
            {t("reviewDiscussion.sessionSummary")}
          </div>

          <div className="mb-3 flex flex-col gap-1.5">
            <div className="flex justify-between">
              <span className="text-ide-fg-muted">{t("reviewDiscussion.messageCount")}</span>
              <span className="font-mono text-ide-fg">{messages.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ide-fg-muted">{t("reviewDiscussion.overallScore")}</span>
              <span className="font-mono text-ide-accent">
                {evaluation?.overallScore ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-ide-fg-muted">{t("reviewDiscussion.participatingInterviewers")}</span>
              <span className="font-mono text-ide-fg">{agents.length}</span>
            </div>
          </div>

          <div className="mb-3 border-t border-ide-border pt-2">
            <div className="mb-1.5 text-ide-fg-muted">{t("reviewDiscussion.participatingInterviewers")}</div>
            <div className="flex flex-col gap-1.5">
              {agents.length === 0 ? (
                <div className="text-ide-fg-muted">{t("reviewDiscussion.noInterviewerAvailable")}</div>
              ) : (
                agents.map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <AgentAvatar agent={a} size={18} />
                    <span className="truncate text-ide-fg">{a.name}</span>
                    <span className="ml-auto text-[10px] text-ide-fg-muted">
                      {roleDisplayLabel[a.role] || a.role}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border-t border-ide-border pt-2">
            <div className="mb-1.5 text-ide-fg-muted">{t("reviewDiscussion.topQA", { n: topQAPairs.length })}</div>
            <div className="flex flex-col gap-2">
              {topQAPairs.length === 0 ? (
                <div className="text-ide-fg-muted">{t("reviewDiscussion.noQAPairs")}</div>
              ) : (
                topQAPairs.map((p, i) => (
                  <div key={i} className="border border-ide-border bg-ide-bg p-2 text-[11px]">
                    <div className="mb-1 text-ide-accent">
                      Q{i + 1}: {p.question.slice(0, 80)}
                      {p.question.length > 80 ? "..." : ""}
                    </div>
                    <div className="text-ide-fg">
                      A{i + 1}: {p.answer.slice(0, 80)}
                      {p.answer.length > 80 ? "..." : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* 右侧:群聊消息流 + 底部输入 */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {noProvider ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="flex max-w-md flex-col items-center gap-2 border border-ide-border bg-ide-bg-alt p-4 text-center text-xs">
                <AlertCircle size={20} className="text-ide-warning" />
                <div className="font-semibold text-ide-fg">{t("reviewDiscussion.noProviderTitle")}</div>
                <div className="text-ide-fg-muted">
                  {t("reviewDiscussion.noProviderHint")}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="flex flex-col gap-2">
                  {discussion.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "flex w-full",
                        m.speaker === "user"
                          ? "justify-end"
                          : m.speaker === "system"
                          ? "justify-center"
                          : "justify-start"
                      )}
                    >
                      {m.speaker === "system" ? (
                        <div className="bubble bubble-system max-w-[80%]">
                          {m.content}
                        </div>
                      ) : m.speaker === "user" ? (
                        <div className="bubble bubble-user max-w-[80%]">
                          <div className="mb-1 text-[10px] opacity-60">
                            {t("history.roleUser")} · {formatTime(new Date(m.createdAt).toISOString())}
                          </div>
                          {m.content}
                        </div>
                      ) : (
                        <div className="flex max-w-[88%] items-start gap-2">
                          {m.agentRef && (
                            <div className="mt-0.5 shrink-0">
                              <AgentAvatar agent={m.agentRef} size={20} />
                            </div>
                          )}
                          <div className="bubble bubble-assistant">
                            <div className="mb-1 flex items-center gap-1.5 text-[10px] opacity-60">
                              <span className="font-semibold text-ide-fg">{m.speakerName}</span>
                              <span>· {formatTime(new Date(m.createdAt).toISOString())}</span>
                              {m.streaming && (
                                <span className="flex items-center gap-1 text-ide-accent">
                                  <Loader2 size={9} className="animate-spin" />
                                  {t("reviewDiscussion.generating")}
                                </span>
                              )}
                            </div>
                            {m.content || (m.streaming ? "..." : "")}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {running &&
                    discussion.length > 0 &&
                    discussion[discussion.length - 1].speaker !== "agent" &&
                    discussion[discussion.length - 1].speaker !== "system" && (
                      <div className="flex items-center gap-2 px-2 text-xs text-ide-fg-muted">
                        <Loader2 size={12} className="animate-spin" />
                        {t("reviewDiscussion.thinking")}
                      </div>
                    )}
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex shrink-0 items-center gap-2 border-t border-ide-danger/30 bg-ide-danger/10 px-3 py-1.5 text-xs text-ide-danger"
                >
                  <AlertCircle size={12} />
                  <span className="flex-1">{error}</span>
                  <button onClick={() => setError(null)} className="hover:underline">
                    {t("common.close")}
                  </button>
                </div>
              )}

              {/* 底部输入 */}
              <div className="shrink-0 border-t border-ide-border bg-ide-bg-alt p-2">
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={running ? t("reviewDiscussion.inputPlaceholderRunning") : t("reviewDiscussion.inputPlaceholderIdle")}
                    disabled={running || !providerId}
                    rows={2}
                    className="min-h-[36px] flex-1 resize-none border border-ide-border bg-ide-bg px-2 py-1.5 text-xs text-ide-fg placeholder:text-ide-fg-muted focus:border-ide-accent focus:outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={handleSendUser}
                    disabled={running || !input.trim() || !providerId}
                    className="flex h-9 items-center gap-1 bg-ide-accent px-3 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
                  >
                    <Send size={12} />
                    {t("interview.send")}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
