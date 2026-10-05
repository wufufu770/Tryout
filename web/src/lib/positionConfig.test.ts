// 岗位配置单元测试
// Seam:validatePositionSelection()(纯函数)—— 用户的选择 → 可否开始面试
//
// 为什么要校验而不是直接放行:
//   W3-2 起 questionPlanner 会在未设行业时返回 needsIndustry(不猜岗位)。
//   若前端不拦,用户会走进面试才发现"题库用不上"——这是最差的体验:
//   白等一次 LLM 调用才发现配置缺失。
//   所以在**开始之前**就要拦,并给出可操作的提示。
import { describe, it, expect } from "vitest";
import {
  validatePositionSelection,
  buildSessionPayload,
  describeDifficulty,
  type PositionSelection,
} from "./positionConfig";

describe("validatePositionSelection", () => {
  const READY = { total: 808, industries: [{ id: "backend", count: 71 }] };

  it("选定了有题的行业时应放行", () => {
    expect(validatePositionSelection({ industry: "backend", position: "后端工程师" }, READY).ok).toBe(true);
  });

  it("题库可用但选了没有题的行业应拦截(明确的配置错误)", () => {
    const r = validatePositionSelection({ industry: "nonexistent", position: "x" }, READY);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("noQuestionsForIndustry");
  });

  it("题库可用但某行业恰好 0 题时也应拦截", () => {
    const r = validatePositionSelection(
      { industry: "backend", position: "" },
      { total: 808, industries: [{ id: "backend", count: 0 }] }
    );
    expect(r.ok).toBe(false);
  });

  /*
   * 以下是"降级放行"的设计决策 —— 曾被我写成硬拦截,是错的。
   * 题库是**可选增强**不是前提:新 clone 的仓库默认没跑过 export:questionbank,
   * 硬拦等于让那部分用户完全无法使用面试功能。把增强变成了门槛。
   */
  it("题库整体不可用时应**放行**(降级),并标记原因供 UI 非阻断提示", () => {
    const r = validatePositionSelection(
      { industry: "backend", position: "" },
      { total: 0, industries: [], available: false }
    );
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("bankUnavailable");
  });

  it("题库不可用且设了行业也应放行(不因题库缺失阻断面试)", () => {
    const r = validatePositionSelection(
      { industry: "backend", position: "后端" },
      { total: 0, available: false }
    );
    expect(r.ok).toBe(true);
  });

  it("未选行业且题库可用时应放行 —— 未设岗位是合法状态,只是不用题库", () => {
    expect(validatePositionSelection({ industry: "", position: "" }, READY).ok).toBe(true);
  });

  it("统计对象缺少 industries 字段时应安全放行而非崩溃", () => {
    expect(validatePositionSelection({ industry: "backend", position: "" }, { total: 808 } as any).ok).toBe(true);
  });
});

describe("describeDifficulty", () => {
  it("应把 5 档难度映射为题库实际覆盖的档位", () => {
    expect(describeDifficulty("easy")).toBeTruthy();
    expect(describeDifficulty("hell")).toBeTruthy();
  });

  it("应说明困难档只命中中高级题", () => {
    const s = describeDifficulty("extreme");
    expect(s).toMatch(/高级|senior|较难/);
  });
});

describe("buildSessionPayload", () => {
  it("应把选择映射为 API 字段名", () => {
    const p = buildSessionPayload(
      { industry: "backend", position: "后端工程师" },
      { title: "我的面试", modelId: "deepseek", difficulty: "hard" }
    );
    expect(p).toMatchObject({
      title: "我的面试",
      modelId: "deepseek",
      difficulty: "hard",
      industry: "backend",
      position: "后端工程师",
    });
  });

  it("岗位名为空时应省略 position 键而不是传空串", () => {
    const p = buildSessionPayload(
      { industry: "backend", position: "" },
      { title: "t", modelId: "m", difficulty: "normal" }
    );
    expect("position" in p).toBe(false);
  });

  it("未选行业时应明确传 null(而不是省略)", () => {
    // 省略会让后端拿到 undefined,与显式 null 在语义上不同:
    // 显式 null 表示"用户明确没设",前端可据此提示。
    const p = buildSessionPayload(
      { industry: "", position: "" },
      { title: "t", modelId: "m", difficulty: "normal" }
    );
    expect(p.industry).toBeNull();
  });
});
