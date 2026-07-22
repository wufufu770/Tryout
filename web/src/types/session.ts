// v5:会话相关类型定义(难度、阶段-Agent 绑定、整场评价、分组)
import type { CandidatePersona } from "@/types/agent";

// 会话难度档位
export type SessionDifficulty = "easy" | "normal" | "hard" | "extreme" | "hell";

// 阶段内 Agent 角色
export type StageAgentRole = "primary" | "assistant";

// 阶段提问模式
export type StageAskMode = "sequential" | "simultaneous";

// 阶段-Agent 绑定
export interface StageAgentBinding {
  sessionId?: string;
  stageIndex: number;
  agentId: string;
  roleInStage?: StageAgentRole;
  askMode?: StageAskMode;
  sortOrder?: number;
}

// 整场面试回顾评价
export interface SessionReview {
  reviewId?: string;
  sessionId?: string;
  overallScore: number;
  strengths?: string[];
  weaknesses?: string[];
  improvements?: Array<{ area: string; suggestion: string; priority: "high" | "medium" | "low" }>;
  performance?: string;
  nextFocus?: string;
  generatedAt?: string;
}

// 会话分组
export interface SessionGroup {
  groupId: string;
  name: string;
  description?: string;
  color: string;
  sortOrder?: number;
  summary?: string;
  summaryGeneratedAt?: string;
  createdAt?: string;
}

// 会话(含 v5/v6 新字段)
export interface SessionInfo {
  sessionId: string;
  title?: string;
  modelId?: string;
  flowTemplate?: string;
  currentStage?: number;
  difficulty?: SessionDifficulty;
  groupId?: string | null;
  status?: string;
  // v6:会话类型与群面配置
  sessionType?: SessionType;
  groupConfig?: GroupSessionConfig | null;
  createdAt?: string;
  updatedAt?: string;
}

// v6:会话类型
export type SessionType = "interview" | "group";

// v6:群面配置
export interface GroupSessionConfig {
  candidateCount: number;        // AI 候选人数量(不含用户)
  personas: CandidatePersona[];  // 选中的画像(系统按画像挑选/生成 agent)
  candidateAgentIds?: string[];  // 用户自定义的候选人 agent ID 列表(优先于 personas)
  topic: string;                 // 讨论话题/案例文本
  topicType: "preset" | "custom"; // 话题来源
  durationMin: number;           // 模拟时长(分钟)
  accelerated: boolean;          // 是否加速(实际节奏压缩)
  interviewerCount: number;      // 面试官数量(1-2)
  interviewerAgentIds?: string[]; // 用户选定的面试官 agent
}

// v6:候选人画像(与 agent.ts 保持一致,这里重新导出避免循环依赖)
export type { CandidatePersona } from "@/types/agent";
