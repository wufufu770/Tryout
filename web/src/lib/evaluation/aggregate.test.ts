// 评估结果聚合单元测试
// Seam:aggregateScores()(纯函数)—— 6 个独立维度分数 → 单条可入库的评估记录
//
// 为什么需要它:ADR-001 之后总分不再由 LLM 直接给出
// (直接给数字会重新引入锚定偏见 d=0.71,且难以追溯),
// 必须由前端从 6 个独立分数确定性推导 —— 这样总分可被解释、可被复算。
import { describe, it, expect } from "vitest";
import { aggregateScores, scoreWithRetry, type DimensionScore } from "./scoringEngine";
import { EVALUATION_DIMENSIONS } from "./starEvaluator";

/** 构造一个维度分数的测试夹具 */
function ds(key: string, score: number, evidence: string[] = ["引用"]): DimensionScore {
  return {
    dimensionName: EVALUATION_DIMENSIONS.find((d) => d.key === key)!.name,
    matchedAnchorId: score >= 5 ? "A" : score >= 4 ? "B" : score >= 3 ? "C" : score >= 2 ? "D" : "E",
    score,
    evidence,
    confidence: "high",
    noEvidence: evidence.length === 0,
  };
}

describe("aggregateScores", () => {
  it("应返回全部 6 个维度", () => {
    const r = aggregateScores(EVALUATION_DIMENSIONS.map((d) => ds(d.key, 3)));
    expect(r.dimensions).toHaveLength(6);
  });

  it("总分应由 6 个分数的算术平均推导,再映射到 1-10 分制", () => {
    const scores = [5, 4, 3, 2, 1, 5];        // 和 = 20,均值 = 3.333(1-5 量纲)
    const r = aggregateScores(EVALUATION_DIMENSIONS.map((d, i) => ds(d.key, scores[i])));
    // 3.333 × 2 = 6.667 → 保留一位小数 = 6.7
    // ⚠️ 总分量纲是 1-10(既有 UI 的 EvaluationRadar 与 PEER_BENCHMARK 都在这个量纲),
    //    不是 1-5。若按 1-5 输出会与历史数据不可比。
    expect(r.overallScore).toBeCloseTo(((20 / 6) * 2), 1);
  });

  it("总分应保留一位小数(与既有 UI 的 1-10 分制兼容)", () => {
    const r = aggregateScores(EVALUATION_DIMENSIONS.map((d) => ds(d.key, 4)));
    // 4*6/6 = 4.0 → 映射到 1-10 分制 = 8.0
    expect(r.overallScore).toBe(8);
  });

  it("总分应放大到 1-10 分制(既有 UI 与 PEER_BENCHMARK 都是 1-10)", () => {
    const r = aggregateScores(EVALUATION_DIMENSIONS.map((d) => ds(d.key, 3)));
    expect(r.overallScore).toBe(6); // 3 → 6
  });

  it("无证据的维度应被标记,供 UI 降权提示", () => {
    const list = EVALUATION_DIMENSIONS.map((d, i) =>
      i === 0 ? ds(d.key, 5, []) : ds(d.key, 3)
    );
    const r = aggregateScores(list);
    expect(r.noEvidenceCount).toBe(1);
    expect(r.dimensions[0].noEvidence).toBe(true);
  });

  it("缺维度时应按 0 分计入并标记缺失(不得静默平均掉)", () => {
    // 5 个 4 分 + 1 个缺失。若只对已有的 5 个取平均 = 4(1-5 量纲)→ 8(1-10),
    // 会把"评不全"伪装成"评得好"。按 0 分计入:20/6=3.33 → 6.7。
    const list = EVALUATION_DIMENSIONS.slice(0, 5).map((d) => ds(d.key, 4));
    const r = aggregateScores(list);
    expect(r.overallScore).toBeCloseTo(((20 / 6) * 2), 1);
    expect(r.missingCount).toBe(1);
  });

  // R44 变异测试 V04 发现的盲区:
  // 上面那条只断言了 missingCount 与总分,**没有断言缺失维度自己的 score**。
  // 于是把 `score: 0` 改成 `score: 1`(等于 E 锚点)时,测试照样全绿 ——
  // 而这恰恰是 R36~R41 反复分析的那个关键值(0 分比 E 的 1 分还低,会把好答案拽下一档)。
  it("缺失维度的 score 必须是 0,不是 E 锚点的 1(变异测试 V04 的回归防护)", () => {
    const list = EVALUATION_DIMENSIONS.slice(0, 5).map((d) => ds(d.key, 4));
    const r = aggregateScores(list);
    // 缺的那个维度 key 应存在(占位),且分数必须严格为 0
    const missing = r.dimensions.filter((d) => !list.some((s) => s.dimensionName === d.dimensionName));
    expect(missing).toHaveLength(1);
    expect(missing[0].score).toBe(0);
    // 全部缺失时同理:每个占位都必须是 0
    const all = aggregateScores([]);
    expect(all.dimensions.every((d) => d.score === 0)).toBe(true);
  });

  it("全部缺失时总分应为 0 而不是 NaN", () => {
    const r = aggregateScores([]);
    expect(r.overallScore).toBe(0);
    expect(r.missingCount).toBe(6);
    expect(Number.isNaN(r.overallScore)).toBe(false);
  });

  it("汇总结果应可用于生成可解释的 overall 说明", () => {
    const list = EVALUATION_DIMENSIONS.map((d, i) => ds(d.key, i < 3 ? 5 : 2));
    const r = aggregateScores(list);
    expect(r.overallSummary).toBeTruthy();
    expect(r.overallSummary).toContain("强项");   // 满分维度
    expect(r.overallSummary).toContain("弱项");   // 低分维度
  });

  it("strengths / weaknesses 应按分数排序", () => {
    const scores = [1, 2, 3, 4, 5, 5];
    const r = aggregateScores(EVALUATION_DIMENSIONS.map((d, i) => ds(d.key, scores[i])));
    expect(r.strengths[0].score).toBeGreaterThanOrEqual(r.strengths[1].score);
    expect(r.weaknesses[0].score).toBeLessThanOrEqual(r.weaknesses[1].score);
  });
});

