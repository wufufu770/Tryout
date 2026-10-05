// 提问编排单元测试
// Seam:planNextQuestion()(纯函数)—— 会话状态 → 下一题计划
//
// 为什么需要它:W3-1 之后服务端能检索题库了,但会话不知道用户要面什么岗位,
// 所以没有任何东西驱动提问。这是"题库接入提问"链路里唯一还缺的决策环节。
// 决策必须是纯函数且可测 —— 提问顺序错了会直接影响练习有效性,且难以人工察觉。
import { describe, it, expect } from "vitest";
import {
  planNextQuestion,
  pickNextQuestion,
  type PlanParams,
} from "@/lib/questionPlanner";

const BANK = [
  { id: "b1", industry: "backend", type: "technical", difficulty: "junior", title: "t1", content: "c1", keyPoints: ["k"], tags: ["java"], estimatedMinutes: 5 },
  { id: "b2", industry: "backend", type: "technical", difficulty: "junior", title: "t2", content: "c2", keyPoints: ["k"], tags: ["redis"], estimatedMinutes: 5 },
  { id: "b3", industry: "backend", type: "design", difficulty: "junior", title: "t3", content: "c3", keyPoints: ["k"], tags: ["java"], estimatedMinutes: 5 },
  { id: "m1", industry: "backend", type: "technical", difficulty: "mid", title: "t4", content: "c4", keyPoints: ["k"], tags: ["mysql"], estimatedMinutes: 5 },
];

describe("pickNextQuestion", () => {
  it("应返回 null(不猜题)当没有可用题时", () => {
    const r = pickNextQuestion(BANK, { industry: "nonexistent" });
    expect(r).toBeNull();
  });

  it("应排除已问过的题", () => {
    const r = pickNextQuestion(BANK, { industry: "backend", askedIds: ["b1", "b2", "b3", "m1"] });
    expect(r).toBeNull();
  });

  it("全部问完后应返回 null 而不是重复出题", () => {
    const all = BANK.map((q) => q.id);
    expect(pickNextQuestion(BANK, { industry: "backend", askedIds: all })).toBeNull();
  });

  it("应命中简历技能标签的题", () => {
    const r = pickNextQuestion(BANK, { industry: "backend", resumeTags: ["redis"] });
    expect(r?.id).toBe("b2");
  });

  it("无标签时应按稳定顺序返回,不随机", () => {
    const a = pickNextQuestion(BANK, { industry: "backend" });
    const b = pickNextQuestion(BANK, { industry: "backend" });
    expect(a?.id).toBe(b?.id);
  });
});

describe("planNextQuestion", () => {
  const base: PlanParams = {
    industry: "backend",
    sessionDifficulty: "normal",
    askedIds: [],
    coveredDirections: [],
  };

  it("会话未设行业时应返回 needsIndustry(不擅自猜岗位)", () => {
    const r = planNextQuestion(BANK, { ...base, industry: "" });
    expect(r.kind).toBe("needsIndustry");
  });

  it("题库为空应返回 noQuestions(与 needsIndustry 区分)", () => {
    const r = planNextQuestion([], { ...base });
    expect(r.kind).toBe("noQuestions");
  });

  it("题库已问尽应返回 exhausted", () => {
    const r = planNextQuestion(BANK, { ...base, askedIds: BANK.map((q) => q.id) });
    expect(r.kind).toBe("exhausted");
  });

  it("正常情况应返回 ask 并带题目与考察方向", () => {
    const r = planNextQuestion(BANK, base);
    expect(r.kind).toBe("ask");
    if (r.kind === "ask") {
      expect(r.question.id).toBeTruthy();
      expect(Array.isArray(r.directions)).toBe(true);
      expect(r.directions.length).toBeGreaterThan(0);
    }
  });

  it("考察方向应来自 keyPoints(题库缺它则无方向可循)", () => {
    const r = planNextQuestion(BANK, base);
    if (r.kind === "ask") {
      const q = BANK.find((x) => x.id === r.question.id)!;
      expect(r.directions).toEqual(q.keyPoints);
    }
  });

  it("已覆盖全部方向时应换一题而非重复同一方向", () => {
    const first = planNextQuestion(BANK, base);
    if (first.kind !== "ask") throw new Error("前置条件不满足");
    const second = planNextQuestion(BANK, {
      ...base,
      askedIds: [first.question.id],
      coveredDirections: first.directions,
    });
    expect(second.kind).toBe("ask");
    if (second.kind === "ask") {
      expect(second.question.id).not.toBe(first.question.id);
    }
  });

  it("最多问一轮时不得给出发散计划", () => {
    const r = planNextQuestion(BANK, { ...base, maxQuestions: 1 });
    expect(r.kind).toBe("ask");
  });

  it("计划里不得包含 referenceAnswer(那是评估基准,不是提问素材)", () => {
    const r = planNextQuestion(BANK, base);
    const json = JSON.stringify(r);
    expect(json).not.toContain("referenceAnswer");
  });
});
