// 个人基准单元测试
// Seam:computePersonalBaseline() / compareToBaseline() / shouldShowBaseline()(纯函数)
//
// P2-4 的核心:把"硬编码 3.5 标为同岗位平均"换成
// "用户自己的历史中位数" —— 数据真实、对用户有意义、冷启动不误导。
import { describe, it, expect } from "vitest";
import { computePersonalBaseline, compareToBaseline, shouldShowBaseline } from "./baseline";

describe("computePersonalBaseline", () => {
  it("无历史应返回空对象", () => {
    expect(computePersonalBaseline([])).toEqual({});
  });

  it("样本不足 3 条时不给基准(3 个点的中位数没统计意义)", () => {
    const h = [[{ dimensionName: "技术深度", score: 3 }], [{ dimensionName: "技术深度", score: 4 }]];
    expect(computePersonalBaseline(h)).toEqual({});
  });

  it("样本足够时应返回中位数", () => {
    const h = [
      [{ dimensionName: "技术深度", score: 2 }],
      [{ dimensionName: "技术深度", score: 4 }],
      [{ dimensionName: "技术深度", score: 5 }],
    ];
    expect(computePersonalBaseline(h)["技术深度"]).toBe(4);
  });

  it("偶数个样本应取中间两个的均值", () => {
    const h = [
      [{ dimensionName: "技术深度", score: 2 }],
      [{ dimensionName: "技术深度", score: 3 }],
      [{ dimensionName: "技术深度", score: 4 }],
      [{ dimensionName: "技术深度", score: 5 }],
    ];
    expect(computePersonalBaseline(h)["技术深度"]).toBe(3.5);
  });

  it("各维度应独立计算", () => {
    const h = [
      [{ dimensionName: "技术深度", score: 5 }, { dimensionName: "沟通表达", score: 2 }],
      [{ dimensionName: "技术深度", score: 5 }, { dimensionName: "沟通表达", score: 2 }],
      [{ dimensionName: "技术深度", score: 5 }, { dimensionName: "沟通表达", score: 2 }],
    ];
    const b = computePersonalBaseline(h);
    expect(b["技术深度"]).toBe(5);
    expect(b["沟通表达"]).toBe(2);
  });

  it("非法分数应被跳过而非污染中位数", () => {
    const h = [
      [{ dimensionName: "技术深度", score: 3 }],
      [{ dimensionName: "技术深度", score: 4 }],
      [{ dimensionName: "技术深度", score: 4 }],
      [{ dimensionName: "技术深度", score: NaN }],
    ];
    expect(computePersonalBaseline(h)["技术深度"]).toBe(4);
  });

  it("不得返回全维度同值的假基准", () => {
    // PEER_BENCHMARK 的原始症状:所有维度都是 3.5。
    // 个人基准必须因维度而异 —— 否则又是一个编出来的常数。
    // ⚠️ 样本要 >= 3,否则会因样本不足而返回空对象(那是另一个正确的行为)。
    const h = [
      [{ dimensionName: "a", score: 1 }, { dimensionName: "b", score: 5 }],
      [{ dimensionName: "a", score: 1 }, { dimensionName: "b", score: 5 }],
      [{ dimensionName: "a", score: 1 }, { dimensionName: "b", score: 5 }],
    ];
    const vals = Object.values(computePersonalBaseline(h));
    expect(vals.length).toBe(2);
    expect(new Set(vals).size).toBeGreaterThan(1);
  });

  it("样本不足时返回空对象而非假基准", () => {
    const h = [[{ dimensionName: "a", score: 1 }, { dimensionName: "b", score: 5 }]];
    expect(computePersonalBaseline(h)).toEqual({});
  });
});

describe("compareToBaseline", () => {
  const base = { 技术深度: 4 };

  it("高于基准应返回 above", () => {
    expect(compareToBaseline("技术深度", 5, base)).toBe("above");
  });

  it("低于基准应返回 below", () => {
    expect(compareToBaseline("技术深度", 2, base)).toBe("below");
  });

  it("持平应返回 on", () => {
    expect(compareToBaseline("技术深度", 4, base)).toBe("on");
  });

  it("无该维度基准时应返回 null(UI 应隐藏)", () => {
    expect(compareToBaseline("沟通表达", 3, base)).toBeNull();
  });

  it("空基准表应返回 null 而非崩溃", () => {
    expect(compareToBaseline("技术深度", 3, {})).toBeNull();
  });
});

describe("shouldShowBaseline", () => {
  it("0-2 次评估不应展示", () => {
    expect(shouldShowBaseline(0)).toBe(false);
    expect(shouldShowBaseline(2)).toBe(false);
  });

  it("3 次及以上应展示", () => {
    expect(shouldShowBaseline(3)).toBe(true);
    expect(shouldShowBaseline(50)).toBe(true);
  });
});
