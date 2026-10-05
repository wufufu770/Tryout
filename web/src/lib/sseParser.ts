// SSE 事件解析(纯函数)
//
// 背景(R11):api/client.ts 的流式循环原先内联 JSON.parse,
// 只识别 error / choices / usage 三个键,任何新增的元数据事件
// (pii_mapping、未来的 stage_status / coverage)都会被解析后静默丢弃。
// 这导致"后端已下发、前端收不到"的隐性断路,且难以察觉。
//
// 设计:把解析抽成纯函数,好处有三
//   1. 可测——不依赖 fetch / import.meta.env / 定时器
//   2. 可扩展——新增事件只需在这里加一个字段,不碰调用方循环
//   3. 健壮——任何解析异常都降级为 null,绝不打断流式读取

import type { PiiMapping } from "./piiPlaceholder";

export interface SseEvent {
  /** 增量文本(OpenAI 兼容 chunk);无内容时为空字符串 */
  delta: string;
  /** token 用量(仅在 OpenAI 最后一个 chunk 出现) */
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** 上游错误信息 */
  error?: string;
  errorType?: string;
  /** PII 占位符 → 明文 映射(流式首事件下发) */
  piiMapping?: PiiMapping[];
  /** 原始解析结果,供调用方消费尚未内置的字段 */
  raw: unknown;
}

function isValidMapping(x: unknown): x is PiiMapping {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.placeholder === "string" && typeof o.value === "string" && typeof o.type === "string";
}

/**
 * 解析一行 SSE
 * @param line 已 trim 的行,如 `data: {...}`
 * @returns 结构化事件;非 data 行 / [DONE] / 非法 JSON 返回 null
 */
export function parseSseLine(line: string): SseEvent | null {
  if (!line || !line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null; // 非法 JSON:静默跳过,不能打断流
  }
  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;
  const choices = obj.choices as Array<{ delta?: { content?: unknown } }> | null | undefined;
  const delta = choices?.[0]?.delta?.content;

  const event: SseEvent = {
    delta: typeof delta === "string" ? delta : "",
    raw,
  };

  // ⚠️ R21(ISSUE-049):usage 的两个计费字段必须**收敛为 number**。
  //   OpenAI 协议保证它们是 number,但任何第三方网关/代理都可能破坏这个不变量。
  //   原实现是 `as` 断言直接透传,于是字符串 "10" 会一路带到
  //   `client.ts:409  tokensIn = ev.usage.prompt_tokens || 0` 变成字符串,
  //   后续任何 `+` 运算都产出 NaN —— **前端不报错,只是账单数字不对**,
  //   属于典型的静默失败。这里统一 Number(...) 并丢掉非有限值。
  if (obj.usage && typeof obj.usage === "object") {
    const u = obj.usage as Record<string, unknown>;
    const num = (v: unknown): number | undefined => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    const prompt_tokens = num(u.prompt_tokens);
    const completion_tokens = num(u.completion_tokens);
    event.usage = {
      ...(prompt_tokens !== undefined ? { prompt_tokens } : {}),
      ...(completion_tokens !== undefined ? { completion_tokens } : {}),
    };
  }
  // ⚠️ R21(ISSUE-050):结构化 error 此前被**静默丢弃**。
  //   原实现只认 `typeof obj.error === "string"`;而很多网关(self-hosted 转发、
  //   OpenRouter、部分国内中转)发的是 `{"error":{"code":..,"message":..}}`。
  //   那种情况下 event.error 不被设置,流会一路跑到 [DONE] 并**正常返回**,
  //   用户看到"AI 没说话但也没报错",日志里零线索。
  if (typeof obj.error === "string") {
    event.error = obj.error;
  } else if (obj.error && typeof obj.error === "object" && typeof (obj.error as any).message === "string") {
    const st = obj.error as { code?: unknown; message: string };
    event.error = st.message;
    // 错误码同时落到 errorType,便于调用方按码分流(限流 / 鉴权 / 配额…),
    // 也让「上游到底说了什么」在日志里留得下痕迹。
    if (typeof st.code === "string") event.errorType = st.code;
  }
  if (typeof obj.errorType === "string") {
    event.errorType = obj.errorType;
  }
  if (Array.isArray(obj.pii_mapping)) {
    const valid = obj.pii_mapping.filter(isValidMapping);
    if (valid.length > 0) event.piiMapping = valid;
  }

  return event;
}
