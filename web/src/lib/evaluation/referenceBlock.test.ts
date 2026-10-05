// 单元测试:参考答案块必须**按题型**给判据(守卫 ISSUE-039)
//
// ## 缺陷
// `buildReferenceBlock(ref, questionType)` 的第二个形参 `questionType`
// **声明了却从未被使用**,而 `QuestionReference.questionType` 的接口注释
// 明确写着「用于选择参考答案的裁剪策略」。块内文案同时硬编码成技术题口径:
//   「请判断候选人在【技术事实】上是否成立」
//
// 题库 808 题里 type 分布为:
//   technical 188 / design 166 / behavioral 166 / coding 167 / questions 121
// 也就是说 **453 题(56%)** 拿到的判据是"看技术事实" —— 而行为题里
// 根本没有"技术事实"可判。裁判收到的是自相矛盾的指令,这也是 R18 里
// 「注入每题标准」对高/中分档效果显著的一个可能来源之一。
//
// 修复后:按 questionType 选判据话术,coding 额外强调"只需比对判分要点",
// 未知/缺省类型回落到中性表述而不是错误的技术题表述。
import { describe, it, expect } from "vitest";
import { buildDimensionPrompt, type QuestionReference } from "./scoringEngine";
import { EVALUATION_DIMENSIONS } from "./starEvaluator";

const dim = EVALUATION_DIMENSIONS[0];

function refBlock(questionType?: string): string {
  const ref: QuestionReference = {
    keyPoints: ["时间线", "止血动作"],
    referenceAnswer: "示例满分答案",
    questionType,
  };
  const p = buildDimensionPrompt(dim, "讲一次你处理线上故障的经历", "我的回答", ref);
  return p.slice(p.indexOf("<reference"), p.indexOf("</reference>") + 12);
}

describe("buildReferenceBlock:判据必须随题型变化", () => {
  it("behavioral 不得出现「技术事实」判据", () => {
    const b = refBlock("behavioral");
    expect(b).not.toContain("技术事实");
    expect(b).toContain("事实、应对动作与事后复盘");
  });

  it("design 走方案取舍口径", () => {
    const b = refBlock("design");
    expect(b).not.toContain("技术事实");
    expect(b).toContain("方案取舍与理由");
  });

  it("coding 强调只需比对判分要点(接口注释里写明的裁剪策略)", () => {
    const b = refBlock("coding");
    expect(b).toContain("关键分支");
    expect(b).toContain("不必逐行一致");
  });

  it("questions 走切题/实质内容口径", () => {
    const b = refBlock("questions");
    expect(b).toContain("切题");
  });

  it("technical 保留原有的技术事实口径(不得把对的东西改坏)", () => {
    const b = refBlock("technical");
    expect(b).toContain("事实与判断依据");
  });

  it("questionType 缺省或未知时回落到中性表述,而不是技术题表述", () => {
    for (const t of [undefined, "", "unknown-type"]) {
      const b = refBlock(t);
      expect(b, `questionType=${JSON.stringify(t)} 回落失败`).not.toContain("技术事实");
      expect(b).toContain("事实与判断依据");
    }
  });

  it("无论题型如何,都必须保留「超出参考不应扣分」与满分参考声明", () => {
    for (const t of ["technical", "behavioral", "design", "coding", "questions"]) {
      const b = refBlock(t);
      expect(b, `${t} 丢失满分参考声明`).toContain("满分参考示例");
      expect(b, `${t} 丢失不得因超出参考扣分`).toContain("超出参考范围但正确的回答");
    }
  });

  it("考察方向必须渲染出 keyPoints(ISSUE-036 那类空数组静默退化不能复发)", () => {
    const b = refBlock("behavioral");
    expect(b).toContain("时间线、止血动作");
  });

  it("大小写/空格差异不应让题型失配", () => {
    expect(refBlock("  Behavioral  ")).not.toContain("技术事实");
    expect(refBlock("BEHAVIORAL")).toContain("事后复盘");
  });
});
