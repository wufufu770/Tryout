// 注:与 api/types.ts 中 AgentRole/AgentTone 保持完全一致(前后端联合类型统一)
// "candidate"/"professional"/"pragmatic" 是历史后端值,前端 normalizeAgent 时会保留
export type AgentRole = "hr" | "tech" | "ceo" | "custom" | "candidate";
export type AgentTone = "gentle" | "direct" | "aggressive" | "neutral" | "professional" | "pragmatic";
export type AgentIconType = "emoji" | "preset" | "uploaded";
// v6:Agent 种类 - interviewer(面试官) / candidate(AI 候选人)
export type AgentKind = "interviewer" | "candidate";
// v6:候选人画像(仅 candidate 用)
export type CandidatePersona =
  | "aggressive"   // 激进抢话型
  | "calm"         // 沉稳思考型
  | "leader"       // 自然领导型
  | "follower"     // 跟随附和型
  | "challenger"   // 搅局挑战型
  | "data_driven"; // 数据控型

export interface AgentConfig {
  tone: AgentTone;
  focusAreas: string[];
  difficulty: number; // 1-10
  promptTemplate: string;
}

export interface Agent {
  id: string;
  name: string;
  avatar: string;
  role: AgentRole;
  isTemplate?: boolean;
  config: AgentConfig;
  currentVersionId?: string;
  createdAt?: string;
  // v5:头像与默认模型
  iconType?: AgentIconType;
  iconValue?: string;
  preferredProviderId?: string | null;
  // v6:Agent 种类与候选人画像
  agentKind?: AgentKind;
  candidatePersona?: CandidatePersona | null;
}

// 从后端 API 响应转换为 Agent(后端用 camelCase 嵌套 currentVersion)
export function normalizeAgent(raw: any): Agent {
  const cv = raw.currentVersion || {};
  return {
    id: raw.agentId || raw.id,
    name: raw.name,
    avatar: raw.avatar || "🤖",
    role: (raw.role || "custom") as AgentRole,
    isTemplate: raw.isTemplate,
    currentVersionId: raw.currentVersionId,
    config: {
      tone: (cv.tone || "neutral") as AgentTone,
      focusAreas: cv.focusAreas || [],
      difficulty: cv.difficulty || 5,
      promptTemplate: cv.promptTemplate || "",
    },
    createdAt: raw.createdAt,
    iconType: (raw.iconType || "emoji") as AgentIconType,
    iconValue: raw.iconValue || raw.avatar || undefined,
    preferredProviderId: raw.preferredProviderId ?? null,
    agentKind: (raw.agentKind || "interviewer") as AgentKind,
    candidatePersona: (raw.candidatePersona ?? null) as CandidatePersona | null,
  };
}
