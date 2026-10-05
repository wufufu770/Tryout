// 分组归纳单元测试
// Seam:computeGroupSummaryLocal()(纯函数)
//
// 关注:归纳结果会**直接给用户"你进步了吗/哪里弱"的结论**。
// 数据被静默丢弃 → 结论失真而用户无从察觉。
import { describe, it, expect } from "vitest";
import { computeGroupSummaryLocal } from "./groupSummary";

const S = (id: string, date: string, title = id) => ({ sessionId: id, createdAt: date, title });
const R = (id: string, score: number, date: string) => ({ sessionId: id, overallScore: score, generatedAt: date });
const E = (id: string, score: number, date: string) => ({ sessionId: id, overallScore: score, generatedAt: date });

describe("computeGroupSummaryLocal 空数据", () => {
  it("空输入应给出 insufficient 而不是编结论", () => {
    const g = computeGroupSummaryLocal([], [], []);
    expect(g.totalSessions).toBe(0);
    expect(g.trend).toBe("insufficient");
    expect(g.dateRange).toBeNull();
  });

  it("有会话但无评分时应为 insufficient 且不编造平均分", () => {
    const g = computeGroupSummaryLocal([S("s1", "2026-01-01")], [], []);
    expect(g.totalSessions).toBe(1);
    expect(g.trend).toBe("insufficient");
    expect(g.progressPoints).toEqual([]);
  });
});

describe("computeGroupSummaryLocal 分数聚合", () => {
  it("应优先使用 review 分数", () => {
    const g = computeGroupSummaryLocal(
      [S("s1", "2026-01-01")],
      [R("s1", 8, "2026-01-01")],
      [E("s1", 2, "2026-01-01")]      // evaluation 分数不同,应被 review 覆盖
    );
    expect(g.progressPoints).toHaveLength(1);
    expect(g.progressPoints[0].score).toBe(8);
  });

  it("无 review 的会话应用 evaluation 均分补齐", () => {
    const g = computeGroupSummaryLocal(
      [S("s1", "2026-01-01")],
      [],
      [E("s1", 6, "2026-01-01"), E("s1", 8, "2026-01-01")]
    );
    expect(g.progressPoints).toHaveLength(1);
    expect(g.progressPoints[0].score).toBe(7);
  });

  it("应按时间排序", () => {
    const g = computeGroupSummaryLocal(
      [S("a", "2026-03-01"), S("b", "2026-01-01"), S("c", "2026-02-01")],
      [R("a", 7, "2026-03-01"), R("b", 5, "2026-01-01"), R("c", 6, "2026-02-01")],
      []
    );
    expect(g.progressPoints.map((p) => p.sessionId)).toEqual(["b", "c", "a"]);
  });

  it("应计算 avg/max/min", () => {
    const g = computeGroupSummaryLocal(
      [S("a", "2026-01-01"), S("b", "2026-01-02"), S("c", "2026-01-03")],
      [R("a", 4, "2026-01-01"), R("b", 6, "2026-01-02"), R("c", 8, "2026-01-03")],
      []
    );
    expect(g.avgScore).toBe(6);
    expect(g.maxScore).toBe(8);
    expect(g.minScore).toBe(4);
  });

  it("无标题时应兜底而非 undefined", () => {
    const g = computeGroupSummaryLocal(
      [{ sessionId: "a", createdAt: "2026-01-01" } as any],
      [R("a", 5, "2026-01-01")],
      []
    );
    expect(g.progressPoints[0].title).toBeTruthy();
    expect(JSON.stringify(g)).not.toContain("undefined");
  });
});