describe("scoreWithRetry", () => {
  it("首次成功不应重试", async () => {
    let calls = 0;
    const deps = {
      chat: async () => {
        calls++;
        return { content: JSON.stringify({ matched_anchor_id: "C", evidence: ["x"], confidence: "high" }) };
      },
    };
    const r = await scoreWithRetry(EVALUATION_DIMENSIONS[0], "q", "a", undefined, "p", 1, deps);
    expect(r).not.toBeNull();
    expect(r!.score).toBe(3);
    expect(calls).toBe(1);
  });

  it("解析失败应重试一次", async () => {
    let calls = 0;
    const deps = {
      chat: async () => {
        calls++;
        if (calls === 1) return { content: "{broken" };   // 第一次坏
        return { content: JSON.stringify({ matched_anchor_id: "A", evidence: ["y"], confidence: "high" }) };
      },
    };
    const r = await scoreWithRetry(EVALUATION_DIMENSIONS[0], "q", "a", undefined, "p", 2, deps);
    expect(r).not.toBeNull();
    expect(r!.score).toBe(5);
    expect(calls).toBe(2);
  });

  it("重试用尽后应返回 null 而不是抛异常", async () => {
    const deps = { chat: async () => ({ content: "still broken" }) };
    const r = await scoreWithRetry(EVALUATION_DIMENSIONS[0], "q", "a", undefined, "p", 3, deps);
    expect(r).toBeNull();
  });

  it("网络异常应被吞掉并计入重试(不让单维度失败拖垮整批)", async () => {
    let calls = 0;
    const deps = {
      chat: async () => {
        calls++;
        throw new Error("network down");
      },
    };
    const r = await scoreWithRetry(EVALUATION_DIMENSIONS[0], "q", "a", undefined, "p", 2, deps);
    expect(r).toBeNull();
    expect(calls).toBe(2);
  });

  it("重试上限为 1 时不得重试", async () => {
    let calls = 0;
    const deps = { chat: async () => { calls++; return { content: "{bad" }; } };
    await scoreWithRetry(EVALUATION_DIMENSIONS[0], "q", "a", undefined, "p", 1, deps);
    expect(calls).toBe(1);
  });
});
