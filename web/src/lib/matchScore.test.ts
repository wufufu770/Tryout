// JD 匹配度计算单元测试
// Seam:computeMatchScore()(纯函数)
//
// 背景(R21):`MaterialPage.tsx` 里此前的写法是
//   `parsed.skills.length ? round(matched/skills*100) : 0`
// 当简历解析失败(技能 0 条)时,直接给 **0 分** ——
// 用户看到"匹配度 0%"会以为是自己能力差,实际是**解析器没读出来**。
// 这是"假数据"的又一次出现:用"0 分"掩盖了"我不知道"。
import { describe, it, expect } from "vitest";
import { computeMatchScore, describeMatchQuality } from "./matchScore";

describe("computeMatchScore", () => {
  it("有技能且全部匹配应给 100", () => {
    const r = computeMatchScore({ skills: ["Java", "Redis"], matchedSkills: ["Java", "Redis"] });
    expect(r.score).toBe(100);
  });

  it("有技能全部不匹配应给 0", () => {
    const r = computeMatchScore({ skills: ["Java"], matchedSkills: [] });
    expect(r.score).toBe(0);
  });

  it("部分匹配应按比例给分", () => {
    const r = computeMatchScore({ skills: ["Java", "Redis", "Go", "Rust"], matchedSkills: ["Java", "Redis"] });
    expect(r.score).toBe(50);
  });

  /*
   * ⭐ 核心修复:简历技能为 0 条时,**不能**返回 0 分。
   * 0 分在用户眼里是"你什么都不会",而真相是"我没能读懂你的简历"。
   * 必须返回 null(表示无法计算),由调用方展示"解析失败"而非"0 分"。
   */
  it("简历技能为 0 条时应返回 null 而非 0 分", () => {
    const r = computeMatchScore({ skills: [], matchedSkills: [] });
    expect(r.score).toBeNull();
    expect(r.reason).toBe("noSkillsInResume");
  });

  it("空 JD 也不应给 0 分(应说明无法计算)", () => {
    const r = computeMatchScore({ skills: ["Java"], matchedSkills: [], jdEmpty: true });
    expect(r.score).toBeNull();
    expect(r.reason).toBe("emptyJd");
  });

  it("matchedSkills 超过 skills(数据异常)时不应超过 100", () => {
    const r = computeMatchScore({ skills: ["Java"], matchedSkills: ["Java", "Go", "Rust"] });
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("分母应为简历技能总数(不是 JD 技能数)", () => {
    // 简历 4 项技能,匹配 2 项 → 50%,而不是 2/jd技能数
    const r = computeMatchScore({ skills: ["a", "b", "c", "d"], matchedSkills: ["a", "b"] });
    expect(r.score).toBe(50);
  });

  it("分数应取整", () => {
    const r = computeMatchScore({ skills: ["a", "b", "c"], matchedSkills: ["a"] });
    expect(r.score).toBe(33);
  });
});

describe("describeMatchQuality", () => {
  it("无法计算时应说明原因", () => {
    const s = describeMatchQuality({ skills: [], matchedSkills: [] });
    expect(s.kind).toBe("unknown");
    expect(s.label).toBeTruthy();
  });

  it("高分应给出正向描述", () => {
    const s = describeMatchQuality({ skills: ["Java", "Go"], matchedSkills: ["Java", "Go"] });
    expect(s.kind).toBe("high");
  });

  it("低分应给出警示描述", () => {
    const s = describeMatchQuality({ skills: ["Java", "Go", "Rust"], matchedSkills: ["Java"] });
    expect(s.kind).toBe("low");
  });
});
