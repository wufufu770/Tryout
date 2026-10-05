// 题库检索单元测试
// Seam:selectQuestions()(纯函数)—— 题库数组 → 排序后的候选题
//
// 纯函数的原因:检索策略是产品逻辑(难度映射、标签加权、重复惩罚)，
// 值得被单测锁死；而 IO(读 JSON、查网络)不属于这里。
import { describe, it, expect } from "vitest";
import {
  selectQuestions,
  questionStats,
  buildSearchIndex,
  normalizeTags,
  type QuestionLite,
} from "./questionSelector";

/** 构造测试题 */
function q(over: Partial<QuestionLite> & { id: string }): QuestionLite {
  return {
    industry: "backend",
    type: "technical",
    difficulty: "mid",
    title: "t",
    content: "c",
    keyPoints: [],
    tags: [],
    estimatedMinutes: 5,
    ...over,
  };
}

describe("normalizeTags", () => {
  it("应转小写并去空白", () => {
    expect(normalizeTags([" Java ", "MySQL", "JAVA"])).toEqual(["java", "mysql"]);
  });

  it("应过滤空串", () => {
    expect(normalizeTags(["java", "", "  ", "redis"])).toEqual(["java", "redis"]);
  });
});

describe("questionStats", () => {
  const bank = [
    q({ id: "a", industry: "backend", type: "technical", difficulty: "junior", tags: ["java"] }),
    q({ id: "b", industry: "backend", type: "coding", difficulty: "senior", tags: ["java", "redis"] }),
    q({ id: "c", industry: "frontend", type: "design", difficulty: "mid", tags: ["vue"] }),
  ];

  it("应统计总数", () => {
    expect(questionStats(bank).total).toBe(3);
  });

  it("应按行业统计", () => {
    const s = questionStats(bank);
    expect(s.industries).toEqual([
      { id: "backend", count: 2 },
      { id: "frontend", count: 1 },
    ]);
  });

  it("应按题型统计", () => {
    const s = questionStats(bank);
    expect(s.types).toEqual([
      { id: "technical", count: 1 },
      { id: "coding", count: 1 },
      { id: "design", count: 1 },
    ]);
  });

  it("应按难度统计,保持题库首次出现顺序", () => {
    const s = questionStats(bank);
    // bank 的构造顺序是 junior → senior → mid,不是字母序
    expect(s.difficulties).toEqual([
      { id: "junior", count: 1 },
      { id: "senior", count: 1 },
      { id: "mid", count: 1 },
    ]);
  });

  it("空数组应返回零值而非抛错", () => {
    const s = questionStats([]);
    expect(s.total).toBe(0);
    expect(s.industries).toEqual([]);
  });
});

