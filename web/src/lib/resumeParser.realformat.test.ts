// 真实简历格式兼容性测试
// Seam:parseResume() 在**真实中文简历**上的行为
//
// 背景(R20):用真实简历端到端验证时发现 parseResume 的正则**比真实格式窄得多**:
//   1. 时间格式只认 `2022.07 - 至今`,而真实简历普遍写 `2023 年 6 月 – 至今`
//   2. 经历强制要求 `公司 | 职位` 竖线,而真实简历多是 `职位, 公司 年份`(职位在前!)
//   3. 技能行把 `研究领域 : 语音识别` 的标签冒号也当成技能
// 后果:教育/经历**静默返回空** —— 用户以为导入成功,面试官却拿不到任何上下文。
//
// 本文件用真实简历的**实际文本**锁定期望行为。
import { describe, it, expect } from "vitest";
import { parseResume } from "./resumeParser";

/** 从 resume1.pdf 提取的真实文本片段(中文年月日 + 职位在前) */
const RESUME1 = `无名氏
GitHub Email: example@email.com | Mobile: +86 138xxxxxxxx
算法研究员
我是一名在自然语言处理领域拥有丰富经验的算法研究员。我熟练掌握 PyTorch、TensorFlow 等框架。
技能
研究领域 : 语音识别, 多模态学习, 自然语言处理
常用框架 : PyTorch, TensorFlow, transformers
编程语言 : Python, C++, Java
工作经历
高级算法工程师, 某知名 AI 公司 2023 年 6 月 – 至今
• 负责大规模语音识别系统的研发与优化
算法研究员, 某互联网大厂 2021 年 7 月 – 2023 年 5 月
• 参与多模态预训练模型的研发
实习经历
某 985 高校人工智能实验室 2018 年 9 月 – 2019 年 2 月
• 参与自然语言处理相关科研项目
学术背景
计算机科学与技术专业硕士, 某知名理工大学 2017 年 9 月 – 2019 年 6 月
• GPA: 3.8/4.0
`;

/** 从 resume2 提取的真实片段(时间在末尾,学校在前) */
const RESUME2 = `张三
zhangsan.io · me@zhangsan.io
教育经历
家里蹲大学·计算机学院 硕士生 | 计算机技术
某某描述 2024.09 -- 2027.06（预计）
家里蹲大学·软件工程学院 软件工程
某某描述 2020.09 -- 2024.06
实践经历
某大厂 实习生
某某 2021.11 -- 至今
• 工作职责: 某某
`;

/* ---------- 时间格式 ---------- */

describe("中文年月日时间格式", () => {
  it("应识别 `2023 年 6 月 – 至今`", () => {
    const r = parseResume(RESUME1);
    expect(r.experience.length).toBeGreaterThan(0);
    expect(r.experience[0].period).toContain("2023");
    expect(r.experience[0].period).toContain("至今");
  });

  it("应识别 `2021 年 7 月 – 2023 年 5 月` 的起止", () => {
    const r = parseResume(RESUME1);
    const withEnd = r.experience.find((e) => e.period?.includes("2021"));
    expect(withEnd).toBeTruthy();
    expect(withEnd!.period).toContain("2023");
  });

  it("应识别 `--` 分隔符(resume2 用的就是这个)", () => {
    const r = parseResume(RESUME2);
    expect(r.education.length).toBeGreaterThan(0);
    expect(r.education.some((e) => e.period?.includes("2024"))).toBe(true);
  });

  it("应识别 `至今` / `present` / `预计` 作为结束", () => {
    const r = parseResume(RESUME2);
    expect(r.experience.length).toBeGreaterThan(0);
  });
});

/* ---------- 经历：职位在前 vs 公司在前 ---------- */

describe("经历字段顺序兼容", () => {
  it("应识别 `职位, 公司 年份` (职位在前,resume1 的写法)", () => {
    const r = parseResume(RESUME1);
    const first = r.experience[0];
    // 无论判定成 role 还是 company,两段文本都必须被保留
    const combined = `${first?.company || ""} ${first?.role || ""}`;
    expect(combined).toContain("算法工程师");
    expect(combined).toContain("AI 公司");
  });

  it("应识别 `公司 职位` (公司在前,竖线或空格)", () => {
    const r = parseResume(RESUME1 + "\n2020.01 - 至今  阿里巴巴 | 后端开发");
    const hit = r.experience.find((e) => (e.company || "").includes("阿里") || (e.role || "").includes("阿里"));
    expect(hit).toBeTruthy();
  });

  it("应识别简历2 的 `公司 职位` 空格分隔", () => {
    const r = parseResume(RESUME2);
    expect(r.experience.length).toBeGreaterThan(0);
  });
});

/* ---------- 教育经历 ---------- */

describe("教育经历格式兼容", () => {
  it("应识别 `学校·学院 学位` (resume2 的写法)", () => {
    const r = parseResume(RESUME2);
    expect(r.education.length).toBeGreaterThan(0);
    expect(r.education.some((e) => (e.school || "").includes("家里蹲大学"))).toBe(true);
  });

  it("应识别 `专业, 学校 年份` (resume1 的写法)", () => {
    const r = parseResume(RESUME1);
    expect(r.education.length).toBeGreaterThan(0);
  });

  it("应识别 `大学` 结尾的传统格式", () => {
    const r = parseResume("2018.09 - 2022.06  清华大学 计算机科学与技术 本科");
    expect(r.education.length).toBe(1);
    expect(r.education[0].school).toContain("清华大学");
  });
});

/* ---------- 技能噪声过滤 ---------- */

describe("技能噪声过滤", () => {
  it("不应把标签冒号当成技能(`研究领域 : 语音识别`)", () => {
    const r = parseResume(RESUME1);
    expect(r.skills).not.toContain(":");
    expect(r.skills).not.toContain("：");
  });

  it("应保留冒号右侧的真实技能", () => {
    const r = parseResume(RESUME1);
    expect(r.skills).toContain("PyTorch");
    expect(r.skills).toContain("Python");
  });

  it("不应把纯标点或单字符当技能", () => {
    const r = parseResume("技能：Java、、Python、-、+，");
    expect(r.skills).toContain("Java");
    expect(r.skills).not.toContain("、");
    expect(r.skills).not.toContain("+");
  });

  it("应过滤明显是描述性长句的碎片", () => {
    const r = parseResume("技能：熟练掌握各种分布式系统设计理念与实践");
    // 这不是技能名,应该被排除或至少不被当成技能
    expect(r.skills).not.toContain("熟练掌握各种分布式系统设计理念与实践");
  });
});

/* ---------- 静默失败 ---------- */

describe("解析结果的可解释性", () => {
  it("应能区分「完全没解析出东西」与「解析出部分内容」", () => {
    const empty = parseResume("这是一段没有任何简历结构的普通文字");
    expect(empty.education).toEqual([]);
    expect(empty.experience).toEqual([]);
    // 但姓名/邮箱/技能可能仍提取到 —— 这正是「静默部分失败」的来源
  });

  it("垃圾输入不应崩溃", () => {
    expect(() => parseResume(RESUME1 + RESUME2)).not.toThrow();
  });
});