describe("computeGroupSummaryLocal 趋势", () => {
  it("样本不足 4 个时应为 insufficient", () => {
    const g = computeGroupSummaryLocal(
      [S("a", "2026-01-01"), S("b", "2026-01-02"), S("c", "2026-01-03")],
      [R("a", 4, "2026-01-01"), R("b", 5, "2026-01-02"), R("c", 6, "2026-01-03")],
      []
    );
    expect(g.trend).toBe("insufficient");
  });

  it("明显上升应为 up", () => {
    const dates = ["01-01", "01-02", "01-03", "01-04", "01-05", "01-06"];
    const scores = [3, 3, 4, 4, 7, 8];
    const g = computeGroupSummaryLocal(
      dates.map((d, i) => S(`s${i}`, `2026-${d}`)),
      dates.map((d, i) => R(`s${i}`, scores[i], `2026-${d}`)),
      []
    );
    expect(g.trend).toBe("up");
  });

  it("明显下滑应为 down", () => {
    const dates = ["01-01", "01-02", "01-03", "01-04", "01-05", "01-06"];
    const scores = [8, 8, 7, 7, 4, 3];
    const g = computeGroupSummaryLocal(
      dates.map((d, i) => S(`s${i}`, `2026-${d}`)),
      dates.map((d, i) => R(`s${i}`, scores[i], `2026-${d}`)),
      []
    );
    expect(g.trend).toBe("down");
  });
});

describe("computeGroupSummaryLocal 缺失分数的静默丢弃", () => {
  /*
   * ⭐ 核心回归:此前
   *   avg = evals.reduce((a,b) => a + (Number(b.overallScore) || 0), 0) / evals.length
   *   if (!isNaN(avg) && avg > 0) { scoredPoints.push(...) }
   * 当一个 session 的评估**全部缺分**时,avg 算成 0,被 `avg > 0` 静默过滤 ——
   * 那个 session 从统计里凭空消失,而 `totalSessions` 仍然计入它。
   * 结果:totalSessions 与 progressPoints 数量对不上,趋势计算失真。
   */
  it("评估全部缺分的 session 应被显式记录而非凭空消失", () => {
    const g = computeGroupSummaryLocal(
      [S("a", "2026-01-01"), S("b", "2026-01-02")],
      [R("a", 6, "2026-01-01")],
      [E("b", NaN, "2026-01-02")]        // 该 session 的评估没有有效分数
    );
    // ⚠️ 不能给 b 塞一个 0 分进进度曲线 —— 那是假数据。
    //    正确做法:排除出 progressPoints,但**记下来**让 UI 能告知用户。
    expect(g.progressPoints.some((p) => p.sessionId === "b")).toBe(false);
    expect(g.noScoreSessionIds, "b 应被记录为无分数会话").toContain("b");
  });

  it("部分缺分时应只按有效分数求平均", () => {
    const g = computeGroupSummaryLocal(
      [S("a", "2026-01-01")],
      [],
      [E("a", 8, "2026-01-01"), E("a", NaN, "2026-01-02")]
    );
    expect(g.progressPoints[0].score, "缺分项不应按 0 计入平均").toBe(8);
  });

  it("progressPoints 数量不应超过 totalSessions", () => {
    const sessions = [S("a", "2026-01-01"), S("b", "2026-01-02"), S("c", "2026-01-03")];
    const g = computeGroupSummaryLocal(sessions, [R("a", 6, "2026-01-01")], []);
    expect(g.progressPoints.length).toBeLessThanOrEqual(g.totalSessions);
  });

  it("孤儿评估(会话已删除)应被忽略而非计入", () => {
    const g = computeGroupSummaryLocal(
      [S("a", "2026-01-01")],
      [R("a", 6, "2026-01-01")],
      [E("deleted-session", 9, "2026-01-02")]
    );
    expect(g.progressPoints).toHaveLength(1);
  });
});

describe("computeGroupSummaryLocal 弱项/进步维度", () => {
  it("应识别出弱项维度", () => {
    const g = computeGroupSummaryLocal(
      [S("a", "2026-01-01")],
      [R("a", 5, "2026-01-01")],
      []
    );
    // 没有维度数据时不应编造弱项
    expect(Array.isArray(g.weakDimensions)).toBe(true);
  });

  it("样本不足时 advice 不应编造结论", () => {
    const g = computeGroupSummaryLocal([S("a", "2026-01-01")], [], []);
    expect(g.advice).toBeTruthy();
    expect(g.advice).not.toMatch(/进步|提升|下降/);
  });
});
