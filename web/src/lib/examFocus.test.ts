// 题库注入 prompt 单元测试
// Seam:buildExamFocusBlock()(纯函数)—— 把题目变成注入 system prompt 的知识锚点
//
// 这是 W4-2 的核心:让 808 道题真正影响提问。
// 两条不可让步的设计约束(均有实测/研究支撑):
//   1. **知识锚点,不是剧本**。直接让 LLM 照念题面会毁掉模拟真实度 ——
//      用户能背出题库,练习就失去意义。必须明确"改写成你的口吻"。
//   2. **边界定义**:Campion 15 成分中「同题」证据 ★★★,而「限制追问」
//      证据 ☆☆☆(几乎为零)。所以:核心题固定,追问自由,但每条追问必须
//      指向上面某个方向 —— 这条来自 Campion/Levashina 的实务惯例。
//
// 另一条硬约束:**绝不注入 referenceAnswer**。它是评估基准而非提问素材,
// 混进去等于让模型边看答案边提问。
import { describe, it, expect } from "vitest";
import { buildExamFocusBlock, buildNoBankNote } from "./examFocus";
import type { QuestionLite } from "./questionSelector";

const Q: QuestionLite = {
  id: "backend-tech-001",
  industry: "backend",
  type: "technical",
  difficulty: "mid",
  title: "HashMap 底层原理",
  content: "请详细描述 JDK 1.8 中 HashMap 的底层结构与扩容机制",
  keyPoints: ["hash 扰动", "链表转红黑树", "扩容因子 0.75"],
  tags: ["Java", "集合"],
  estimatedMinutes: 8,
};

describe("buildExamFocusBlock", () => {
  it("应包含题目的考察方向(keyPoints)", () => {
    const b = buildExamFocusBlock(Q);
    expect(b).toContain("hash 扰动");
    expect(b).toContain("链表转红黑树");
    expect(b).toContain("扩容因子 0.75");
  });

  it("应包含题型标签以引导提问风格", () => {
    expect(buildExamFocusBlock(Q)).toContain("技术原理");
  });

  it("必须明确禁止照抄题面(否则用户能背题库)", () => {
    const b = buildExamFocusBlock(Q);
    expect(b).toMatch(/不要.*照抄|改写|自然的面试口吻/);
  });

  it("必须给出追问边界:每条追问都要落在给定方向上", () => {
    const b = buildExamFocusBlock(Q);
    expect(b).toMatch(/追问/);
    expect(b).toMatch(/禁止|不得/);
  });

  it("不得包含 referenceAnswer", () => {
    const withAnswer = { ...Q, referenceAnswer: "底层是数组+链表+红黑树" } as QuestionLite;
    const b = buildExamFocusBlock(withAnswer);
    expect(b).not.toContain("底层是数组");
    expect(b).not.toContain("referenceAnswer");
  });

  it("不得包含题面全文 —— 题面是给用户看的,注入会变成泄题", () => {
    // 题面本身在面试中由模型口头转述;若把 content 原文塞进 prompt,
    // 模型大概率会照读,用户就看到"标准问法"了。
    const b = buildExamFocusBlock(Q);
    expect(b).not.toContain(Q.content);
  });

  it("keyPoints 为空时应降级为只给题型,而不是抛错或给出空方向", () => {
    const b = buildExamFocusBlock({ ...Q, keyPoints: [] });
    expect(b).toBeTruthy();
    expect(b).toContain("技术原理");
  });

  it("不传题目时应返回空串(题库不可用时的降级)", () => {
    expect(buildExamFocusBlock(null)).toBe("");
    expect(buildExamFocusBlock(undefined)).toBe("");
  });

  it("应包含 XML 边界标记,便于与 prompt 其余部分区分", () => {
    expect(buildExamFocusBlock(Q)).toContain("<exam_focus>");
    expect(buildExamFocusBlock(Q)).toContain("</exam_focus>");
  });

  it("应声明块内内容是参考而非指令(防 prompt 注入)", () => {
    const b = buildExamFocusBlock(Q);
    expect(b).toMatch(/不是.*指令|仅供参考|知识参考/);
  });

  it("不同题型的引导语应不同", () => {
    const design = buildExamFocusBlock({ ...Q, type: "design" });
    const coding = buildExamFocusBlock({ ...Q, type: "coding" });
    const behav = buildExamFocusBlock({ ...Q, type: "behavioral" });
    expect(design).not.toBe(coding);
    expect(coding).not.toBe(behav);
  });
});

describe("buildNoBankNote", () => {
  it("题库不可用时应说明按自由发挥提问", () => {
    const n = buildNoBankNote();
    expect(n).toBeTruthy();
    expect(n).toMatch(/自由|不限定/);
  });
});
