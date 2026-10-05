// 即时反馈编排单元测试
// Seam:findLatestQaPair() / shouldEvaluateNow()(纯函数)
//
// 背景(W4-3):评估目前只在历史页手动触发 —— 用户答完 20 分钟当场零反馈。
// 但"每答一句就评一次"同样糟糕:
//   - 成本爆炸(每个维度一次 LLM 调用,ADR-001 的代价是 6 倍)
//   - 打断心流(用户还在想下一题,却弹出评分)
//
// 所以需要一个"何时评估"的明确规则,并把它锁死成可测的纯函数。
import { describe, it, expect } from "vitest";
import { findLatestQaPair, resolveScoringReference, shouldEvaluateNow, type ChatMessage } from "./liveCoach";

describe("findLatestQaPair", () => {
  const M = (role: "user" | "assistant", content: string, id?: string): ChatMessage =>
    ({ role, content, messageId: id }) as ChatMessage;

  it("应找到最后一组 面试官问题→候选人回答", () => {
    const msgs = [
      M("assistant", "问题一"),
      M("user", "回答一"),
      M("assistant", "问题二"),
      M("user", "回答二"),
    ];
    const p = findLatestQaPair(msgs);
    expect(p).not.toBeNull();
    expect(p!.question).toBe("问题二");
    expect(p!.answer).toBe("回答二");
  });

  it("最后一组尚未回答时应返回**上一组完整问答**,而不是 null", () => {
    // ⚠️ 这不是 bug:面试官抛出了新问题但候选人还没答,
    //    此时"最近一组完整问答"仍是上一组 —— 评估它仍然有意义
    //    (用户刚回答完,趁记忆还新)。返回 null 反而会漏掉这次评估机会。
    const msgs = [M("assistant", "问题一"), M("user", "回答一"), M("assistant", "问题二")];
    const p = findLatestQaPair(msgs);
    expect(p).not.toBeNull();
    expect(p!.question).toBe("问题一");
    expect(p!.answer).toBe("回答一");
  });

  it("只有面试官提问、用户从未回答时应返回 null", () => {
    expect(findLatestQaPair([M("assistant", "问题一")])).toBeNull();
    expect(findLatestQaPair([M("assistant", "问题一"), M("assistant", "问题二")])).toBeNull();
  });

  it("空消息应返回 null", () => {
    expect(findLatestQaPair([])).toBeNull();
  });

  it("只有用户消息(无面试官提问)应返回 null", () => {
    expect(findLatestQaPair([M("user", "开场白"), M("user", "回答")])).toBeNull();
  });

  it("应跳过空内容的回答", () => {
    const msgs = [M("assistant", "问题"), M("user", "   "), M("assistant", "问题2"), M("user", "真回答")];
    const p = findLatestQaPair(msgs);
    expect(p?.answer).toBe("真回答");
  });

  it("应带上 messageId 以便落库关联", () => {
    const msgs = [M("assistant", "问题", "m1"), M("user", "回答", "m2")];
    const p = findLatestQaPair(msgs);
    expect(p?.messageId).toBe("m2");
  });

  it("system 消息不应参与配对", () => {
    const msgs = [
      { role: "system", content: "系统提示" } as any,
      M("assistant", "问题"),
      M("user", "回答"),
    ];
    const p = findLatestQaPair(msgs);
    expect(p?.question).toBe("问题");
  });
});

describe("shouldEvaluateNow", () => {
  it("首轮不足间隔时不应评估(间隔=2 时第 1 轮跳过)", () => {
    expect(shouldEvaluateNow({ answeredRounds: 1, lastEvaluatedRound: 0, interval: 2 })).toBe(false);
  });

  it("间隔=1 时首轮即评估", () => {
    expect(shouldEvaluateNow({ answeredRounds: 1, lastEvaluatedRound: 0, interval: 1 })).toBe(true);
  });

  it("未到间隔时不应评估", () => {
    expect(shouldEvaluateNow({ answeredRounds: 2, lastEvaluatedRound: 1, interval: 2 })).toBe(false);
  });

  it("间隔=3 时第 1、2 轮不评,第 3 轮评", () => {
    expect(shouldEvaluateNow({ answeredRounds: 1, lastEvaluatedRound: 0, interval: 3 })).toBe(false);
    expect(shouldEvaluateNow({ answeredRounds: 2, lastEvaluatedRound: 0, interval: 3 })).toBe(false);
    expect(shouldEvaluateNow({ answeredRounds: 3, lastEvaluatedRound: 0, interval: 3 })).toBe(true);
  });

  it("到达间隔时应评估", () => {
    expect(shouldEvaluateNow({ answeredRounds: 3, lastEvaluatedRound: 1, interval: 2 })).toBe(true);
  });

  it("同一轮不应重复评估", () => {
    // answeredRounds === lastEvaluatedRound 说明这轮已评过
    expect(shouldEvaluateNow({ answeredRounds: 3, lastEvaluatedRound: 3, interval: 2 })).toBe(false);
  });

  it("间隔为 1 时每轮都评估", () => {
    expect(shouldEvaluateNow({ answeredRounds: 5, lastEvaluatedRound: 4, interval: 1 })).toBe(true);
  });

  /*
   * 间隔非法(<=0)时的行为选择:
   *   选"退化为不评估"而不是"每轮都评" —— 因为 ADR-001 已让单次评估
   *   变成 6 个 LLM 调用,配置失误时静默烧 token 是最坏的结果。
   *   宁可暂时没反馈,也不要成本失控。
   */
  it("间隔非法(<=0)时应退化为**不评估**,避免配置失误烧掉大量 token", () => {
    expect(shouldEvaluateNow({ answeredRounds: 5, lastEvaluatedRound: 0, interval: 0 })).toBe(false);
    expect(shouldEvaluateNow({ answeredRounds: 5, lastEvaluatedRound: 0, interval: -1 })).toBe(false);
  });

  it("间隔非法时即使首轮也不评估(宁可无反馈不可成本失控)", () => {
    expect(shouldEvaluateNow({ answeredRounds: 1, lastEvaluatedRound: 0, interval: 0 })).toBe(false);
  });

  it("回答轮数倒退(切会话)时不应评估", () => {
    // 新会话时 answeredRounds 归零,若 lastEvaluatedRound 还是旧值会误触发
    expect(shouldEvaluateNow({ answeredRounds: 1, lastEvaluatedRound: 9, interval: 2 })).toBe(false);
  });
});

