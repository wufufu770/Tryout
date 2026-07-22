import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeWeakness } from "./weaknessAnalyzer";

// mock api.request,避免真实网络请求
vi.mock("@/api/client", () => ({
  api: {
    request: vi.fn(),
  },
}));

import { api } from "@/api/client";

describe("weaknessAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应调用 /analysis/weakness 接口,默认 limit=5", async () => {
    (api.request as any).mockResolvedValue({ hasData: false, message: "no data" });
    await analyzeWeakness();
    expect(api.request).toHaveBeenCalledWith("/analysis/weakness?limit=5");
  });

  it("应支持自定义 limit", async () => {
    (api.request as any).mockResolvedValue({ hasData: false, message: "no data" });
    await analyzeWeakness(10);
    expect(api.request).toHaveBeenCalledWith("/analysis/weakness?limit=10");
  });

  it("应正确返回空数据场景", async () => {
    (api.request as any).mockResolvedValue({ hasData: false, message: "暂无评估数据,完成一次面试后再来查看" });
    const r = await analyzeWeakness();
    expect(r.hasData).toBe(false);
    expect(r.message).toContain("暂无");
  });

  it("应正确返回有数据场景", async () => {
    const mockData = {
      hasData: true,
      totalEvaluations: 3,
      dimensionStats: [
        { dimensionName: "技术深度", avgScore: 3.5, count: 3 },
        { dimensionName: "沟通表达", avgScore: 2.8, count: 3 },
      ],
      weakestDimensions: [
        { dimensionName: "沟通表达", avgScore: 2.8, count: 3 },
      ],
      advice: "建议加强练习【沟通表达】方向的题目。",
      recentScores: [
        { score: 7.5, date: "2026-07-20", sessionId: "sess_1" },
      ],
    };
    (api.request as any).mockResolvedValue(mockData);
    const r = await analyzeWeakness(3);
    expect(r.hasData).toBe(true);
    expect(r.totalEvaluations).toBe(3);
    expect(r.weakestDimensions).toHaveLength(1);
    expect(r.weakestDimensions?.[0].dimensionName).toBe("沟通表达");
    expect(r.advice).toContain("沟通表达");
  });

  it("网络错误应向上抛出", async () => {
    (api.request as any).mockRejectedValue(new Error("network error"));
    await expect(analyzeWeakness()).rejects.toThrow("network error");
  });
});
