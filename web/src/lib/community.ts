// 社区分享工具:无服务器方案,基于文件导入/导出 + URL 导入(GitHub raw / gist)
// 用户导出 agent/面经为 JSON 文件 → 上传到 GitHub repo/gist → 分享 raw URL → 其他人导入

// ===== URL 转换 =====
// 将 GitHub blob URL 转换为 raw URL(用户从浏览器复制的通常是 blob URL)
// blob: https://github.com/user/repo/blob/main/agents/foo.json
// raw:  https://raw.githubusercontent.com/user/repo/main/agents/foo.json
export function normalizeGitHubUrl(url: string): string {
  const trimmed = url.trim();
  // 已经是 raw URL
  if (trimmed.includes("raw.githubusercontent.com")) return trimmed;
  // gist URL(简化处理,取第一个文件)
  if (trimmed.includes("gist.github.com")) {
    // https://gist.github.com/user/gist_id → https://gist.githubusercontent.com/user/gist_id/raw
    return trimmed
      .replace("gist.github.com", "gist.githubusercontent.com")
      .replace(/\/$/, "") + "/raw";
  }
  // GitHub blob URL → raw URL(分离 query/fragment)
  const blobMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^?#]+)/);
  if (blobMatch) {
    const [, user, repo, path] = blobMatch;
    return `https://raw.githubusercontent.com/${user}/${repo}/${path}`;
  }
  return trimmed;
}

// ===== Agent 导出/导入格式 =====
// .ix-agent.json 文件格式
export interface ShareableAgent {
  kind: "interviewx-agent";
  version: 1;
  name: string;
  role: string;
  avatar: string;
  promptTemplate: string;
  focusAreas: string[];
  tone: string;
  difficulty: number;
  agentKind: string;
  tags?: string[];
  description?: string;
  author?: string;
}

// ===== Experience 导出/导入格式 =====
// .ix-experience.json 文件格式
export interface ShareableExperience {
  kind: "interviewx-experience";
  version: 1;
  company: string;
  position: string;
  round: string;
  result: string;
  difficulty: number;
  tags: string[];
  duration: string;
  questions: Array<{
    question: string;
    category: string;
    myAnswer?: string;
    feedback?: string;
  }>;
  summary?: string;
  author?: string;
}

// 合法值白名单(防 as 断言绕过)
const VALID_ROLES = ["hr", "tech", "ceo", "custom"];
const VALID_TONES = ["gentle", "direct", "aggressive", "neutral"];

// ===== 导出为文件 =====
export function downloadJson(data: unknown, filename: string) {
  // 文件名清洗:去除路径分隔符等非法字符
  const safeName = (filename || "export.json").replace(/[\\/:*?"<>|]/g, "_");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// 文件大小上限:5MB(防止 OOM)
const MAX_IMPORT_SIZE = 5 * 1024 * 1024;

// ===== 从 URL 导入 =====
// 获取 JSON,支持 GitHub blob/raw/gist URL 自动转换
// 安全:1) scheme 白名单 2) 内网地址拦截 3) 超时 15s 4) 体积上限 5MB
export async function fetchJsonFromUrl<T>(url: string): Promise<T> {
  const rawUrl = normalizeGitHubUrl(url);

  // 1) scheme 白名单
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL 格式无效");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持 http/https URL");
  }

  // 2) 拦截内网地址(防 CSRF 跳板)
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^(10\.|192\.168\.|169\.254\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  ) {
    throw new Error("为安全起见,不允许从内网地址导入");
  }

  // 3) 超时 15s + 请求
  const resp = await fetch(rawUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`获取失败(${resp.status}):${resp.statusText}`);
  }

  // 4) 体积上限
  const text = await resp.text();
  if (text.length > MAX_IMPORT_SIZE) {
    throw new Error(`文件过大(>${MAX_IMPORT_SIZE / 1024 / 1024}MB)`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("URL 返回的内容不是有效的 JSON");
  }
}

// ===== 验证 =====
// 兼容两种格式:新的 kind:"interviewx-agent" 和旧的 format:"ixagent"
export function validateAgent(data: any): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") return { valid: false, error: "数据不是对象" };
  // 新格式:顶层就是 agent 数据
  if (data.kind === "interviewx-agent") {
    if (typeof data.name !== "string" || !data.name) return { valid: false, error: "缺少 name 字段或非字符串" };
    if (typeof data.promptTemplate !== "string") return { valid: false, error: "缺少 promptTemplate 字段或非字符串" };
    if (data.role !== undefined && !VALID_ROLES.includes(data.role)) {
      return { valid: false, error: `role 字段非法,允许值:${VALID_ROLES.join("/")}` };
    }
    if (data.tone !== undefined && !VALID_TONES.includes(data.tone)) {
      return { valid: false, error: `tone 字段非法,允许值:${VALID_TONES.join("/")}` };
    }
    if (data.difficulty !== undefined && (typeof data.difficulty !== "number" || data.difficulty < 1 || data.difficulty > 10)) {
      return { valid: false, error: "difficulty 必须是 1-10 的数字" };
    }
    if (data.focusAreas !== undefined && !Array.isArray(data.focusAreas)) {
      return { valid: false, error: "focusAreas 必须是数组" };
    }
    return { valid: true };
  }
  // 旧格式:format:"ixagent",数据在 data.agent.config 中
  if (data.format === "ixagent") {
    const a = data.agent;
    if (!a || typeof a.name !== "string") return { valid: false, error: "缺少 agent.name 字段或非字符串" };
    if (!a.config || typeof a.config.promptTemplate !== "string") {
      return { valid: false, error: "缺少 agent.config.promptTemplate 字段或非字符串" };
    }
    return { valid: true };
  }
  return { valid: false, error: "文件类型不匹配(期望 interviewx-agent 或 ixagent)" };
}

