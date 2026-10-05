// 题库内容聚合单元测试
// Seam:aggregateByTag() / buildFaqEntry() / pickHotTags()(纯函数)
//
// 背景(W5-4):808 道题带参考答案,是**唯一带参考答案的面试题资产**。
// 但它目前只存在于站内浏览页 —— 想用 AI 搜"后端 面试题 参考答案"的人找不到它。
// Stack Overflow 2025:87% 的开发者用 AI 搜索答案。
// 这一层把题库变成**可被外部检索的独立内容**:按高频知识点聚合成 FAQ 条目。
//
// 设计要点:走"统计数据 + 结构化"路线,不堆关键词。
// 理由:AI 检索偏好包含具体统计数字与结构化表格的内容;
// 而纯关键词堆砌反而降低可信度(内容农场特征)。
import { describe, it, expect } from "vitest";
import { aggregateByTag, pickHotTags, buildFaqEntry, type QuestionLite } from "./bankAggregator";

const q = (id: string, over: Partial<QuestionLite> = {}): QuestionLite => ({
  id, industry: "backend", type: "technical", difficulty: "mid",
  title: `题目 ${id}`, content: "内容",
  keyPoints: ["知识点A", "知识点B"], tags: ["Java", "集合"],
  estimatedMinutes: 8, ...over,
});

describe("aggregateByTag", () => {
  it("应把同一标签的题聚合到一条", () => {
    const bank = [q("a", { tags: ["Java"] }), q("b", { tags: ["Java"] }), q("c", { tags: ["Rust"] })];
    const agg = aggregateByTag(bank);
    expect(agg.get("Java")?.questions).toHaveLength(2);
    // Rust 只有 1 道 —— 单题标签无聚合价值,按设计被剔除
    expect(agg.get("Rust")).toBeUndefined();
  });

  it("达到阈值的单标签应被保留", () => {
    const bank = [q("a", { tags: ["Java"] }), q("b", { tags: ["Java"] }), q("c", { tags: ["Rust"] })];
    const agg = aggregateByTag(bank, { minQuestions: 1 });
    expect(agg.get("Rust")?.questions).toHaveLength(1);
  });

  it("单题标签应剔除(无聚合价值)", () => {
    const bank = [q("a", { tags: ["Java", "冷门标签X"] }), q("b", { tags: ["Java"] })];
    const agg = aggregateByTag(bank);
    expect(agg.has("冷门标签X")).toBe(false);
  });

  it("应支持自定义最小题数阈值", () => {
    const bank = [q("a", { tags: ["Java"] }), q("b", { tags: ["Rust"] }), q("c", { tags: ["Go"] })];
    const agg = aggregateByTag(bank, { minQuestions: 1 });
    expect(agg.size).toBe(3);
  });

  it("空题库应返回空 Map", () => {
    expect(aggregateByTag([]).size).toBe(0);
  });

  it("无标签的题不应产生脏数据", () => {
    const agg = aggregateByTag([q("a", { tags: [] })]);
    expect(agg.size).toBe(0);
  });
});

describe("pickHotTags", () => {
  const bank = Array.from({ length: 10 }, (_, i) =>
    q(`q${i}`, { tags: i < 6 ? ["Java"] : i < 8 ? ["Redis"] : ["冷门"] })
  );

  it("应按题数降序返回高频标签", () => {
    const hot = pickHotTags(bank, 5);
    expect(hot[0].tag).toBe("Java");
    expect(hot[0].count).toBe(6);
  });

  it("应只保留达到阈值的标签", () => {
    const hot = pickHotTags(bank, 10, { minQuestions: 5 });
    expect(hot.map((h) => h.tag)).toEqual(["Java"]);
  });

  it("应限制返回数量", () => {
    expect(pickHotTags(bank, 1)).toHaveLength(1);
  });

  it("同题数时应按标签名稳定排序(保证可复现)", () => {
    const tie = [q("a", { tags: ["Zebra"] }), q("b", { tags: ["Apple"] })];
    const hot = pickHotTags(tie, 10, { minQuestions: 1 });
    expect(hot.map((h) => h.tag)).toEqual(["Apple", "Zebra"]);
  });

  it("空题库应返回空数组", () => {
    expect(pickHotTags([], 10)).toEqual([]);
  });
});

describe("buildFaqEntry", () => {
  const bank = [
    q("a", { title: "A 题", keyPoints: ["共享", "缓存"], tags: ["Java"] }),
    q("b", { title: "B 题", keyPoints: ["共享"], tags: ["Java"] }),
  ];
  const agg = aggregateByTag(bank);
  const entry = buildFaqEntry("Java", agg.get("Java")!);

  it("应生成可直接用于内容页的条目", () => {
    expect(entry.tag).toBe("Java");
    expect(entry.questionCount).toBe(2);
    expect(entry.url).toContain("Java");
  });

  it("应包含高频考点(跨题去重后的交集)", () => {
    // a 和 b 都有"共享" -> 交集里的"共享"才是真高频
    expect(entry.hotPoints).toContain("共享");
  });

  it("每题应包含标题与要点(供 AI 摘取)", () => {
    expect(entry.questions).toHaveLength(2);
    expect(entry.questions[0].title).toBeTruthy();
  });

  it("不应包含参考答案(避免变成可背诵的答案集)", () => {
    // ⚠️ 这是本项目的核心资产,不能泄进内容页 ——
    // 用户背答案就没有练习意义了。内容页只给题目与考点。
    expect(JSON.stringify(entry)).not.toContain("referenceAnswer");
  });

  it("应给出结构化摘要(供 AI 直接引用)", () => {
    // 单题标签需把阈值降到 1 才能进入聚合
    const g = aggregateByTag([q("x"), q("y")], { minQuestions: 1 }).get("Java")!;
    const e = buildFaqEntry("Java", g);
    expect(e.summary).toBeTruthy();
    expect(e.summary).toContain("Java");
    expect(e.summary).toMatch(/参考答案仅用于评估|不对外公开/);
  });
});
