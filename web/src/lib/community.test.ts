// 社区导入校验单元测试
// Seam:validateAgent() / validateExperience() / normalizeAgent()(纯函数)
//
// 为什么测这个:导入的 JSON 来自**用户粘贴的 URL 或文件**,完全不可控。
// 校验不过会怎样?—— 数据进 SQLite、进 system prompt。
import { describe, it, expect } from "vitest";
import { validateAgent, validateExperience, normalizeAgent } from "./community";

const GOOD_AGENT = {
  kind: "interviewx-agent",
  name: "后端技术官",
  promptTemplate: "你是资深后端面试官",
  role: "tech",
  tone: "aggressive",
  difficulty: 7,
  focusAreas: ["Java", "系统设计"],
};

describe("validateAgent 新格式", () => {
  it("合法数据应通过", () => {
    expect(validateAgent(GOOD_AGENT).valid).toBe(true);
  });

  it("非对象应拒绝", () => {
    expect(validateAgent(null).valid).toBe(false);
    expect(validateAgent("字符串").valid).toBe(false);
    expect(validateAgent(123).valid).toBe(false);
  });

  it("缺 name 应拒绝", () => {
    const r = validateAgent({ ...GOOD_AGENT, name: "" });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("name");
  });

  it("缺 promptTemplate 应拒绝", () => {
    expect(validateAgent({ ...GOOD_AGENT, promptTemplate: 123 }).valid).toBe(false);
  });

  it("非法 role 应拒绝(白名单)", () => {
    // 防止注入任意 role 值影响后续 UI 逻辑
    const r = validateAgent({ ...GOOD_AGENT, role: "hacker" });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("role");
  });

  it("非法 tone 应拒绝", () => {
    expect(validateAgent({ ...GOOD_AGENT, tone: "evil" }).valid).toBe(false);
  });

  it("difficulty 越界应拒绝", () => {
    expect(validateAgent({ ...GOOD_AGENT, difficulty: 0 }).valid).toBe(false);
    expect(validateAgent({ ...GOOD_AGENT, difficulty: 11 }).valid).toBe(false);
    expect(validateAgent({ ...GOOD_AGENT, difficulty: "5" }).valid).toBe(false);
  });

  it("focusAreas 非数组应拒绝", () => {
    expect(validateAgent({ ...GOOD_AGENT, focusAreas: "Java" }).valid).toBe(false);
  });

  it("可选字段缺失时应通过", () => {
    const { role, tone, difficulty, focusAreas, ...minimal } = GOOD_AGENT;
    expect(validateAgent(minimal).valid).toBe(true);
  });
});

describe("validateAgent 旧格式兼容", () => {
  const OLD = {
    format: "ixagent",
    agent: { name: "老面试官", role: "hr", config: { promptTemplate: "你是 HR", tone: "gentle" } },
  };

  it("旧格式应通过", () => {
    expect(validateAgent(OLD).valid).toBe(true);
  });

  it("旧格式缺 config 应拒绝", () => {
    expect(validateAgent({ format: "ixagent", agent: { name: "x" } }).valid).toBe(false);
  });

  it("未知格式应拒绝", () => {
    const r = validateAgent({ kind: "something-else" });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("类型");
  });
});

describe("normalizeAgent 归一化", () => {
  it("应把新旧格式统一为新格式", () => {
    const old = { format: "ixagent", agent: { name: "老面试官", role: "hr", config: { promptTemplate: "P" } } };
    const n = normalizeAgent(old);
    expect(n.kind).toBe("interviewx-agent");
    expect(n.name).toBe("老面试官");
    expect(n.promptTemplate).toBe("P");
  });

  it("非法 role 应降级为 custom 而非原样带入", () => {
    const n = normalizeAgent({ ...GOOD_AGENT, role: "hacker" });
    expect(n.role).toBe("custom");
  });

  it("越界 difficulty 应降级为 5", () => {
    expect(normalizeAgent({ ...GOOD_AGENT, difficulty: 999 }).difficulty).toBe(5);
  });

  it("focusAreas 非字符串元素应被过滤", () => {
    const n = normalizeAgent({ ...GOOD_AGENT, focusAreas: ["Java", 123, null, "Redis"] });
    expect(n.focusAreas).toEqual(["Java", "Redis"]);
  });

  it("无法识别的格式应抛错", () => {
    expect(() => normalizeAgent({ kind: "unknown" })).toThrow();
  });

  /*
   * ⚠️ 未知字段的处理:新格式用了 `...data` 展开,
   * 意味着导入文件里的任意额外字段会被原样带进 ShareableAgent。
   * 这条测试记录**当前行为**;若将来改为白名单挑选,需同步更新。
   */
  it("新格式会保留未知字段(当前行为,可能需改为白名单)", () => {
    const n = normalizeAgent({ ...GOOD_AGENT, evilField: "<script>alert(1)</script>" } as any);
    expect((n as any).evilField).toBe("<script>alert(1)</script>");
  });
});

describe("validateExperience 面经校验", () => {
  const GOOD = {
    kind: "interviewx-experience",
    company: "字节跳动",
    position: "后端",
    round: "一面",
    difficulty: 5,
    questions: [{ question: "讲讲 HashMap" }],
  };

  it("合法面经应通过", () => {
    expect(validateExperience(GOOD).valid).toBe(true);
  });

  it("非对象应拒绝", () => {
    expect(validateExperience(null).valid).toBe(false);
  });

  it("缺 questions 应拒绝", () => {
    expect(validateExperience({ ...GOOD, questions: [] }).valid).toBe(false);
  });

  it("⚠️ 字段名是 question 而非 q(experiences.ts 用的是 q,导出时做了映射)", () => {
    // 记录这个易错点:两套字段名并存,导出路径做了 q -> question 映射,
    // 所以往返通,但手写导入文件必须用 question。
    expect(validateExperience({ ...GOOD, questions: [{ q: "错了" }] }).valid).toBe(false);
  });

  it("questions 非数组应拒绝", () => {
    expect(validateExperience({ ...GOOD, questions: "问题" }).valid).toBe(false);
  });

  it("questions 内元素缺 question 字段应拒绝(与 ShareableExperience 一致)", () => {
    expect(validateExperience({ ...GOOD, questions: [{ q: "无 question 字段" }] }).valid).toBe(false);
  });
});