// 归一化:将两种格式统一转为 ShareableAgent(白名单已校验,可安全断言)
export function normalizeAgent(data: any): ShareableAgent {
  if (data.kind === "interviewx-agent") {
    const role = VALID_ROLES.includes(data.role) ? data.role : "custom";
    const tone = VALID_TONES.includes(data.tone) ? data.tone : "neutral";
    const difficulty = typeof data.difficulty === "number" && data.difficulty >= 1 && data.difficulty <= 10
      ? data.difficulty : 5;
    return {
      ...data,
      kind: "interviewx-agent",
      version: 1,
      role,
      tone,
      difficulty,
      focusAreas: Array.isArray(data.focusAreas) ? data.focusAreas.filter((x: any) => typeof x === "string") : [],
      avatar: typeof data.avatar === "string" ? data.avatar : "🤖",
      promptTemplate: typeof data.promptTemplate === "string" ? data.promptTemplate : "",
      agentKind: typeof data.agentKind === "string" ? data.agentKind : "interviewer",
    } as ShareableAgent;
  }
  if (data.format === "ixagent") {
    const a = data.agent;
    const cfg = a?.config || {};
    return {
      kind: "interviewx-agent",
      version: 1,
      name: typeof a?.name === "string" ? a.name : "",
      role: VALID_ROLES.includes(a?.role) ? a.role : "custom",
      avatar: typeof a?.avatar === "string" ? a.avatar : "🤖",
      promptTemplate: typeof cfg.promptTemplate === "string" ? cfg.promptTemplate : "",
      focusAreas: Array.isArray(cfg.focusAreas) ? cfg.focusAreas.filter((x: any) => typeof x === "string") : [],
      tone: VALID_TONES.includes(cfg.tone) ? cfg.tone : "neutral",
      difficulty: typeof cfg.difficulty === "number" && cfg.difficulty >= 1 && cfg.difficulty <= 10 ? cfg.difficulty : 5,
      agentKind: "interviewer",
    };
  }
  throw new Error("无法识别的 Agent 格式");
}

export function validateExperience(data: any): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") return { valid: false, error: "数据不是对象" };
  if (data.kind !== "interviewx-experience") return { valid: false, error: "文件类型不匹配(期望 interviewx-experience)" };
  if (typeof data.company !== "string" || !data.company) return { valid: false, error: "缺少 company 字段或非字符串" };
  if (!Array.isArray(data.questions)) return { valid: false, error: "缺少 questions 数组" };
  /*
   * ⚠️ 空数组必须拒绝(W5 审计补测发现)。
   * 没有问题的"面经"没有任何价值,却会在列表里占位,
   * 导入者还会以为自己导入成功了。
   */
  if (data.questions.length === 0) {
    return { valid: false, error: "questions 不能为空(没有问题的面经没有意义)" };
  }
  // 校验每个 question 元素
  for (let i = 0; i < data.questions.length; i++) {
    const q = data.questions[i];
    if (!q || typeof q !== "object") {
      return { valid: false, error: `questions[${i}] 必须是对象` };
    }
    if (typeof q.question !== "string") {
      return { valid: false, error: `questions[${i}].question 必须是字符串` };
    }
  }
  return { valid: true };
}

// ===== 从本地文件导入 =====
// 大小上限 5MB
export function readJsonFile(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMPORT_SIZE) {
      reject(new Error(`文件过大(${(file.size / 1024 / 1024).toFixed(1)}MB > ${MAX_IMPORT_SIZE / 1024 / 1024}MB)`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result as string));
      } catch {
        reject(new Error("文件不是有效的 JSON"));
      }
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsText(file);
  });
}
