// 一致性度量单元测试
// Seam:dimensionConsistency() / compareConsistency()(纯函数)
//
// 用途:把 V6「单维度评分一致率 >= 85%」变成可计算的指标。
// 度量方式采用**两两比较**:同一组输入跑 N 次,任取两次比较该维度分数是否相同,
// 一致率 = 相同对数 / 总对数。选它而不是"众数占比"或"标准差",因为:
//   - 对 N=3 同样有效(3 对),而众数占比在 N=3 时退化
//   - 分数是 1-5 的序数量,均值/方差没有直觉意义
//   - 两两一致率直接回答"换个模型试试会不会翻盘"这个真实问题
import { describe, it, expect } from "vitest";
import { dimensionConsistency, compareConsistency, summarizeRuns } from "./consistency";

describe("dimensionConsistency", () => {
  it("全部相同应返回 1", () => {
    expect(dimensionConsistency([3, 3, 3])).toBe(1);
  });

  it("全部不同(N=3)应返回 0", () => {
    expect(dimensionConsistency([1, 3, 5])).toBe(0);
  });

  it("N=3 时 2 次相同 1 次不同 → 3 对中仅 1 对相同", () => {
    // [3,3,5] 的两两组合:(3,3)相同、(3,5)不同、(3,5)不同 → 1/3
    // ⚠️ 容易算错:重复出现的那两次之间是"相同"的,不是"不同"的。
    expect(dimensionConsistency([3, 3, 5])).toBeCloseTo(1 / 3, 5);
  });

  it("N=1 时无对可比较,应返回 1(不退化为 0)", () => {
    // 语义:只有一次观测,没有不一致的证据。若返回 0 会让单次运行被误判为"不稳定"
    expect(dimensionConsistency([4])).toBe(1);
  });

  it("空数组应返回 1(不制造假的不一致)", () => {
    expect(dimensionConsistency([])).toBe(1);
  });

  it("N=4 时应比较 6 对", () => {
    // (1,1,1,4): 3 对相同 + 3 对不同 = 3/6 = 0.5
    expect(dimensionConsistency([1, 1, 1, 4])).toBeCloseTo(0.5, 5);
  });

  it("应忽略非法分数(NaN/null/undefined)", () => {
    // LLM 解析失败时聚合层给的是 0,但度量层只关心有效数字
    expect(dimensionConsistency([3, 3, 3])).toBe(1);
  });
});

describe("summarizeRuns", () => {
  it("应按维度名聚合多次运行的结果", () => {
    // runs: [第1次, 第2次, 第3次]
    const runs = [
      { "技术深度": 3, "沟通表达": 4 },
      { "技术深度": 3, "沟通表达": 2 },
      { "技术深度": 5, "沟通表达": 4 },
    ];
    const r = summarizeRuns(runs);
    // [3,3,5] → (3,3)同 (3,5)异 (3,5)异 = 1/3
    expect(r["技术深度"].scores).toEqual([3, 3, 5]);
    expect(r["技术深度"].consistency).toBeCloseTo(1 / 3, 5);
    // [4,2,4] → (4,2)异 (4,4)同 (2,4)异 = 1/3
    expect(r["沟通表达"].scores).toEqual([4, 2, 4]);
    expect(r["沟通表达"].consistency).toBeCloseTo(1 / 3, 5);
  });

  it("应给出每个维度的均值", () => {
    const r = summarizeRuns([{ d: 3 }, { d: 4 }, { d: 5 }]);
    expect(r["d"].mean).toBe(4);
  });

  it("维度在某次运行中缺席时,只比较出现过的次数", () => {
    const r = summarizeRuns([{ d: 3 }, { d: 3 }, {}]);
    // 只有 2 次有效观测,两者一致
    expect(r["d"].consistency).toBe(1);
    expect(r["d"].sampleCount).toBe(2);
  });

  it("完全缺席的维度不应出现在结果中", () => {
    const r = summarizeRuns([{ a: 3 }, { a: 3 }]);
    expect(r["b"]).toBeUndefined();
  });
});

describe("compareConsistency", () => {
  it("应比较两个模式在同一维度集合上的表现", () => {
    const a = summarizeRuns([{ d: 3 }, { d: 3 }, { d: 3 }]);
    const b = summarizeRuns([{ d: 3 }, { d: 5 }, { d: 1 }]);
    const cmp = compareConsistency({ isolated: a, joint: b });
    expect(cmp["d"].isolated).toBe(1);
    expect(cmp["d"].joint).toBe(0);
    expect(cmp["d"].delta).toBe(1);
  });

  it("应给出总体均值(跨全部维度)", () => {
    const a = summarizeRuns([{ d: 3 }, { d: 3 }, { d: 3 }, { e: 4 }, { e: 4 }, { e: 4 }]);
    const b = summarizeRuns([{ d: 1 }, { d: 5 }, { d: 2 }, { e: 1 }, { e: 5 }, { e: 2 }]);
    const cmp = compareConsistency({ isolated: a, joint: b });
    expect(cmp.overall.isolated).toBe(1);
    expect(cmp.overall.joint).toBe(0);
    expect(cmp.overall.delta).toBe(1);
  });

  it("某模式缺少的维度不应污染总体均值", () => {
    const a = summarizeRuns([{ d: 3 }, { d: 3 }, { d: 3 }, { e: 4 }, { e: 4 }, { e: 4 }]);
    const b = summarizeRuns([{ d: 1 }, { d: 5 }, { d: 2 }]);   // 只有 d
    const cmp = compareConsistency({ isolated: a, joint: b });
    // 只比较双方都有的 d
    expect(cmp.overall.joint).toBe(0);
    expect(cmp["e"]).toBeUndefined();
  });

  it("两侧都为空时不应返回 NaN", () => {
    const cmp = compareConsistency({ isolated: {}, joint: {} });
    expect(Number.isNaN(cmp.overall.isolated)).toBe(false);
    expect(cmp.overall.isolated).toBe(1);
  });
});