describe("buildSearchIndex", () => {
  it("应能按 id O(1) 查到题", () => {
    const bank = [q({ id: "x1" }), q({ id: "x2" })];
    const idx = buildSearchIndex(bank);
    expect(idx.byId.get("x1")?.id).toBe("x1");
    expect(idx.byId.get("nope")).toBeUndefined();
  });

  it("应建立 industry+type+difficulty 倒排", () => {
    const bank = [
      q({ id: "a", industry: "backend", type: "technical", difficulty: "mid" }),
      q({ id: "b", industry: "backend", type: "coding", difficulty: "senior" }),
    ];
    const idx = buildSearchIndex(bank);
    expect(idx.byFacet.get("backend|technical|mid")?.map((x) => x.id)).toEqual(["a"]);
    expect(idx.byFacet.get("backend|coding|senior")?.map((x) => x.id)).toEqual(["b"]);
  });

  it("应建立标签倒排(归一化后)", () => {
    const bank = [q({ id: "a", tags: ["Java"] }), q({ id: "b", tags: ["java"] })];
    const idx = buildSearchIndex(bank);
    expect(idx.byTag.get("java")?.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });
});

describe("selectQuestions", () => {
  const bank = [
    q({ id: "junior-1", difficulty: "junior", type: "technical" }),
    q({ id: "mid-1", difficulty: "mid", type: "technical" }),
    q({ id: "mid-2", difficulty: "mid", type: "design" }),
    q({ id: "senior-1", difficulty: "senior", type: "technical" }),
  ];

  it("未指定难度时默认 normal,只命中 junior 与 mid", () => {
    const r = selectQuestions(bank, { industry: "backend" });
    expect(r.map((x) => x.id).sort()).toEqual(["junior-1", "mid-1", "mid-2"]);
  });

  it("放宽难度后可返回全部难度的题", () => {
    const r = selectQuestions(bank, { industry: "backend", sessionDifficulty: "hell" });
    expect(r.map((x) => x.id)).toEqual(["senior-1"]);
  });

  it("其他行业的题必须被排除", () => {
    const mixed = [...bank, q({ id: "fe-1", industry: "frontend" })];
    const r = selectQuestions(mixed, { industry: "backend" });
    expect(r.map((x) => x.id)).not.toContain("fe-1");
  });

  it("难度 normal 应命中 junior 与 mid,不命中 senior", () => {
    const r = selectQuestions(bank, { industry: "backend", sessionDifficulty: "normal" });
    const ids = r.map((x) => x.id).sort();
    expect(ids).toEqual(["junior-1", "mid-1", "mid-2"]);
  });

  it("难度 hard 应命中 mid 与 senior", () => {
    const r = selectQuestions(bank, { industry: "backend", sessionDifficulty: "hard" });
    expect(r.map((x) => x.id).sort()).toEqual(["mid-1", "mid-2", "senior-1"]);
  });

  it("难度 hell 应只命中 senior", () => {
    const r = selectQuestions(bank, { industry: "backend", sessionDifficulty: "hell" });
    expect(r.map((x) => x.id)).toEqual(["senior-1"]);
  });

  it("已问过的题必须被排除", () => {
    const r = selectQuestions(bank, {
      industry: "backend",
      sessionDifficulty: "normal",
      excludeIds: ["mid-1"],
    });
    expect(r.map((x) => x.id)).not.toContain("mid-1");
  });

  it("题型过滤应生效", () => {
    const r = selectQuestions(bank, {
      industry: "backend",
      sessionDifficulty: "hard",
      type: "design",
    });
    expect(r.map((x) => x.id)).toEqual(["mid-2"]);
  });

  it("简历技能标签命中的题应排在前面", () => {
    const withTags = [
      q({ id: "nomatch", difficulty: "mid", tags: ["cobol"] }),
      q({ id: "match", difficulty: "mid", tags: ["java", "redis"] }),
    ];
    const r = selectQuestions(withTags, {
      industry: "backend",
      sessionDifficulty: "normal",
      resumeTags: ["java"],
    });
    expect(r[0].id).toBe("match");
  });

  it("高难度时行为题应被加权(依据 Huffcutt et al. 2001)", () => {
    const mixed = [
      q({ id: "tech", difficulty: "senior", type: "technical" }),
      q({ id: "behav", difficulty: "senior", type: "behavioral" }),
    ];
    const r = selectQuestions(mixed, { industry: "backend", sessionDifficulty: "hell" });
    expect(r[0].id).toBe("behav");
  });

  it("低难度时技术题应被加权", () => {
    const mixed = [
      q({ id: "tech", difficulty: "junior", type: "technical" }),
      q({ id: "behav", difficulty: "junior", type: "behavioral" }),
    ];
    const r = selectQuestions(mixed, { industry: "backend", sessionDifficulty: "easy" });
    expect(r[0].id).toBe("tech");
  });

  it("limit 应生效", () => {
    const r = selectQuestions(bank, { industry: "backend", sessionDifficulty: "hard", limit: 2 });
    expect(r).toHaveLength(2);
  });

  it("无可用题时应返回空数组而非抛错", () => {
    const r = selectQuestions(bank, { industry: "nonexistent" });
    expect(r).toEqual([]);
  });

  it("同分时应按 id 稳定排序(保证可复现)", () => {
    const same = [
      q({ id: "b", difficulty: "mid" }),
      q({ id: "a", difficulty: "mid" }),
      q({ id: "c", difficulty: "mid" }),
    ];
    const r1 = selectQuestions(same, { industry: "backend", sessionDifficulty: "normal" });
    const r2 = selectQuestions(same, { industry: "backend", sessionDifficulty: "normal" });
    expect(r1.map((x) => x.id)).toEqual(r2.map((x) => x.id));
  });
});
