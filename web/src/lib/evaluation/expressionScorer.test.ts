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
    // W5-1:词表已剔除"这个/那个/就是/然后/其实"等中文高虚词。
    // 它们在正常中文口语里是指示代词与连接词,当填充词会**系统性低估中文用户** ——
    // 而本项目目标用户以中文为主。只保留"嗯/呃/唔"这类真正的无意义语气词。
    expect(r.fillerCount).toBeGreaterThanOrEqual(2);
    expect(r.fillerFrequency).toBeGreaterThan(0);
  });

  it("中文常见虚词不应被计为填充词(W5-1 修正)", () => {
    // 这句话完全没有填充词:"这个/那个"是指示代词
    const clean = "这个方案我觉得非常好,因为它解决了那个我们一直头疼的问题";
    expect(scoreExpression(clean).fillerCount).toBe(0);
  });

  it("英文子串不应被误判为填充词(W5-1 修正)", () => {
    // also/some/person 里的 so,以及 likely/alike 里的 like,都不算
    expect(scoreExpression("I also think that some reason for a person, it is likely").fillerCount).toBe(0);
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

  it("综合分已弃用:恒为 0(W5-1)", () => {
    /*
     * 这条测试现在是**契约**,不是行为描述。
     * expressionScore 的权重(0.3/0.2/0.25/0.25)是拍脑袋定的,
     * 把四类性质不同的指标加权成一个数字 = 伪精度。
     * 各人语速基线差异很大,合成一个分对用户没有可解释意义。
     * 保留字段仅为向后兼容,恒为 0。
     */
    const text = "首先,这个问题可以从三个角度分析。其次,需要考虑性能与可维护性的平衡。最后,建议采用模块化方案。因此,该方案在长期维护上更优。";
    expect(scoreExpression(text).expressionScore).toBe(0);
  });

  it("可观察指标仍然有效(弃用合成分数不影响它们)", () => {
    const text = "首先,这个问题可以从三个角度分析。其次,需要考虑性能与可维护性的平衡。最后,建议采用模块化方案。因此,该方案在长期维护上更优。";
    const r = scoreExpression(text);
    expect(r.connectorCount).toBeGreaterThanOrEqual(3);
    expect(r.sentenceCount).toBeGreaterThan(0);
    expect(r.avgSentenceLength).toBeGreaterThan(0);
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
