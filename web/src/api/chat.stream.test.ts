// 单元测试:SSE 流中途错误必须**如实表达原因**,并保留已收到的部分内容(守卫 ISSUE-054)
//
// ## 缺陷
// `api/client.ts` 的流式循环里,只要收到 error 事件就
// `throw new ApiError(streamError, "UPSTREAM_ERROR", 502)` ——
// **无论真实原因一律 502**。而流式链路上游能报至少四类,语义完全不同:
//   401/403 鉴权 · 429 限流 · 配额耗尽 · 真正的网关故障
// 一律报 502 的后果:用户看到"网关错误"而实际是"你请求太频繁",
// `formatApiError` 拿不到能对症渲染的 i18nKey,排查方向被带偏。
//
// 更讽刺的是:R21(ISSUE-050)已经在 `sseParser` 里把上游的 `error.code`
// 解析进了 `errorType` —— 但**消费端一直没读它**。解析了却不用,等于白解析。
//
// 第二个问题:抛错前 `onToken` 已经把 delta 推给 UI 了,上层往往 `resetStreaming()`
// 把已渲染内容清空,用户看到"AI 突然消失"。错误对象里必须带上 partialContent。
//
// ## 为什么难测
// 这条链路过去**零测试**(`client.test.ts` 只覆盖非流式的 `request()`)。
// 本文件用假 fetch 驱动完整流式链路补上这块。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** 造一个能按 SSE 分块吐出内容的假 fetch */
function sseFetch(lines: string[], ok = true) {
  return vi.fn(async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(`data: ${l}\n\n`));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    });
    return new Response(stream, { status: ok ? 200 : 500, headers: { "Content-Type": "text/event-stream" } });
  });
}

const run = <T,>(p: Promise<T>) => p.then((v) => v as T, (e) => e);

describe("chat() 流式错误契约(ISSUE-054)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let c: any;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    fetchMock = vi.fn() as any;
    vi.stubGlobal("fetch", fetchMock);
    const token = (typeof localStorage !== "undefined" ? localStorage.getItem("tryout:api_token") : null) || "t";
    if (typeof localStorage !== "undefined") localStorage.setItem("tryout:api_token", token);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function chatWith(lines: string[]) {
    fetchMock.mockImplementation(sseFetch(lines));
    const { api } = await import("@/api/client");
    c = api;
    const onToken = vi.fn();
    return run(c.chat("prov-x", { messages: [{ role: "user", content: "hi" }], stream: true }, onToken));
  }

  it("限流类上游错误不得被一律报成 502(应可对症识别)", async () => {
    const e = await chatWith([
      JSON.stringify({ choices: [{ delta: { content: "部分内容" } }] }),
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "上游限流" } }),
    ]);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain("上游限流");
    // 关键:不是所有上游错误都是 502
    expect(e.status, `限流被报成 ${e.status},硬编码 502 复发`).not.toBe(502);
    expect(e.upstreamCode).toBe("rate_limit_exceeded");
  });

  it("限流错误要带可渲染的 i18nKey", async () => {
    const e = await chatWith([JSON.stringify({ error: { code: "rate_limit_exceeded", message: "x" } })]);
    expect(e.i18nKey).toBe("error.network.rateLimited");
  });

  it("鉴权类错误仍归 502(BFF 不该把上游 401 直接透给客户端)", async () => {
    const e = await chatWith([JSON.stringify({ error: { code: "invalid_api_key", message: "bad key" } })]);
    expect(e.status).toBe(502);
    expect(e.upstreamCode).toBe("invalid_api_key");
  });

  it("无法归类的上游错误仍保持 502(不得把网关故障报成 4xx)", async () => {
    const e = await chatWith([JSON.stringify({ error: "upstream boom" })]);
    expect(e.status).toBe(502);
  });

  it("已收到的部分内容必须挂在错误上(否则上层 resetStreaming 会让内容凭空消失)", async () => {
    const e = await chatWith([
      JSON.stringify({ choices: [{ delta: { content: "AI 说了半句" } }] }),
      JSON.stringify({ error: { code: "server_error", message: "boom" } }),
    ]);
    expect(e.partialContent).toBe("AI 说了半句");
  });

  it("字符串形式的 error(旧格式)不得回归", async () => {
    const e = await chatWith([JSON.stringify({ error: "boom" })]);
    expect(e.message).toBe("boom");
    expect(e.status).toBe(502);
  });
});
