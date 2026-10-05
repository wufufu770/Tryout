// 热力图数据单元测试
// Seam:buildHeatmapData()(纯函数,时间相关)
//
// 关注两个真实风险:
//   1. **时区偏移** —— `new Date("2026-01-01")` 按 UTC 解析,
//      在 UTC+8 的机器上 `getDate()` 会返回 1(前一天的本地日期),
//      活动会被记到错误的一天。跨年时更明显。
//   2. **跨年补全** —— 53 周 = 371 天,可能跨年,
//      `formatYMD` 若用错年份会出现"12 月之后回到 1 月"的错位。
import { describe, it, expect } from "vitest";
import { buildHeatmapData, type HeatmapDay } from "./heatmapData";

/** 相对今天的偏移天数,避免测试随日期失效 */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 在结果里定位某一天。
 * ⚠️ 窗口是**整周对齐**的(末位为本周周日),会包含最多 6 天未来日期 ——
 *    这是 GitHub 贡献图的标准行为,`Heatmap.tsx` 用 `future: date > today` 专门渲染。
 *    所以**不能取 r[r.length-1] 当作"今天"**。
 */
function findDay(r: HeatmapDay[], date: string): HeatmapDay | undefined {
  return r.find((d) => d.date === date);
}

describe("buildHeatmapData 基础", () => {
  it("应返回 53 周 = 371 天", () => {
    expect(buildHeatmapData([])).toHaveLength(53 * 7);
  });

  it("空输入应全为 0", () => {
    expect(buildHeatmapData([]).every((d) => d.count === 0)).toBe(true);
  });

  it("有分数的评估应记入正确的一天", () => {
    const r = buildHeatmapData([{ generatedAt: new Date().toISOString(), overallScore: 5 }]);
    const today = findDay(r, daysAgo(0))!;
    expect(today.count).toBe(1);
    expect(today.score).toBe(5);
  });

  it("缺分数的评估不应产生 0 分(而是 undefined)", () => {
    const r = buildHeatmapData([{ generatedAt: new Date().toISOString() }]);
    const today = findDay(r, daysAgo(0))!;
    expect(today.count).toBe(1);
    expect(today.score).toBeUndefined();
  });
});

describe("buildHeatmapData 聚合", () => {
  it("同一天多条应聚合为 count 与平均分", () => {
    const iso = new Date().toISOString();
    const r = buildHeatmapData([
      { generatedAt: iso, overallScore: 6 },
      { generatedAt: iso, overallScore: 8 },
    ]);
    const today = findDay(r, daysAgo(0))!;
    expect(today.count).toBe(2);
    expect(today.score).toBe(7);
  });

  it("部分评估有分数时,平均分只算有分数的", () => {
    const iso = new Date().toISOString();
    const r = buildHeatmapData([
      { generatedAt: iso, overallScore: 8 },
      { generatedAt: iso },                       // 无分数
    ]);
    const today = findDay(r, daysAgo(0))!;
    expect(today.count).toBe(2);
    expect(today.score).toBe(8);                  // 不是 (8+0)/2
  });

  it("非法日期应被跳过而非污染", () => {
    const r = buildHeatmapData([
      { generatedAt: "不是日期", overallScore: 5 },
      { generatedAt: new Date().toISOString(), overallScore: 5 },
    ]);
    expect(findDay(r, daysAgo(0))!.count).toBe(1);
  });

  it("NaN 分数应被忽略", () => {
    const r = buildHeatmapData([
      { generatedAt: new Date().toISOString(), overallScore: NaN },
    ]);
    expect(findDay(r, daysAgo(0))!.score).toBeUndefined();
  });
});

describe("buildHeatmapData 时区与跨年", () => {
  /*
   * ⭐ 关键回归:纯日期字符串 "2026-03-15" 在 JS 里按 **UTC** 解析。
   * 若聚合时用本地 getDate(),东八区机器会记成 3 月 14 日,
   * 热力图上"今天练了"会显示在昨天 —— 而用户完全无从察觉。
   */
  it("纯日期字符串应落在正确的一天(不受时区影响)", () => {
    const todayStr = daysAgo(0);
    const [y, m, d] = todayStr.split("-").map(Number);
    const r = buildHeatmapData([{ generatedAt: todayStr, overallScore: 7 }]);
    const hit = r.find((x) => x.count === 1);
    expect(hit, "应找到被计数的那天").toBeTruthy();
    const [hy, hm, hd] = hit!.date.split("-").map(Number);
    expect([hy, hm, hd], "日期被时区偏移了").toEqual([y, m, d]);
  });

  it("53 周窗口应覆盖一年前(日期单调递增)", () => {
    const r: HeatmapDay[] = buildHeatmapData([]);
    for (let i = 1; i < r.length; i++) {
      expect(r[i].date > r[i - 1].date, `第 ${i} 天未递增:${r[i - 1].date} → ${r[i].date}`).toBe(true);
    }
  });

  /*
   * ⚠️ 窗口是**整周对齐**的,末位为本周周日,必然包含未来日期(最多 6 天)。
   *    这是 GitHub 贡献图的标准行为,不是 bug ——
   *    `Heatmap.tsx` 用 `future: date > today` 专门渲染未来格子。
   *    所以这里断言"未来日期存在且不多于 6 天",而不是"不存在"。
   */
  it("整周对齐:末位为本周周日,未来日期不超过 6 天", () => {
    const r = buildHeatmapData([]);
    const last = new Date(r[r.length - 1].date + "T00:00:00");
    expect(last.getDay(), "热力图每列应为周一到周日").toBe(0);
    const today = new Date(daysAgo(0) + "T00:00:00");
    const futureDays = Math.round((last.getTime() - today.getTime()) / 86400000);
    expect(futureDays, "未来日期最多 6 天(本周剩余)").toBeGreaterThanOrEqual(0);
    expect(futureDays, "未来日期最多 6 天(本周剩余)").toBeLessThanOrEqual(6);
  });
});
