// contextInjector 单元测试
// Seam:injectMaterials() / buildSystemPrompt()(纯函数)
//
// 背景(W5-3):92 行,**零测试**。而它决定面试官"看到什么资料",
// 是 prompt 注入的核心路径 —— 资料顺序、换行、截断任一出错都会让面试跑偏。
import { describe, it, expect } from "vitest";
import { injectMaterials, buildSystemPrompt, type Material } from "./contextInjector";

const res = (content: string, title = "简历"): Material => ({ type: "resume", title, content });
const jd = (content: string, title = "JD"): Material => ({ type: "jd", title, content });
const txt = (content: string, title = "备注"): Material => ({ type: "text", title, content });

describe("injectMaterials", () => {
  it("无资料时应原样返回", () => {
    expect(injectMaterials("BASE", [])).toBe("BASE");
    expect(injectMaterials("BASE", undefined as any)).toBe("BASE");
  });

  it("应注入简历内容", () => {
    const out = injectMaterials("BASE", [res("熟悉 Java 与 MySQL")]);
    expect(out).toContain("熟悉 Java 与 MySQL");
    expect(out).toContain("BASE");
  });

  it("应按 简历 → JD → 补充资料 的顺序注入", () => {
    const out = injectMaterials("BASE", [
      txt("补充内容"),
      jd("岗位描述"),
      res("简历内容"),
    ]);
    expect(out.indexOf("简历内容")).toBeLessThan(out.indexOf("岗位描述"));
    expect(out.indexOf("岗位描述")).toBeLessThan(out.indexOf("补充内容"));
  });

  it("应使用一致的空行结构(不应出现三段紧贴)", () => {
    const out = injectMaterials("BASE", [res("R"), jd("J"), txt("T")]);
    // 三段之间应恰好隔一个空行,不应出现 3 个以上连续换行
    expect(out).not.toMatch(/\n{4,}/);
  });

  it("长简历应被截断并声明省略(W4-4)", () => {
    const long = "行\n".repeat(5000);
    const out = injectMaterials("BASE", [res(long)]);
    expect(out).toMatch(/已省略/);
    expect(out.length).toBeLessThan(long.length + 1000);
  });

  it("多份超长资料叠加后总量仍应受控", () => {
    const long = "行\n".repeat(5000);
    const out = injectMaterials("BASE", [res(long), jd(long), txt(long), res(long, "简历2")]);
    expect(out.length).toBeLessThan(30000);
  });

  it("未命名的资料应有兜底标题", () => {
    const out = injectMaterials("BASE", [{ type: "resume", content: "内容" }]);
    expect(out).toContain("未命名");
  });

  it("不应把空资料也注进去(浪费 token)", () => {
    const out = injectMaterials("BASE", [res(""), jd("有效内容")]);
    expect(out).toContain("有效内容");
  });
});

describe("buildSystemPrompt", () => {
  it("应包含面试官自身 prompt", () => {
    expect(buildSystemPrompt("我是资深面试官", "技术面", [])).toContain("我是资深面试官");
  });

  it("应包含当前阶段名", () => {
    expect(buildSystemPrompt("P", "项目深挖", [])).toContain("项目深挖");
  });

  it("应包含行为约束(每次只问一个问题)", () => {
    const out = buildSystemPrompt("P", "s", []);
    expect(out).toMatch(/一次只问一个问题|只问一个问题/);
  });

  it("难度提示应被注入", () => {
    const out = buildSystemPrompt("P", "s", [], undefined, { difficultyPrompt: "难度较高,追问更深" });
    expect(out).toContain("难度较高,追问更深");
  });

  it("examFocus 应插在行为约束之前(先给方向,再给纪律)", () => {
    const out = buildSystemPrompt("P", "s", [], undefined, {
      examFocus: "<exam_focus>ANCHOR_MARKER</exam_focus>",
    });
    expect(out).toContain("ANCHOR_MARKER");
    expect(out.indexOf("ANCHOR_MARKER")).toBeLessThan(out.indexOf("行为约束"));
  });

  it("空 examFocus 不应注入多余空行", () => {
    const plain = buildSystemPrompt("P", "s", []);
    const withEmpty = buildSystemPrompt("P", "s", [], undefined, { examFocus: "   " });
    expect(withEmpty).toBe(plain);
  });

  it("focusDirection 应包裹 XML 并声明不可作为指令", () => {
    const out = buildSystemPrompt("P", "s", [], "后端方向", {});
    expect(out).toContain("<user_focus>");
    expect(out).toMatch(/不可作为指令|不得作为指令/);
  });

  it("focusDirection 为空字符串时应忽略", () => {
    const plain = buildSystemPrompt("P", "s", []);
    const withEmpty = buildSystemPrompt("P", "s", [], "   ");
    expect(withEmpty).toBe(plain);
  });

  it("多 Agent 团队应注入成员列表与自身身份", () => {
    const out = buildSystemPrompt("P", "s", [], undefined, {
      activeAgent: { id: "a", name: "Alice", role: "tech", isSelf: true },
      teamAgents: [
        { id: "a", name: "Alice", role: "tech", isSelf: true },
        { id: "b", name: "Bob", role: "hr" },
      ],
    });
    expect(out).toContain("Alice");
    expect(out).toContain("Bob");
    expect(out).toMatch(/你在面试官团队中的身份|你是「Alice」/);
  });

  /*
   * ⚠️ askMode 指令只在**多 Agent 模式**下注入
   *    (条件是 activeAgent && teamAgents && teamAgents.length > 1)。
   *    单 Agent 时不注入是合理的 —— 没有"其他成员"可言。
   */
  const team2 = [
    { activeAgent: { id: "a", name: "Alice", role: "tech", isSelf: true },
      teamAgents: [
        { id: "a", name: "Alice", role: "tech", isSelf: true },
        { id: "b", name: "Bob", role: "hr" },
      ] },
  ];

  it("同时提问模式应给出各自角度的指令(多 Agent)", () => {
    const out = buildSystemPrompt("P", "s", [], undefined, { ...team2[0], askMode: "simultaneous" });
    expect(out).toMatch(/同时提问/);
    expect(out).toMatch(/只从你的专业角度|不要替其他成员提问/);
  });

  it("顺序模式应要求其他成员保持静默(多 Agent)", () => {
    const out = buildSystemPrompt("P", "s", [], undefined, { ...team2[0], askMode: "sequential" });
    expect(out).toMatch(/静默|不要替你提问/);
  });

  it("单 Agent 时不注入 askMode 指令(没有'其他成员'可言)", () => {
    const out = buildSystemPrompt("P", "s", [], undefined, { askMode: "simultaneous" });
    expect(out).not.toMatch(/同时提问模式/);
  });

  it("应包含阶段信号指令(W5-2:前端靠它推进阶段)", () => {
    const out = buildSystemPrompt("P", "s", []);
    expect(out).toContain("STAGE_STATUS");
  });

  it("阶段信号指令应说明不要解释标记", () => {
    const out = buildSystemPrompt("P", "s", []);
    expect(out).toMatch(/不要解释/);
  });
});
