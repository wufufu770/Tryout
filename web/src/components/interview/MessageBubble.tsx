// InterviewPage 子组件:消息气泡 + Agent 切换分隔线
// 从 InterviewPage.tsx 抽取,职责单一,便于单独测试与复用
import { AgentAvatar } from "@/components/AgentAvatar";
import type { Agent } from "@/types/agent";
import { makeRestorer, type PiiMapping } from "@/lib/piiPlaceholder";
import { stripStageMarkers } from "@/lib/evaluation/stageAdvance";

// 面试会话内的消息结构(与后端 message 表对齐,额外携带多 Agent 组合字段)
export interface Message {
  id?: string;
  messageId?: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt?: string;
  agentId?: string;
  agentName?: string;
  agentRole?: string;
  isMultiAgentGroup?: boolean; // 同时提问模式:组合消息标记
  groupItems?: Array<{ agentId: string; agentName: string; agentRole: string; content: string }>;
  /**
   * v11.3 本条消息对应的 PII 占位符 → 明文 映射(仅内存,不落库)。
   * AI 复述用户简历里的敏感信息时,界面还原为明文而非 [PHONE_xxxxxxxx]。
   */
  piiMapping?: PiiMapping[];
}

// 角色徽章
export const ROLE_LABELS: Record<string, string> = {
  hr: "HR", tech: "技术", ceo: "CEO", custom: "自定义",
};

export function MessageBubble({ message, agents }: { message: Message; agents: Agent[] }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  // v11.3:还原 PII 占位符。映射随消息传入、不落库;无映射时为恒等函数。
  const restorePii = makeRestorer(message.piiMapping || []);

  // 同时提问组合消息(多个角色行 + 内容)
  if (message.isMultiAgentGroup && message.groupItems) {
    return (
      <div className="flex w-full justify-start">
        <div className="flex w-full max-w-[88%] flex-col gap-px">
          {message.groupItems.map((item, i) => {
            const agent = agents.find((a) => a.id === item.agentId);
            return (
              <div key={i} className="flex items-start gap-2 border-l-2 border-ide-accent bg-bubble-assistant px-3 py-1.5">
                {agent && <AgentAvatar agent={agent} size={18} />}
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-ide-fg-muted">
                    <span className="text-ide-accent">●</span>
                    <span className="text-ide-fg">{item.agentName}</span>
                    {item.agentRole && <span className="text-ide-fg-muted">[{ROLE_LABELS[item.agentRole] || item.agentRole}]</span>}
                  </div>
                  <div className="text-ide-fg">{item.content}</div>
                </div>
              </div>
            );
          })}
          <div className="px-3 py-0.5 text-[10px] text-ide-warning">
            ▸ 请综合回答以上 {message.groupItems.length} 位面试官的问题
          </div>
        </div>
      </div>
    );
  }

  // AI 消息(● 角色行 + 内容 + 左色条)
  if (!isUser && !isSystem) {
    const agent = agents.find((a) => a.id === message.agentId);
    return (
      <div className="flex w-full justify-start">
        <div className="flex w-full max-w-[88%] items-start gap-2 border-l-2 border-ide-accent bg-bubble-assistant px-3 py-1.5">
          {agent && <AgentAvatar agent={agent} size={18} />}
          <div className="flex-1">
            <div className="flex items-center gap-1.5 text-[10px] text-ide-fg-muted">
              <span className="text-ide-accent">●</span>
              <span className="text-ide-fg">{message.agentName || agent?.name}</span>
              {message.agentRole && <span className="text-ide-fg-muted">[{ROLE_LABELS[message.agentRole] || message.agentRole}]</span>}
            </div>
            <div className="text-ide-fg">{restorePii(stripStageMarkers(message.content))}</div>
          </div>
        </div>
      </div>
    );
  }

  // 用户消息(> 前缀 + 强调色 + 淡背景)
  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[88%] border-l-2 border-ide-accent px-3 py-1.5" style={{ background: "color-mix(in srgb, var(--ide-accent) 8%, transparent)" }}>
          <div className="flex items-center gap-1.5 text-[10px] text-ide-fg-muted">
            <span className="text-ide-accent">&gt;</span>
            <span className="text-ide-accent">you</span>
          </div>
          <div className="text-ide-accent">{message.content}</div>
        </div>
      </div>
    );
  }

  // 系统消息(# 前缀 + 灰色斜体)
  return (
    <div className="flex w-full justify-start">
      <div className="max-w-[88%] border-l-2 border-ide-border px-3 py-1.5 text-ide-fg-muted italic text-xs">
        <span className="text-ide-fg-muted"># </span>
        {message.content}
      </div>
    </div>
  );
}

// Agent 切换分隔线
export function AgentSwitchDivider({ agent }: { agent: Agent }) {
  return (
    <div className="my-1 flex items-center gap-2 text-[10px] text-ide-fg-muted">
      <div className="h-px flex-1 bg-ide-border" />
      <span className="text-ide-accent">▸</span>
      <span>{agent.name}[{ROLE_LABELS[agent.role] || agent.role}] 接管</span>
      <div className="h-px flex-1 bg-ide-border" />
    </div>
  );
}
