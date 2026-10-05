// 雷达图基准数据构造单元测试
// Seam:buildRadarData()(纯函数)
//
// 背景(R22):`EvaluationRadar` 此前是
//   `hasBaseline = Object.keys(baseline).length > 0`   ← 全局判断
//   `benchmark: baseline?.[dim] ?? 0`                 ← 缺失维度填 0
// 后果:只要**任意一个**维度有基准,就画出整条基准线;
// 而没有基准的维度被填成 **0**,在雷达图上塌到原点 ——
// 看起来像"这个维度你历史上一直是 0 分",而真相是"样本不足,没算出来"。
//
// **0 和"无数据"在雷达图上是完全不同的语义**,但视觉上无法区分。
import { describe, it, expect } from "vitest";
import { buildRadarData } from "./radarData";

const DIMS = [
  { dimensionName: "技术深度", score: 4 },
  { dimensionName: "沟通表达", score: 3 },
  { dimensionName: "逻辑思维", score: 5 },
];

describe("buildRadarData", () => {
  it("全部维度有基准时应画出基准线", () => {
    const r = buildRadarData(DIMS, { 技术深度: 3, 沟通表达: 3, 逻辑思维: 4 });
    expect(r.hasBaseline).toBe(true);
    expect(r.data.every((d) => d.benchmark !== null)).toBe(true);
  });

  /*
   * ⭐ 核心:部分维度缺基准时,缺的那几个必须是 null 而不是 0。
   *   否则雷达图上会塌到原点,被读成"历史 0 分"。
   */
  it("部分维度缺基准时应填 null 而非 0", () => {
    const r = buildRadarData(DIMS, { 技术深度: 3 });   // 只给一个维度基准
    expect(r.hasBaseline).toBe(true);
    const byName = Object.fromEntries(r.data.map((d) => [d.dimension, d.benchmark]));
    expect(byName["技术深度"]).toBe(3);
    expect(byName["沟通表达"]).toBeNull();
    expect(byName["逻辑思维"]).toBeNull();
  });

  it("无任何基准时不应画基准线", () => {
    expect(buildRadarData(DIMS, undefined).hasBaseline).toBe(false);
    expect(buildRadarData(DIMS, {}).hasBaseline).toBe(false);
  });

  it("空基准对象不应被误判为有基准", () => {
    const r = buildRadarData(DIMS, {});
    expect(r.hasBaseline).toBe(false);
    expect(r.data.every((d) => d.benchmark === null)).toBe(true);
  });

  it("得分应原样保留", () => {
    const r = buildRadarData(DIMS, {});
    expect(r.data.map((d) => d.score)).toEqual([4, 3, 5]);
  });

  it("应统计缺失基准的维度数供 UI 提示", () => {
    const r = buildRadarData(DIMS, { 技术深度: 3, 沟通表达: 3 });
    expect(r.missingBaselineCount).toBe(1);
  });

  it("空维度数组不应崩溃", () => {
    const r = buildRadarData([], { 技术深度: 3 });
    expect(r.data).toEqual([]);
    expect(r.hasBaseline).toBe(false);
  });

  it("基准值 0 应被视为有效数据(不是缺失)", () => {
    // 历史中位数真的可能是 0(比如某维度一直 0 分),不能被当成"没数据"
    const r = buildRadarData([{ dimensionName: "文化匹配", score: 0 }], { 文化匹配: 0 });
    expect(r.hasBaseline).toBe(true);
    expect(r.data[0].benchmark).toBe(0);
    expect(r.missingBaselineCount).toBe(0);
  });
});
