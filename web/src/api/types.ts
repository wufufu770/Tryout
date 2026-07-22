// 共享类型:前后端契约
// 与 server/validate.js 中的 schema 保持字段一致
// 后端 schema 是运行时校验,这里是编译时类型,双轨保证

export type ProviderCategory = "official" | "cn_official" | "aggregator" | "local" | "custom";
export type ApiFormat = "openai_chat" | "anthropic";
// 注:前后端 AgentRole/AgentTone 联合类型保持完全一致(见 server/validate.js AgentSchema)
// "custom" 是前端 UI 默认值;"candidate" 是历史后端值;两者均合法,运行时归一化处理
export type AgentRole = "hr" | "tech" | "ceo" | "candidate" | "custom";
// "direct" 是前端 UI 默认值;"professional"/"pragmatic" 是历史后端值;均合法
export type AgentTone = "gentle" | "direct" | "aggressive" | "professional" | "neutral" | "pragmatic";
export type AgentKind = "interviewer" | "candidate";
export type SessionType = "interview" | "group";
export type Difficulty = "easy" | "normal" | "hard" | "extreme" | "hell";
export type MessageRole = "user" | "assistant" | "system";
export type MaterialType = "resume" | "jd" | "reference" | "other" | "text";
export type MaterialSourceType = "file" | "text" | "url";

// 宽松 Market 数据(从社区/JSON 加载,字段不严格)
// 不继承 Agent,字段独立,避免类型冲突
export interface MarketAgent {
  name?: string;
  avatar?: string;
  role?: string;
  tone?: string;
  focusAreas?: string[];
  difficulty?: number;
  promptTemplate?: string;
  agentKind?: string;
  candidatePersona?: string;
  iconType?: string;
  iconValue?: string;
}

export interface Provider {
  providerId: string;
  id: string; // 兼容旧代码别名(运行时与 providerId 相同,前端在 normalize 时填充)
  name: string;
  category: ProviderCategory;
  baseUrl: string;
  apiFormat: ApiFormat;
  modelName?: string;
  icon?: string;
  iconColor?: string;
  notes?: string;
  websiteUrl?: string;
  sortIndex: number;
  isActive?: boolean;
  isDegraded?: boolean;
  inFailoverQueue?: boolean;
  failoverPriority?: number;
  seedVersion?: number;
  hasKey?: boolean; // GET 接口附加字段,不返回真实 apiKey
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentVersion {
  versionId: string;
  agentId: string;
  versionNumber: number;
  name?: string;
  promptTemplate: string;
  createdAt: string;
}

export interface Agent {
  agentId: string;
  name: string;
  avatar?: string;
  role: AgentRole;
  isTemplate?: boolean;
  tone: AgentTone;
  focusAreas: string[];
  difficulty: number;
  promptTemplate?: string;
  iconType?: "emoji" | "preset" | "uploaded";
  iconValue?: string;
  preferredProviderId?: string | null;
  agentKind: AgentKind;
  candidatePersona?: string | null;
  currentVersionId?: string;
  currentVersion?: AgentVersion;
  createdAt?: string;
  updatedAt?: string;
}

export interface Session {
  sessionId: string;
  title: string;
  modelId: string;
  flowTemplate?: string;
  difficulty: Difficulty;
  groupId?: string | null;
  sessionType: SessionType;
  groupConfig?: any;
  status?: string;
  stage?: number;
  tokensTotal?: number;
  costUsd?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Message {
  messageId?: string;
  sessionId?: string;
  role: MessageRole;
  content: string;
  agentId?: string;
  agentVersionId?: string;
  modelVersion?: string;
  tokensIn?: number;
  tokensOut?: number;
  stage?: number;
  isDegraded?: boolean;
  createdAt?: string;
}

export interface EvaluationDimension {
  dimensionName: string;
  score: number;
  weight?: number;
  comment?: string;
}

export interface Evaluation {
  evaluationId?: string;
  sessionId: string;
  overallScore: number;
  report: string;
  improvementAdvice?: string;
  betterAnswerSample?: string;
  dimensions?: EvaluationDimension[];
  generatedAt?: string;
}

export interface Material {
  materialId: string;
  type: MaterialType;
  sourceType: MaterialSourceType;
  rawText: string;
  content: string; // 兼容旧代码别名(=== rawText,前端 normalize 时填充)
  title?: string;
  sourceRef?: string;
  parsedJson?: any;
  addedAt?: string;
}

export interface SessionGroup {
  groupId: string;
  name: string;
  description?: string;
  color: string;
  sortOrder: number;
  createdAt?: string;
}

// ---- 统一响应 envelope(与 server/response.js 对齐) ----
export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiFail {
  ok: false;
  code: string;
  message: string;
  issues?: Array<{ path: string; message: string }>;
}
export type ApiResponse<T> = ApiOk<T> | ApiFail;

// ---- 业务错误 ----
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "AUTH_MISSING"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  issues?: Array<{ path: string; message: string }>;
  // v10.2:后端 ValidationError/SsrfBlockedError 携带的 i18n 信息
  // 前端优先用 t(i18nKey, i18nParams) 渲染,回退到 message
  i18nKey?: string;
  i18nParams?: Record<string, string | number>;
  constructor(
    message: string,
    code: ErrorCode,
    status: number,
    issues?: any,
    i18nKey?: string,
    i18nParams?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.issues = issues;
    this.i18nKey = i18nKey;
    this.i18nParams = i18nParams;
  }
}

// ---- LLM 聊天返回 ----
export interface ChatResult {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  finishReason: string;
  degraded?: boolean;
  degradedFrom?: string;
}

// ---- 弱项分析返回 ----
export interface WeaknessAnalysis {
  hasData: boolean;
  message?: string;
  totalEvaluations?: number;
  dimensionStats?: Array<{ dimensionName: string; avgScore: number; count: number }>;
  weakestDimensions?: Array<{ dimensionName: string; avgScore: number; count: number }>;
  advice?: string;
  recentScores?: Array<{ score: number; date: string; sessionId: string }>;
}
