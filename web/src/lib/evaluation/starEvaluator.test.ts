import { describe, it, expect } from "vitest";
import { generateEvaluationPrompt, parseEvaluationResult, PEER_BENCHMARK } from "./starEvaluator";

describe("starEvaluator", () => {
  describe("generateEvaluationPrompt", () => {
    it("应在 prompt 中包含问题和回答", () => {
      const p = generateEvaluationPrompt("Q1", "A1");
      expect(p).toContain("Q1");
      expect(p).toContain("A1");
    });

    it("应包含 6 个维度", () => {
      const p = generateEvaluationPrompt("q", "a");
      expect(p).toContain("技术深度");
      expect(p).toContain("沟通表达");
      expect(p).toContain("逻辑思维");
      expect(p).toContain("问题解决");
      expect(p).toContain("抗压能力");
      expect(p).toContain("文化匹配");
    });

    it("应包含 STAR 法则四要素", () => {
      const p = generateEvaluationPrompt("q", "a");
      expect(p).toContain("situation");
      expect(p).toContain("task");
      expect(p).toContain("action");
      expect(p).toContain("result");
    });
  });

  describe("parseEvaluationResult", () => {
    it("应正确解析纯 JSON", () => {
      const json = JSON.stringify({
        dimensions: [{ dimensionName: "技术深度", score: 4, comment: "ok" }],
        overallScore: 7.5,
        report: "report",
        improvementAdvice: "advice",
        betterAnswerSample: "sample",
      });
      const r = parseEvaluationResult(json);
      expect(r).not.toBeNull();
      expect(r?.overallScore).toBe(7.5);
      expect(r?.dimensions).toHaveLength(1);
    });

    it("应解析带 ```json 代码块的字符串", () => {
      const content = '```json\n{"overallScore": 8, "report": "r", "improvementAdvice": "", "betterAnswerSample": ""}\n```';
      const r = parseEvaluationResult(content);
      expect(r?.overallScore).toBe(8);
    });

    it("应解析带前后噪声文本的 JSON", () => {
      const content = '好的,以下是评估:\n{"overallScore": 6, "report": "r", "improvementAdvice": "", "betterAnswerSample": ""}\n以上是评估结果。';
      const r = parseEvaluationResult(content);
      expect(r?.overallScore).toBe(6);
    });

    it("无效 JSON 应返回 null", () => {
      expect(parseEvaluationResult("not json")).toBeNull();
      expect(parseEvaluationResult("")).toBeNull();
    });
  });

  describe("PEER_BENCHMARK", () => {
    it("应有 6 个维度的基准分", () => {
      expect(PEER_BENCHMARK).toHaveLength(6);
      for (const d of PEER_BENCHMARK) {
        expect(d.score).toBeGreaterThan(0);
        expect(d.score).toBeLessThanOrEqual(5);
        expect(d.dimensionName).toBeTruthy();
      }
    });
  });
});
