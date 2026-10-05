// 阶段推进决策单元测试
// Seam:shouldAdvanceStage() / parseStageSignal()(纯函数)
//
// 背景(W5-2):`InterviewPage.tsx:936` 是 `Math.floor(totalMessages / 6)` ——
// **不管聊的是什么,每 6 条消息就跳阶段**。真实面试是面试官判断
// "这块问够了"才换人;而且各阶段深度不同(自我介绍 3 轮就够,
// 项目深挖可能要 10 轮),固定 3 轮既可能太快也可能太慢。
//
// 为什么不用 LLM 判断:
//   1. 阶段推进是**每轮都要做**的决策,让 LLM 判断等于每轮多一次调用
//   2. LLM 判断会抖 —— 同一段对话两次运行可能给出不同结论
//   3. 更稳的做法:**LLM 只给"建议信号",覆盖规则兜底**。
//      信号缺失/解析失败时退回覆盖规则,保证行为可预期。
import { describe, it, expect } from "vitest";
import { shouldAdvanceStage, parseStageSignal, DEFAULT_STAGE_TURNS, stripStageMarkers } from "./stageAdvance";

describe("parseStageSignal", () => {
  it("应解析 continue 信号", () => {
    const s = parseStageSignal("[STAGE_STATUS:continue]");
    expect(s).not.toBeNull();
    expect(s!.advance).toBe(false);
  });

  it("应解析 advance 信号", () => {
    const s = parseStageSignal("好的。[STAGE_STATUS:advance]");
    expect(s!.advance).toBe(true);
  });

  it("应覆盖已问/未问方向", () => {
    const s = parseStageSignal("[COVERAGE:已问 A,B | 未问 C]");
    expect(s!.covered).toEqual(["A", "B"]);
    expect(s!.uncovered).toEqual(["C"]);
  });

  it("无信号时应返回 null(调用方退回覆盖规则)", () => {
    expect(parseStageSignal("这是一段普通回答,没有任何标记")).toBeNull();
  });

  it("信号格式损坏时不应抛异常", () => {
    expect(() => parseStageSignal("[STAGE_STATUS:xxx]")).not.toThrow();
    expect(parseStageSignal("[STAGE_STATUS:xxx]")).toBeNull();
  });

  it("应忽略 think 块内的信号(避免把推理过程当信号)", () => {
    const withThink = "<think>我应该标记 [STAGE_STATUS:advance] </think>实际回答";
    expect(parseStageSignal(withThink)).toBeNull();
  });

  it("只出现一次时后者应覆盖前者", () => {
    const s = parseStageSignal("[STAGE_STATUS:continue] [STAGE_STATUS:advance]");
    expect(s!.advance).toBe(true);
  });
});

describe("shouldAdvanceStage", () => {
  const base = {
    totalTurns: 2,        // 本阶段已进行 2 轮
    signal: null as ReturnType<typeof parseStageSignal>,
    stageIndex: 0,
    totalStages: 3,
    minTurns: 1,          // 至少聊够 1 轮
    maxTurns: 12,
  };

  it("轮数不足 minTurns 时不推进(防止开场就跳)", () => {
    expect(shouldAdvanceStage({ ...base, totalTurns: 0, minTurns: 1 })).toBe(false);
  });

  it("轮数超 maxTurns 时强制推进(防止卡死在一个阶段)", () => {
    expect(shouldAdvanceStage({ ...base, totalTurns: 20, maxTurns: 12 })).toBe(true);
  });

  it("最后阶段不再推进", () => {
    expect(shouldAdvanceStage({ ...base, stageIndex: 2, totalStages: 3, signal: parseStageSignal("[STAGE_STATUS:advance]") })).toBe(false);
  });

  it("LLM 给出 advance 信号时推进", () => {
    expect(shouldAdvanceStage({ ...base, totalTurns: 3, signal: parseStageSignal("[STAGE_STATUS:advance]") })).toBe(true);
  });

  it("LLM 给出 continue 信号时不推进", () => {
    expect(shouldAdvanceStage({ ...base, totalTurns: 3, signal: parseStageSignal("[STAGE_STATUS:continue]") })).toBe(false);
  });

  it("LLM 明确 continue 时应压制覆盖规则(不因超轮数就跳)", () => {
    // 面试官说"这块还没问完",即使已 20 轮也不该硬跳 —— 内容判断优先
    expect(shouldAdvanceStage({ ...base, totalTurns: 20, maxTurns: 12, signal: parseStageSignal("[STAGE_STATUS:continue]") })).toBe(false);
  });

  it("无信号且未达 maxTurns 时按覆盖规则保持", () => {
    expect(shouldAdvanceStage({ ...base, totalTurns: 3, maxTurns: 12 })).toBe(false);
  });

  it("无信号且达到默认轮数时按覆盖规则推进(兜底)", () => {
    expect(shouldAdvanceStage({ ...base, totalTurns: DEFAULT_STAGE_TURNS, maxTurns: DEFAULT_STAGE_TURNS })).toBe(true);
  });

  it("已覆盖全部方向且信号为 advance 时推进", () => {
    const s = parseStageSignal("[COVERAGE:已问 A,B | 未问 ] [STAGE_STATUS:advance]");
    expect(shouldAdvanceStage({ ...base, totalTurns: 3, signal: s })).toBe(true);
  });

  it("maxTurns 非法(<=0)时不应因它推进", () => {
    expect(shouldAdvanceStage({ ...base, totalTurns: 5, maxTurns: 0, signal: parseStageSignal("[STAGE_STATUS:continue]") })).toBe(false);
  });
});

describe("stripStageMarkers", () => {
  it("应剥离 STAGE_STATUS 标记", () => {
    const out = stripStageMarkers("回答正文。\n[STAGE_STATUS:advance]");
    expect(out).toBe("回答正文。");
    expect(out).not.toContain("STAGE_STATUS");
  });

  it("应剥离 COVERAGE 标记", () => {
    const out = stripStageMarkers("回答。\n[COVERAGE:已问 A,B | 未问 C]");
    expect(out).not.toContain("COVERAGE");
  });

  it("应剥离 think 块", () => {
    const out = stripStageMarkers("<think>内部推理</think>实际回答");
    expect(out).toBe("实际回答");
  });

  it("应剥离未闭合的尾部 think", () => {
    const out = stripStageMarkers("实际回答\n<think>还在想");
    expect(out).not.toContain("<think>");
  });

  it("无标记时原样返回(仅清理多余空行)", () => {
    expect(stripStageMarkers("普通回答")).toBe("普通回答");
  });

  it("不应误删正文中的方括号内容", () => {
    const out = stripStageMarkers("调用 foo[0] 取值");
    expect(out).toContain("foo[0]");
  });

  it("剥离后不得留下多个连续空行", () => {
    const out = stripStageMarkers("正文。\n\n\n[STAGE_STATUS:continue]");
    expect(out).not.toMatch(/\n{3,}/);
  });
});