// ============================================================================
// R32(ISSUE-038):题目级评分基准的接线决策
//
// 这是本文件最重要的一段断言。R32 之前 InterviewPage 写的是:
//     scoreWithRetry(d, pair.question, pair.answer, undefined, ...)
//     bankReferenced: !!currentQuestion        ← 判据是"抽到了题库题"
// 即:**实际从未把参考答案喂给评分器**,却让 UI 对用户声称用了题库作基准
// (liveCoach.bankBased 在 10 种语言里都写成事实陈述)。
//
// 一个"分数可不可信"的产品,在基准来源上对用户撒谎,比缺功能严重得多。
// 下面这组断言就是防止它再发生。
// ============================================================================
describe("resolveScoringReference:能不能对用户说『用了题库作基准』", () => {
  const GOOD = {
    referenceAnswer: "应先澄清一致性哈希与虚拟节点的取舍,再谈扩容迁移。",
    keyPoints: ["一致性哈希", "虚拟节点"],
    type: "technical",
  };

  it("拿到完整参考 → 注入评分器,且如实标记为有基准", () => {
    const { reference, bankReferenced } = resolveScoringReference(GOOD);
    expect(bankReferenced).toBe(true);
    expect(reference).toBeDefined();
    expect(reference!.keyPoints).toEqual(["一致性哈希", "虚拟节点"]);
    expect(reference!.questionType).toBe("technical");
  });

  it("取不到参考 → 降级评估,但绝不能说有基准", () => {
    for (const bad of [null, undefined]) {
      const { reference, bankReferenced } = resolveScoringReference(bad);
      expect(reference).toBeUndefined();
      expect(bankReferenced).toBe(false);
    }
  });

  // ↓ 这一组是"不许谎称"的核心:半截数据最容易让判据与实际分叉
  it("keyPoints 为空 → 判无基准(否则 buildReferenceBlock 只会输出一行空的『考察方向:』)", () => {
    const { reference, bankReferenced } = resolveScoringReference({ ...GOOD, keyPoints: [] });
    expect(reference).toBeUndefined();
    expect(bankReferenced).toBe(false);
  });

  it("keyPoints 全是空白字符串 → 判无基准", () => {
    const { bankReferenced } = resolveScoringReference({ ...GOOD, keyPoints: ["", "  "] });
    expect(bankReferenced).toBe(false);
  });

  it("referenceAnswer 空白 → 判无基准", () => {
    const { reference, bankReferenced } = resolveScoringReference({ ...GOOD, referenceAnswer: "   " });
    expect(reference).toBeUndefined();
    expect(bankReferenced).toBe(false);
  });

  it("referenceAnswer 缺失/非字符串 → 判无基准,不猜", () => {
    expect(resolveScoringReference({ keyPoints: ["x"] } as any).bankReferenced).toBe(false);
    expect(resolveScoringReference({ ...GOOD, referenceAnswer: 42 } as any).bankReferenced).toBe(false);
  });

  it("keyPoints 非数组 → 判无基准,不崩", () => {
    const { reference, bankReferenced } = resolveScoringReference({ ...GOOD, keyPoints: "x" } as any);
    expect(reference).toBeUndefined();
    expect(bankReferenced).toBe(false);
  });

  // 结构性保证:两个值同源,所以"有基准但没注入"或"注入了却不承认"都不可能
  it("bankReferenced 与 reference 严格同源 —— 不存在『有基准却没注入』", () => {
    const cases: any[] = [
      GOOD,
      { ...GOOD, keyPoints: [] },
      { ...GOOD, referenceAnswer: "" },
      { ...GOOD, type: "behavioral" },
      null,
    ];
    for (const c of cases) {
      const { reference, bankReferenced } = resolveScoringReference(c);
      expect(bankReferenced).toBe(Boolean(reference));
    }
  });

  it("不丢题型:behavioral 题必须带上 questionType,否则 buildReferenceBlock 退回技术题口径", () => {
    // ISSUE-039:behavioral/design/questions 占题库 56%,用技术题判据评它们是自相矛盾的指令
    for (const t of ["behavioral", "design", "coding", "questions", "technical"]) {
      const { reference } = resolveScoringReference({ ...GOOD, type: t });
      expect(reference!.questionType).toBe(t);
    }
  });

  it("抹掉多余空白(整段会进 prompt,空白没有信息量)", () => {
    const { reference } = resolveScoringReference({
      ...GOOD,
      keyPoints: ["  一致性哈希  ", "", "虚拟节点"],
      referenceAnswer: "  参考答案  ",
    });
    expect(reference!.keyPoints).toEqual(["一致性哈希", "虚拟节点"]);
    expect(reference!.referenceAnswer).toBe("参考答案");
  });
});
