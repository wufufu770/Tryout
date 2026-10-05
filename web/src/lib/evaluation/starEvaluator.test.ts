import { describe, it, expect } from "vitest";
import {
  generateEvaluationPrompt,
  parseEvaluationResult,
  EVALUATION_DIMENSIONS,
  ANCHOR_IDS,
  anchorIdToScore,
  buildRubricBlock,
} from "./starEvaluator";

describe("行为锚定(ADR-002 / ADR-003)", () => {
  it("每个维度都应有两端行为锚点(1 分与 5 分)", () => {
    // 依据:Choi et al. 2025 —— 只锚两端(1 分/6 分)的 QWK 为 0.59,
    // 优于把锚点摊到 1/3/6 档的 0.39。故只定义两端,不写中间档锚点。
    expect(EVALUATION_DIMENSIONS).toHaveLength(6);
    for (const d of EVALUATION_DIMENSIONS) {
      expect(typeof d.anchors[1], `维度 ${d.key} 缺 1 分锚点`).toBe("string");
      expect(typeof d.anchors[5], `维度 ${d.key} 缺 5 分锚点`).toBe("string");
    }
  });

  it("锚点必须是可观察的行为描述,不是形容词", () => {
    // 形容词量表("优秀/良好/差")的缺陷:两个评分者打 4 分时心里想的不是一回事。
    // 锚点必须描述"做了什么",而非"好不好"。
    for (const d of EVALUATION_DIMENSIONS) {
      for (const level of [1, 5] as const) {
        expect(d.anchors[level].length).toBeGreaterThanOrEqual(8);
        // 不应直接以纯形容词开头(技术深度/抗压 等语义豁免)
        expect(d.anchors[level]).not.toMatch(/^(优秀|良好|差|一般|很好|较差)/);
      }
    }
  });

  it("同一维度的两端锚点不应语义相同", () => {
    for (const d of EVALUATION_DIMENSIONS) {
      expect(d.anchors[1]).not.toBe(d.anchors[5]);
    }
  });

  it("锚点 ID 应为降序字母表 A..E", () => {
    // ADR-003:降序排列提升准确率,随机打乱会全面拉低。
    expect([...ANCHOR_IDS]).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("anchorIdToScore 应把 A..E 映射到 5..1", () => {
    expect(anchorIdToScore("A")).toBe(5);
    expect(anchorIdToScore("B")).toBe(4);
    expect(anchorIdToScore("C")).toBe(3);
    expect(anchorIdToScore("D")).toBe(2);
    expect(anchorIdToScore("E")).toBe(1);
  });

  it("anchorIdToScore 应容忍小写字母", () => {
    expect(anchorIdToScore("a")).toBe(5);
    expect(anchorIdToScore("e")).toBe(1);
  });

  it("anchorIdToScore 对非法输入应返回 null 而非抛出", () => {
    expect(anchorIdToScore("F")).toBeNull();
    expect(anchorIdToScore("")).toBeNull();
    expect(anchorIdToScore("3")).toBeNull();
  });

  it("buildRubricBlock 应为单个维度生成降序的锚点描述块", () => {
    // 切片 2:锚点的实际用途是注入 prompt 供裁判做匹配判断。
    // 块内必须只含该维度的锚点 —— 混入会造成 rubric 干扰(ADR-001)。
    const tech = EVALUATION_DIMENSIONS[0];
    const block = buildRubricBlock(tech);
    expect(block).toContain(tech.name);
    expect(block).toContain(tech.anchors[5]);
    expect(block).toContain(tech.anchors[1]);
    // 不得出现其他维度的锚点
    const other = EVALUATION_DIMENSIONS[1];
    expect(block).not.toContain(other.anchors[5]);
    expect(block).not.toContain(other.anchors[1]);
  });

  it("buildRubricBlock 中 A 的位置应早于 E(降序)", () => {
    const block = buildRubricBlock(EVALUATION_DIMENSIONS[0]);
    expect(block.indexOf("A(5)")).toBeGreaterThanOrEqual(0);
    expect(block.indexOf("A(5)")).toBeLessThan(block.indexOf("E(1)"));
  });

  it("buildRubricBlock 应说明中间档按梯度插值", () => {
    const block = buildRubricBlock(EVALUATION_DIMENSIONS[0]);
    expect(block).toMatch(/插值|介于/);
  });

  it("buildRubricBlock 应包含长度偏见防护语", () => {
    // 面试场景高危:话痨候选人系统性得高分,是本产品最可能犯的效度错误。
    const block = buildRubricBlock(EVALUATION_DIMENSIONS[0]);
    expect(block).toMatch(/不因.*长度|长度.*不/);
  });
});


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
      // 注意:parseEvaluationResult 有结构校验,dimensions 必须是数组,
      // 否则视为非法 JSON 返回 null(见下方"缺少 dimensions 应返回 null"用例)。
      const payload = {
        dimensions: [{ dimensionName: "技术深度", score: 4, comment: "ok" }],
        overallScore: 8,
        report: "r",
        improvementAdvice: "",
        betterAnswerSample: "",
      };
      const content = "```json\n" + JSON.stringify(payload) + "\n```";
      const r = parseEvaluationResult(content);
      expect(r).not.toBeNull();
      expect(r?.overallScore).toBe(8);
    });

    it("应解析带前后噪声文本的 JSON", () => {
      const payload = {
        dimensions: [{ dimensionName: "技术深度", score: 4, comment: "ok" }],
        overallScore: 6,
        report: "r",
        improvementAdvice: "",
        betterAnswerSample: "",
      };
      const content = "好的,以下是评估:\n" + JSON.stringify(payload) + "\n以上是评估结果。";
      const r = parseEvaluationResult(content);
      expect(r).not.toBeNull();
      expect(r?.overallScore).toBe(6);
    });

    it("缺少 dimensions 字段应返回 null(结构校验)", () => {
      // 防御 LLM 返回不完整 JSON:没有 dimensions 时下游无法渲染雷达图,必须拒绝
      const content = JSON.stringify({ overallScore: 8, report: "r" });
      expect(parseEvaluationResult(content)).toBeNull();
    });

    it("无效 JSON 应返回 null", () => {
      expect(parseEvaluationResult("not json")).toBeNull();
      expect(parseEvaluationResult("")).toBeNull();
    });
  });

  /*
   * PEER_BENCHMARK 已删除(W5-1 / P2-4)。
   *
   * 它原本是 `EVALUATION_DIMENSIONS.map(d => ({..., score: 3.5}))` ——
   * 六个维度全写死 3.5,却在 EvaluationRadar 里标为"同岗位平均"展示。
   * **零数据来源的常数被包装成行业基准。**
   * 替代方案:用户自己的历史中位数(见 baseline.ts 的 computePersonalBaseline)。
   *
   * 这条测试的删除本身就是文档 —— 提醒后来者不要把它加回来。
   */
  it("不应再导出 PEER_BENCHMARK(假基准已移除)", async () => {
    const mod = await import("./starEvaluator");
    expect((mod as Record<string, unknown>).PEER_BENCHMARK).toBeUndefined();
  });
});
