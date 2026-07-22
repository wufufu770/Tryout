import type { Agent } from "@/types/agent";

// 导入字段白名单:与 community.ts 的 normalizeAgent 保持一致,防止注入任意 role/tone 字符串
const VALID_ROLES = new Set(["hr", "tech", "ceo", "custom"]);
const VALID_TONES = new Set(["gentle", "direct", "aggressive", "neutral", "professional"]);
function sanitizeRole(v: unknown): string {
  return typeof v === "string" && VALID_ROLES.has(v) ? v : "custom";
}
function sanitizeTone(v: unknown): string {
  return typeof v === "string" && VALID_TONES.has(v) ? v : "gentle";
}

// 旧版本地备份格式 .ixagent(向后兼容,用于本地导入导出)
export function exportAgentConfig(agent: Agent) {
  const data = {
    format: "ixagent",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    agent: {
      name: agent.name,
      avatar: agent.avatar,
      role: agent.role,
      config: agent.config,
    },
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${agent.name.replace(/\s+/g, "_")}.ixagent`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 新版社区分享格式 .ix-agent.json(kind:"interviewx-agent")
// 顶层平铺字段,适合上传到 GitHub Repo/Gist 供其他人通过 URL 导入
export function exportShareableAgent(agent: Agent) {
  const cfg = agent.config || ({} as any);
  const data = {
    kind: "interviewx-agent",
    version: 1,
    name: agent.name,
    role: agent.role || "custom",
    avatar: agent.avatar || "🤖",
    promptTemplate: cfg.promptTemplate || "",
    focusAreas: cfg.focusAreas || [],
    tone: cfg.tone || "neutral",
    difficulty: cfg.difficulty ?? 5,
    agentKind: agent.agentKind || "interviewer",
    tags: [],
    description: `${agent.role || "custom"} 面试官 · ${(cfg.focusAreas || []).join("/")}`,
    author: "",
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (agent.name || "agent").replace(/\s+/g, "_");
  a.download = `${safeName}.ix-agent.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function importAgentConfig(
  file: File
): Promise<{
  name: string;
  avatar: string;
  role: string;
  tone: string;
  focusAreas: string[];
  difficulty: number;
  promptTemplate: string;
  candidatePersona?: string;
}> {
  const text = await file.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  // 兼容新格式 kind:"interviewx-agent"
  if (data.kind === "interviewx-agent") {
    return {
      name: typeof data.name === "string" ? data.name : "",
      avatar: typeof data.avatar === "string" ? data.avatar : "🤖",
      role: sanitizeRole(data.role),
      tone: sanitizeTone(data.tone),
      focusAreas: Array.isArray(data.focusAreas) ? data.focusAreas.filter((x: any) => typeof x === "string") : [],
      difficulty: typeof data.difficulty === "number" && data.difficulty >= 1 && data.difficulty <= 10 ? data.difficulty : 5,
      promptTemplate: typeof data.promptTemplate === "string" ? data.promptTemplate : "",
      candidatePersona: typeof data.candidatePersona === "string" ? data.candidatePersona : undefined,
    };
  }
  // 旧格式 format:"ixagent"
  if (data.format !== "ixagent") throw new Error("无效的 .ixagent 或 .ix-agent.json 文件");
  const a = data.agent || {};
  const cfg = a.config || {};
  return {
    name: typeof a.name === "string" ? a.name : "",
    avatar: typeof a.avatar === "string" ? a.avatar : "🤖",
    role: sanitizeRole(a.role),
    tone: sanitizeTone(cfg.tone),
    focusAreas: Array.isArray(cfg.focusAreas) ? cfg.focusAreas.filter((x: any) => typeof x === "string") : [],
    difficulty: typeof cfg.difficulty === "number" && cfg.difficulty >= 1 && cfg.difficulty <= 10 ? cfg.difficulty : 5,
    promptTemplate: typeof cfg.promptTemplate === "string" ? cfg.promptTemplate : "",
    candidatePersona: typeof a.candidatePersona === "string" ? a.candidatePersona : undefined,
  };
}
