// 整场回顾解析单元测试
// Seam:parseReviewResult()(纯函数)
import { describe, it, expect } from "vitest";
import { parseReviewResult, buildReviewPrompt } from "./reviewGenerator";

const FULL = {
  overallScore: 7.5,
  strengths: ["原理清晰"],
  weaknesses: ["缺边界条件讨论"],
  improvements: [{ area: "边界", suggestion: "多问异常场景", priority: "high" }],
  performance: "整体不错",
  nextFocus: "系统设计",
};

describe("parseReviewResult 正常解析", () => {
  it("应解析完整 JSON", () => {
    const r = parseReviewResult(JSON.stringify(FULL));
    expect(r!.overallScore).toBe(7.5);
    expect(r!.strengths).toEqual(["原理清晰"]);
    expect(r!.improvements).toHaveLength(1);
  });

  it("应容忍 ```json 围栏", () => {
    const r = parseReviewResult("```json\n" + JSON.stringify(FULL) + "\n```");
    expect(r!.overallScore).toBe(7.5);
  });

  it("应容忍前后噪声文本", () => {
    const r = parseReviewResult("评价如下：\n" + JSON.stringify(FULL) + "\n以上。");
    expect(r!.overallScore).toBe(7.5);
  });

  it("应剥离 think 块", () => {
    const r = parseReviewResult("<think>先规划</think>" + JSON.stringify(FULL));
    expect(r!.overallScore).toBe(7.5);
  });
});

describe("parseReviewResult 非法输入", () => {
  it("空串应返回 null", () => {
    expect(parseReviewResult("")).toBeNull();
    expect(parseReviewResult(null as any)).toBeNull();
  });

  it("非 JSON 应返回 null", () => {
    expect(parseReviewResult("这不是 JSON")).toBeNull();
    expect(parseReviewResult("{broken")).toBeNull();
  });
});

describe("parseReviewResult 缺字段(假数据防线)", () => {
  /*
   * ⭐ 核心:此前是 `Number(parsed.overallScore) || 0`。
   *   LLM 漏掉 overallScore 或返回非数字时,会静默变成 **0 分** ——
   *   用户看到"本次面试 0 分",而真相是"我没解析出来"。
   *   这是"假数据"模式的第五次出现(前四次:PEER_BENCHMARK / expressionScore /
   *   matchScore / radarData)。
   */
  it("缺 overallScore 应返回 null 而非 0 分", () => {
    const { overallScore, ...noScore } = FULL as any;
    expect(parseReviewResult(JSON.stringify(noScore))).toBeNull();
  });

  it("overallScore 为非数字应返回 null", () => {
    expect(parseReviewResult(JSON.stringify({ ...FULL, overallScore: "优秀" }))).toBeNull();
  });

  it("overallScore 为 null 应返回 null", () => {
    expect(parseReviewResult(JSON.stringify({ ...FULL, overallScore: null }))).toBeNull();
  });

  it("overallScore 为 0 应视为有效(真的 0 分)", () => {
    const r = parseReviewResult(JSON.stringify({ ...FULL, overallScore: 0 }));
    expect(r).not.toBeNull();
    expect(r!.overallScore).toBe(0);
  });

  it("缺 strengths 数组应返回 null(而非空数组)", () => {
    const { strengths, ...noStrengths } = FULL as any;
    expect(parseReviewResult(JSON.stringify(noStrengths))).toBeNull();
  });

  it("strengths 非数组应返回 null", () => {
    expect(parseReviewResult(JSON.stringify({ ...FULL, strengths: "很好" }))).toBeNull();
  });

  it("improvements 元素缺字段应返回 null", () => {
    const bad = { ...FULL, improvements: [{ area: "边界" }] };
    expect(parseReviewResult(JSON.stringify(bad))).toBeNull();
  });

  it("improvements 的 priority 非法值应被归一而非丢弃整个结果", () => {
    const r = parseReviewResult(JSON.stringify({
      ...FULL, improvements: [{ area: "A", suggestion: "B", priority: "urgent" }],
    }));
    expect(r).not.toBeNull();
    expect(["high", "medium", "low"]).toContain(r!.improvements[0].priority);
  });
});

describe("buildReviewPrompt", () => {
  const p = { stages: ["技术面", "HR面"], agentNames: ["技术官", "HR"], difficulty: "hard" };

  it("应填入阶段与面试官", () => {
    const s = buildReviewPrompt(p);
    expect(s).toContain("技术面");
    expect(s).toContain("技术官");
    expect(s).toContain("hard");
  });

  it("未提供的可选字段不应留下未替换的占位符", () => {
    const s = buildReviewPrompt({ stages: [], agentNames: [] });
    expect(s).not.toMatch(/\{\{/);
  });

  it("无对话记录时也应可生成(不崩溃)", () => {
    expect(() => buildReviewPrompt(p)).not.toThrow();
  });
});
