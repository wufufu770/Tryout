// 导出功能单元测试
// Seam:buildSessionMarkdown()(纯函数)
//      buildSessionJSON()(纯函数)
//
// 为什么测:导出是**用户拿走的最后一步**。
// 导出坏了用户拿到的是坏文件,而且往往是在离开应用之后才发现 ——
// 没有报错、没有提示、文件已经发给别人了。
import { describe, it, expect } from "vitest";
import { buildSessionMarkdown, buildSessionJSON } from "./exporter";

const SESSION = {
  sessionId: "s1", title: "后端面试", difficulty: "normal",
  flowTemplate: "tech", createdAt: "2026-09-01T10:00:00Z",
} as any;

const MSGS = [
  { role: "user", content: "介绍一下 HashMap", createdAt: "2026-09-01T10:01:00Z" },
  { role: "assistant", content: "HashMap 底层是数组+链表", agentName: "技术官", createdAt: "2026-09-01T10:01:30Z" },
] as any[];

const EVALS = [
  {
    overallScore: 7.5,
    report: "整体不错",
    improvementAdvice: "多讲边界条件",
    betterAnswerSample: "可以这样说…",
    dimensions: [{ dimensionName: "技术深度", score: 4, comment: "原理清晰" }],
    generatedAt: "2026-09-01T11:00:00Z",
  },
] as any[];

describe("exportSessionAsMarkdown 基本结构", () => {
  it("应包含标题与元信息", () => {
    const md = buildSessionMarkdown(SESSION, MSGS, EVALS);
    expect(md).toContain("# 后端面试");
    expect(md).toContain("## 对话记录");
    expect(md).toContain("## 评估报告");
  });

  it("应包含对话内容与发言者", () => {
    const md = buildSessionMarkdown(SESSION, MSGS, EVALS);
    expect(md).toContain("介绍一下 HashMap");
    expect(md).toContain("技术官");
  });

  it("无标题时应使用兜底名而非 undefined", () => {
    const md = buildSessionMarkdown({ ...SESSION, title: undefined }, [], []);
    expect(md).toContain("# 面试会话");
    expect(md).not.toContain("undefined");
  });

  it("无评估时应说明而不是留空节", () => {
    const md = buildSessionMarkdown(SESSION, MSGS, []);
    expect(md).toContain("## 评估报告");
    expect(md).not.toContain("undefined");
  });

  it("空消息列表不应崩溃", () => {
    expect(() => buildSessionMarkdown(SESSION, [], [])).not.toThrow();
    expect(() => buildSessionMarkdown(SESSION, null as any, null as any)).not.toThrow();
  });
});

describe("exportSessionAsMarkdown 内容安全", () => {
  /*
   * ⭐ 真实风险:对话内容被**原样**拼进 Markdown。
   * 用户或面试官提到 `**加粗**`、`` `代码` ``、`# 标题` 时,
   * 导出的文件结构会被破坏 —— 而这是用户要发给别人的文档。
   */
  it("对话中的 markdown 特殊字符不应破坏结构", () => {
    const risky = [
      { role: "user", content: "**加粗**和`代码`还有# 假标题" },
      { role: "assistant", content: "## 伪造的评估报告\n- 看起来像列表" },
    ] as any[];
    const md = buildSessionMarkdown(SESSION, risky, []);
    // 真实的章节标题仍应是 markdown 标题
    const h2 = md.split("\n").filter((l) => l.startsWith("## "));
    expect(h2).toContain("## 对话记录");
    expect(h2).toContain("## 评估报告");
    // 伪造的标题不应出现在标题列表里
    expect(h2).not.toContain("## 伪造的评估报告");
  });

  it("空字符串消息不应产生 undefined", () => {
    const md = buildSessionMarkdown(SESSION, [{ role: "user", content: "" } as any], []);
    expect(md).not.toContain("undefined");
  });

  it("超长内容不应崩溃", () => {
    const huge = [{ role: "user", content: "很长的回答".repeat(20000) } as any];
    expect(() => buildSessionMarkdown(SESSION, huge, [])).not.toThrow();
  });
});

describe("exportSessionAsMarkdown 评估段", () => {
  it("应包含分数、建议与更优回答", () => {
    const md = buildSessionMarkdown(SESSION, MSGS, EVALS);
    expect(md).toContain("7.5");
    expect(md).toContain("多讲边界条件");
    expect(md).toContain("可以这样说");
  });

  it("应包含维度明细", () => {
    const md = buildSessionMarkdown(SESSION, MSGS, EVALS);
    expect(md).toContain("技术深度");
  });

  it("评估缺字段时应显示占位而非 undefined", () => {
    const md = buildSessionMarkdown(SESSION, MSGS, [
      { overallScore: 6, generatedAt: "2026-09-01T11:00:00Z" } as any,
    ]);
    expect(md).not.toContain("undefined");
  });
});

describe("exportSessionAsJSON", () => {
  it("应输出可解析的 JSON", () => {
    const out = buildSessionJSON(SESSION, MSGS, EVALS);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("应包含会话、消息与评估三部分", () => {
    const j = JSON.parse(buildSessionJSON(SESSION, MSGS, EVALS));
    expect(j).toHaveProperty("session");
    expect(j).toHaveProperty("messages");
    expect(j).toHaveProperty("evaluations");
    expect(j.messages).toHaveLength(2);
  });

  it("非法字符不应导致输出无法解析", () => {
    const weird = [{ role: "user", content: "含\x00控制符和\"引号\"" } as any];
    const out = buildSessionJSON(SESSION, weird, EVALS);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("空输入应输出合法 JSON", () => {
    expect(() => JSON.parse(buildSessionJSON(null as any, null as any, null as any))).not.toThrow();
  });
});
