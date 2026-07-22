import { describe, it, expect } from "vitest";
import { scoreExpression } from "./expressionScorer";

describe("expressionScorer", () => {
  it("空字符串应返回零值但不崩溃", () => {
    const r = scoreExpression("");
    expect(r.sentenceCount).toBeGreaterThanOrEqual(1);
    expect(r.fillerCount).toBe(0);
    expect(r.expressionScore).toBeGreaterThanOrEqual(0);
    expect(r.expressionScore).toBeLessThanOrEqual(100);
  });

  it("应正确统计填充词", () => {
    const text = "嗯,我觉得这个,嗯,就是,然后,那个,其实就是这样的";
    const r = scoreExpression(text);
    // 嗯x2, 我觉得x1, 这个x1, 就是x2, 然后x1, 那个x1, 其实x1 = 9
    expect(r.fillerCount).toBeGreaterThanOrEqual(5);
    expect(r.fillerFrequency).toBeGreaterThan(0);
  });

  it("应正确统计连接词", () => {
    const text = "首先介绍背景。其次分析问题。最后给出方案。因此方案可行。";
    const r = scoreExpression(text);
    expect(r.connectorCount).toBeGreaterThanOrEqual(3); // 首先/其次/最后/因此
  });

  it("应正确分割句子", () => {
    const text = "第一句。第二句!第三句?最后一句。";
    const r = scoreExpression(text);
    expect(r.sentenceCount).toBe(4);
  });

  it("短句长度的句子结构评分应较低", () => {
    const r = scoreExpression("好。是。对。");
    expect(r.breakdown.structure).toBeLessThan(80);
  });

  it("适中句长 + 适量连接词应得到较高综合分", () => {
    const text = "首先,这个问题可以从三个角度分析。其次,需要考虑性能与可维护性的平衡。最后,建议采用模块化方案。因此,该方案在长期维护上更优。";
    const r = scoreExpression(text);
    expect(r.expressionScore).toBeGreaterThan(60);
  });

  it("语速评级:慢速应识别为 slow", () => {
    // 100 字 / 60 秒 = 100 字/分钟,< 120 为 slow
    const text = "字".repeat(100);
    const r = scoreExpression(text, 60);
    expect(r.speakingSpeed).toBe(100);
    expect(r.speedLevel).toBe("slow");
  });

  it("语速评级:快速应识别为 fast", () => {
    // 200 字 / 30 秒 = 400 字/分钟,> 300 为 fast
    const text = "字".repeat(200);
    const r = scoreExpression(text, 30);
    expect(r.speakingSpeed).toBe(400);
    expect(r.speedLevel).toBe("fast");
  });

  it("无 durationSeconds 时应按字数估算语速", () => {
    const text = "字".repeat(400); // 400 字 / 200 字每分 = 2 分钟 = 200 字/分
    const r = scoreExpression(text);
    expect(r.speakingSpeed).toBe(200);
    expect(r.speedLevel).toBe("normal");
  });

  it("breakdown 各维度应在 0-100 范围", () => {
    const r = scoreExpression("一段普通的回答文本,用于测试各维度评分的边界值。");
    for (const v of Object.values(r.breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
