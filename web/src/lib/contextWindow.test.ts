// 上下文治理单元测试
// Seam:truncateMaterial() / buildContextWindow()(纯函数)
//
// 背景(W4-4):三处路径的长度约束互相矛盾——
//   predict-questions 端点:简历 20000 / JD 10000 字符
//   主链路 injectMaterials:无上限,简历+JD 全文直拼
//   历史消息:无窗口,全量传
// 长简历会撑爆 context、稀释模型对关键信息的注意力、让 token 成本失控。
//
// 设计取舍:
//   1. **按行截断而非按字符硬切** —— 硬切可能把一个词/一个字段劈成两半,
//      模型看到半句话会做出错误推断。宁可少给,不要给错。
//   2. **保留结构化头部** —— 简历的开头通常是姓名/联系方式/教育,
//      信息密度最高,截断时优先保留。
//   3. **显式告知被截断** —— 不能让模型以为这就是全文,
//      否则它会基于不完整信息做判断还不自知。
import { describe, it, expect } from "vitest";
import { truncateMaterial, buildContextWindow, estimateTokens, DEFAULT_LIMITS } from "./contextWindow";

describe("truncateMaterial", () => {
  it("短内容应原样返回且不加分隔标记", () => {
    const t = "姓名:张伟\n熟悉 Java 与 MySQL";
    const r = truncateMaterial(t, 1000);
    expect(r.text).toBe(t);
    expect(r.truncated).toBe(false);
  });

  it("超长内容应被截断并标记", () => {
    const long = "行\n".repeat(2000);
    const r = truncateMaterial(long, 500);
    expect(r.text.length).toBeLessThan(long.length);
    expect(r.truncated).toBe(true);
  });

  it("截断后必须显式声明被截断(不能让模型误以为这是全文)", () => {
    const r = truncateMaterial("a\n".repeat(2000), 200);
    expect(r.text).toMatch(/省略|截断/);
  });

  it("不应在行中间劈开内容", () => {
    const long = "第一行很长很长很长很长很长很长很长很长很长很长\n第二行\n第三行";
    const r = truncateMaterial(long, 30);
    // 截断点必须落在换行处:保留的部分应是原文的**完整行**,
    // 而不是某一行被切成半句。去掉尾部的省略标记后比对。
    const keptPart = r.text.split("\n…(内容较长")[0];
    for (const line of keptPart.split("\n")) {
      expect(long.split("\n")).toContain(line);   // 每一行都必须原样存在于原文
    }
    expect(r.truncated).toBe(true);
  });

  it("空内容应返回空且不标记截断", () => {
    const r = truncateMaterial("", 100);
    expect(r.text).toBe("");
    expect(r.truncated).toBe(false);
  });

  it("容量极小时仍应返回可用内容而不是崩溃", () => {
    const r = truncateMaterial("很长的内容行\n第二行", 1);
    expect(typeof r.text).toBe("string");
  });

  it("无换行的超长单行应硬切兜底(不能整段丢弃)", () => {
    // PDF 提取出的文本偶尔整段没有换行,此时"按行截断"会把所有内容丢掉。
    // 兜底逻辑:一行都放不下时硬切,总比什么都不给强。
    const noNewline = "x".repeat(5000);
    const r = truncateMaterial(noNewline, 500);
    expect(r.text.length).toBeGreaterThan(100);
    expect(r.truncated).toBe(true);
    expect(r.text).toMatch(/已截断/);
  });

  it("默认限额应生效(不传 max 时用 DEFAULT_LIMITS)", () => {
    const long = "x".repeat(DEFAULT_LIMITS.material + 1000);
    const r = truncateMaterial(long);
    expect(r.truncated).toBe(true);
  });
});

describe("estimateTokens", () => {
  it("中英混排应给出非零估算", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
    expect(estimateTokens("你好世界")).toBeGreaterThan(0);
  });

  it("空串应为 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("CJK 的每字成本应高于英文每字符", () => {
    // 中文 1 字 ≈ 1-1.5 token;英文 1 字符 ≈ 0.25 token
    expect(estimateTokens("中")).toBeGreaterThan(estimateTokens("a"));
  });

  it("应随长度单调递增", () => {
    expect(estimateTokens("a".repeat(100))).toBeGreaterThan(estimateTokens("a".repeat(10)));
  });
});

describe("buildContextWindow", () => {
  const mk = (n: number, role: "user" | "assistant" = "user") =>
    Array.from({ length: n }, (_, i) => ({ role, content: `消息${i}${"内".repeat(200)}` }));

  it("短会话应全部保留且不产生摘要", () => {
    const w = buildContextWindow(mk(6));
    expect(w.recent).toHaveLength(6);
    expect(w.summarizedCount).toBe(0);
  });

  it("超长会话应只保留最近 N 条", () => {
    const w = buildContextWindow(mk(50), { keepRecent: 10 });
    expect(w.recent).toHaveLength(10);
    expect(w.summarizedCount).toBe(40);
  });

  it("被摘要掉的消息不应出现在 recent 中", () => {
    const w = buildContextWindow(mk(30), { keepRecent: 5 });
    const firstRecent = w.recent[0].content;
    expect(firstRecent).toContain("消息25");
  });

  it("摘要内容不应包含完整原文(避免双份 token)", () => {
    const msgs = mk(30);
    const w = buildContextWindow(msgs, { keepRecent: 5 });
    // 若实现了 summarize,摘要应是提炼而非原文复制
    if (w.summary) {
      expect(w.summary.length).toBeLessThan(msgs.slice(0, 25).reduce((a, m) => a + m.content.length, 0));
    }
  });

  it("system 消息不应被丢弃(它们承载角色设定)", () => {
    const msgs = [
      { role: "system" as const, content: "你是面试官" },
      ...mk(30),
    ];
    const w = buildContextWindow(msgs, { keepRecent: 5 });
    expect(w.recent.some((m) => m.role === "system")).toBe(true);
  });

  it("system 消息不占用 keepRecent 配额", () => {
    const msgs = [
      { role: "system" as const, content: "你是面试官" },
      ...mk(10),
    ];
    const w = buildContextWindow(msgs, { keepRecent: 4 });
    const nonSystem = w.recent.filter((m) => m.role !== "system");
    expect(nonSystem).toHaveLength(4);
  });

  it("空数组不应崩溃", () => {
    const w = buildContextWindow([]);
    expect(w.recent).toEqual([]);
    expect(w.summarizedCount).toBe(0);
  });

  it("应给出预计 token 占用供预算检查", () => {
    const w = buildContextWindow(mk(50), { keepRecent: 10 });
    expect(w.estimatedTokens).toBeGreaterThan(0);
  });
});
