// SSE 事件解析单元测试
// Seam:parseSseLine() 纯函数——SSE 文本 → 结构化事件
//
// 背景(R11):api/client.ts 原先在流式循环里内联 JSON.parse,
// 只识别 error / choices / usage,任何新增元数据事件
// (pii_mapping、未来的 stage_status)都会被解析后静默丢弃。
// 抽出纯函数后可测、可扩展,且不依赖 fetch / import.meta.env。
import { describe, it, expect } from "vitest";
import { parseSseLine, type SseEvent } from "./sseParser";

describe("parseSseLine", () => {
  it("应忽略非 data 行", () => {
    expect(parseSseLine("event: ping")).toBeNull();
    expect(parseSseLine("id: 42")).toBeNull();
    expect(parseSseLine("")).toBeNull();
  });

  it("应忽略 [DONE] 哨兵", () => {
    expect(parseSseLine("data: [DONE]")).toBeNull();
  });

  it("应忽略空 data 行", () => {
    expect(parseSseLine("data:")).toBeNull();
    expect(parseSseLine("data:   ")).toBeNull();
  });

  it("应忽略非法 JSON(不抛异常)", () => {
    expect(parseSseLine("data: {broken")).toBeNull();
    expect(parseSseLine("data: not json at all")).toBeNull();
  });

  it("应解析增量内容", () => {
    const e = parseSseLine('data: {"choices":[{"delta":{"content":"你好"}}]}');
    expect(e).not.toBeNull();
    expect(e!.delta).toBe("你好");
  });

  it("空 delta 应返回空字符串而非 undefined", () => {
    const e = parseSseLine('data: {"choices":[]}');
    expect(e!.delta).toBe("");
  });

  it("应解析 usage", () => {
    const e = parseSseLine('data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}');
    expect(e!.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20 });
  });

  it("应解析流式错误事件", () => {
    const e = parseSseLine('data: {"error":"上游炸了","errorType":"stream_error"}');
    expect(e!.error).toBe("上游炸了");
    expect(e!.errorType).toBe("stream_error");
  });

  it("应解析 pii_mapping 事件(R11:此前被静默丢弃)", () => {
    const e = parseSseLine(
      'data: {"pii_mapping":[{"placeholder":"[PHONE_A1B2C3D4]","value":"13812345678","type":"PHONE"}]}'
    );
    expect(e!.piiMapping).toHaveLength(1);
    expect(e!.piiMapping![0].value).toBe("13812345678");
  });

  it("应过滤非法形状的 pii_mapping 项", () => {
    const e = parseSseLine(
      'data: {"pii_mapping":[{"placeholder":"[PHONE_A1B2C3D4]","value":"138","type":"PHONE"},null,{"bad":1},{"placeholder":123,"value":"y","type":"PHONE"}]}'
    );
    // 第 1 项合法保留;null / 缺字段 / 字段类型错误的被丢弃
    expect(e!.piiMapping).toHaveLength(1);
    expect(e!.piiMapping![0].placeholder).toBe("[PHONE_A1B2C3D4]");
  });

  it("应保留字段齐全但值较短的映射(不做过度校验)", () => {
    const e = parseSseLine(
      'data: {"pii_mapping":[{"placeholder":"x","value":"y","type":"PHONE"}]}'
    );
    expect(e!.piiMapping).toHaveLength(1);
    expect(e!.piiMapping![0].value).toBe("y");
  });

  it("应支持未来新增的未知元数据键(不丢弃原对象)", () => {
    const e = parseSseLine('data: {"stage_status":"advance","coverage":["a","b"]}');
    // 未知键不应导致解析失败;raw 保留原对象供调用方扩展
    expect(e).not.toBeNull();
    expect(e!.raw).toBeDefined();
    expect((e!.raw as any).stage_status).toBe("advance");
  });

  it("应处理 data: 后有多余空格的实际情况", () => {
    const e = parseSseLine('data:    {"choices":[{"delta":{"content":"x"}}]}');
    expect(e!.delta).toBe("x");
  });

  it("应容忍 choices 为 null", () => {
    const e = parseSseLine('data: {"choices":null}');
    expect(e!.delta).toBe("");
  });

  /* ---- R21(ISSUE-049 / ISSUE-050):上游不守协议时的兜底 ---- */
  it("usage 的 token 数必须收敛为 number(字符串不能让 NaN 流进计费)", () => {
    // 上游协议保证是 number,但第三方网关常破坏这个不变量。
    // 原实现用 `as` 断言直接透传,字符串会一路带到
    // client.ts `tokensIn = ev.usage.prompt_tokens || 0` 变成字符串,
    // 之后任何 `+` 运算都产出 NaN —— 前端不报错,只是账单数字不对。
    const e = parseSseLine('data: {"usage":{"prompt_tokens":"10","completion_tokens":"20"}}');
    expect(typeof e!.usage!.prompt_tokens).toBe("number");
    expect(e!.usage!.prompt_tokens).toBe(10);
    expect(e!.usage!.completion_tokens).toBe(20);
  });

  it("usage 里的垃圾值应被丢弃而不是写成 NaN/null", () => {
    const e = parseSseLine('data: {"usage":{"prompt_tokens":"abc","completion_tokens":null}}');
    expect(e!.usage!.prompt_tokens).toBeUndefined();
    expect(e!.usage!.completion_tokens).toBeUndefined();
    // 关键:不得出现 NaN —— NaN 会静默污染一切下游算术
    expect(Object.values(e!.usage!).every((v) => typeof v === "number" && Number.isFinite(v as number))).toBe(true);
  });

  it("结构化 error 对象不得被静默丢弃(否则流会正常结束、用户只看到『没说话』)", () => {
    const e = parseSseLine('data: {"error":{"code":"rate_limit_exceeded","message":"上游限流"}}');
    expect(e!.error).toBe("上游限流");
    expect(e!.errorType).toBe("rate_limit_exceeded");
  });

  it("结构化 error 无 code 时至少要留下 message", () => {
    const e = parseSseLine('data: {"error":{"message":"boom"}}');
    expect(e!.error).toBe("boom");
  });

  it("合法数字的 usage 行为不变", () => {
    const e = parseSseLine('data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}');
    expect(e!.usage).toEqual({ prompt_tokens: 10, completion_tokens: 20 });
  });

  it("字符串 error 仍按原样透出(不得被新分支抢走)", () => {
    expect(parseSseLine('data: {"error":"boom"}')!.error).toBe("boom");
  });
});
