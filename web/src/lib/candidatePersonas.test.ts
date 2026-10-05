// 候选人画像单元测试
// Seam:CANDIDATE_PERSONAS 数据完整性 + getPersonaMeta()(纯函数)
//
// 为什么测:245 行权重表,直接决定群面里"谁爱说话/谁爱附和/谁爱抢话"。
// 数据错了不会报错,只会让群面看起来很怪 —— 而那正是产品的差异化功能。
import { describe, it, expect } from "vitest";
import { CANDIDATE_PERSONAS, getPersonaMeta } from "./candidatePersonas";
import type { CandidatePersona } from "@/types/agent";

describe("画像数据完整性", () => {
  it("应有 6 种画像(与 CandidatePersona 类型一致)", () => {
    // aggressive / calm / leader / follower / challenger / data_driven
    expect(CANDIDATE_PERSONAS.length).toBe(6);
  });

  it("画像数量应与 CandidatePersona 联合类型一致", () => {
    // 类型里写死了 6 个字面量;数据表多一个或少一个都会造成
    // 「UI 能选但调度引擎查不到」的静默不一致
    const declared: CandidatePersona[] = [
      "aggressive", "calm", "leader", "follower", "challenger", "data_driven",
    ];
    expect(CANDIDATE_PERSONAS.map((p) => p.value).sort())
      .toEqual([...declared].sort());
  });

  it("value 必须唯一", () => {
    const values = CANDIDATE_PERSONAS.map((p) => p.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("每个画像必须有 label/desc/prompt/icon/color", () => {
    for (const p of CANDIDATE_PERSONAS) {
      expect(p.label, `${p.value} 缺 label`).toBeTruthy();
      expect(p.desc, `${p.value} 缺 desc`).toBeTruthy();
      expect(p.prompt.length, `${p.value} prompt 太短`).toBeGreaterThan(30);
      expect(p.icon, `${p.value} 缺 icon`).toBeTruthy();
      expect(p.color, `${p.value} 缺 color`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  /*
   * ⭐ 权重必须落在 0-1。概率型字段越界(如 1.4)会让加权随机
   * 相对失真,而这不会报错 —— 只会让"激进"画像变得比预期更吵。
   */
  it("所有概率型权重必须在 [0,1] 内", () => {
    for (const p of CANDIDATE_PERSONAS) {
      const w = p.weights;
      for (const key of ["speakProb", "interruptProb", "agreeProb", "leadProb", "dataOriented", "conflictLevel"] as const) {
        const v = w[key];
        expect(typeof v, `${p.value}.${key} 非数字`).toBe("number");
        expect(v, `${p.value}.${key}=${v} 越界`).toBeGreaterThanOrEqual(0);
        expect(v, `${p.value}.${key}=${v} 越界`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("prompt 中不应泄漏前端内部术语", () => {
    for (const p of CANDIDATE_PERSONAS) {
      expect(p.prompt).not.toMatch(/lucide|ComponentType|cssProperties/i);
    }
  });
});

describe("画像的行为差异", () => {
  it("aggressive 的 speakProb 与 interruptProb 应最高", () => {
    const ag = getPersonaMeta("aggressive")!;
    for (const p of CANDIDATE_PERSONAS) {
      if (p.value === "aggressive") continue;
      expect(ag.weights.speakProb, `aggressive.speakProb 应高于 ${p.value}`)
        .toBeGreaterThan(p.weights.speakProb);
      expect(ag.weights.interruptProb, `aggressive.interruptProb 应高于 ${p.value}`)
        .toBeGreaterThan(p.weights.interruptProb);
    }
  });

  it("follower 的 agreeProb 应最高", () => {
    const fol = CANDIDATE_PERSONAS.find((p) => p.value === "follower");
    expect(fol, "缺少 follower 画像").toBeTruthy();
    for (const p of CANDIDATE_PERSONAS) {
      if (p.value === "follower") continue;
      expect(fol!.weights.agreeProb, `follower.agreeProb 应高于 ${p.value}`)
        .toBeGreaterThan(p.weights.agreeProb);
    }
  });

  it("leader 的 leadProb 应最高", () => {
    const lead = CANDIDATE_PERSONAS.find((p) => p.value === "leader");
    expect(lead, "缺少 leader 画像").toBeTruthy();
    for (const p of CANDIDATE_PERSONAS) {
      if (p.value === "leader") continue;
      expect(lead!.weights.leadProb, `leader.leadProb 应高于 ${p.value}`)
        .toBeGreaterThan(p.weights.leadProb);
    }
  });

  it("各画像的权重不应完全相同(否则区分度为零)", () => {
    const signatures = CANDIDATE_PERSONAS.map(
      (p) => JSON.stringify(p.weights)
    );
    expect(new Set(signatures).size).toBe(CANDIDATE_PERSONAS.length);
  });
});

describe("getPersonaMeta", () => {
  it("应按 value 查到画像", () => {
    expect(getPersonaMeta("aggressive")?.value).toBe("aggressive");
    expect(getPersonaMeta("calm")?.value).toBe("calm");
  });

  it("未知 value 应返回 null(调用方据此回退)", () => {
    expect(getPersonaMeta("不存在的画像")).toBeNull();
  });

  it("null/undefined 应返回 null", () => {
    expect(getPersonaMeta(null)).toBeNull();
    expect(getPersonaMeta(undefined)).toBeNull();
  });

  it("空串应返回 null", () => {
    expect(getPersonaMeta("")).toBeNull();
  });
});

