// 简历解析单元测试
// Seam:parseResume()(纯正则,零依赖) + generateJDPrompt() + parseJDMatchResult()
//
// 为什么优先补这个模块:
//   1. 137 行、此前**零测试**
//   2. 输入是**完全不可控的外部文件**(用户上传的任意简历)
//   3. 纯正则实现,很容易在真实简历格式上静默失效
//      —— 解析失败不会报错,只是悄悄返回空字段,
//         面试官因此拿不到任何上下文,而用户不知道发生了什么。
import { describe, it, expect } from "vitest";
import { parseResume, generateJDPrompt, parseJDMatchResult } from "./resumeParser";

/** 一份贴近真实的中文简历 */
const RESUME = `姓名：张伟
电话：13812345678
邮箱：zhangwei@example.com

教育经历
2018.09 - 2022.06  清华大学 计算机科学与技术 本科

工作经历
2022.07 - 至今  字节跳动 | 后端工程师
2020.07 - 2022.06  美团 | 实习生

技能：Java、Spring、MySQL、Redis、Kafka
`;

describe("parseResume 基本字段", () => {
  it("应提取姓名", () => {
    expect(parseResume(RESUME).name).toBe("张伟");
  });

  it("应提取手机号", () => {
    expect(parseResume(RESUME).phone).toBe("13812345678");
  });

  it("应提取邮箱", () => {
    expect(parseResume(RESUME).email).toBe("zhangwei@example.com");
  });

  it("应保留原文", () => {
    expect(parseResume(RESUME).rawText).toBe(RESUME);
  });

  it("空输入不应崩溃", () => {
    const r = parseResume("");
    expect(r.name).toBeUndefined();
    expect(r.education).toEqual([]);
    expect(r.experience).toEqual([]);
    expect(r.skills).toEqual([]);
  });
});

describe("parseResume 手机号边界", () => {
  it("不应把身份证号误当手机号", () => {
    // 身份证 11010119900307XXXX 含 11 位数字串,容易误匹配
    const r = parseResume("姓名：李四\n身份证：110101199003078515");
    expect(r.phone).toBeUndefined();
  });

  it("应只取第一个手机号", () => {
    const r = parseResume("电话：13812345678 备用：13912345678");
    expect(r.phone).toBe("13812345678");
  });

  it("不以 1 开头的 11 位数字不应被当作手机号", () => {
    expect(parseResume("编号：23812345678").phone).toBeUndefined();
  });
});

describe("parseResume 教育经历", () => {
  it("应识别 时间段 + 学校", () => {
    const r = parseResume(RESUME);
    expect(r.education.length).toBeGreaterThan(0);
    expect(r.education[0].school).toContain("清华大学");
  });

  it("应保留时间段", () => {
    const r = parseResume(RESUME);
    expect(r.education[0].period).toContain("2018.09");
  });

  it("在读到今天时应补「至今」", () => {
    const r = parseResume("2022.07 - 至今  阿里巴巴 | 后端工程师");
    expect(r.experience[0]?.period ?? "").toContain("至今");
  });

  it("无教育段落时不应编造", () => {
    expect(parseResume("只有一行文字").education).toEqual([]);
  });
});

describe("parseResume 工作经历", () => {
  it("应识别 公司 | 职位 格式", () => {
    const r = parseResume(RESUME);
    expect(r.experience.length).toBeGreaterThan(0);
    const e = r.experience[0];
    expect(e.company).toContain("字节跳动");
    expect(e.role).toContain("后端工程师");
  });

  it("空格分隔(无竖线)也应被支持 —— R20 放宽了格式要求", () => {
    // ⚠️ 旧断言是"应返回空",那是本轮**要修的缺陷**:
    //    真实简历很少严格写 `公司|职位`,强制竖线导致经历静默解析为空。
    const r = parseResume("2022.07 - 至今  字节跳动 后端工程师");
    expect(r.experience.length).toBe(1);
    const combined = `${r.experience[0].company}${r.experience[0].role}`;
    expect(combined).toContain("字节跳动");
    expect(combined).toContain("后端工程师");
  });

  it("全角竖线也应被支持", () => {
    const r = parseResume("2022.07 - 至今  腾讯 ｜ 后端开发");
    expect(r.experience.length).toBe(1);
    expect(r.experience[0].role).toContain("后端开发");
  });
});

describe("parseResume 技能", () => {
  it("应拆分技能行并过滤噪声", () => {
    const r = parseResume(RESUME);
    expect(r.skills).toContain("Java");
    expect(r.skills).toContain("Spring");
  });

  it("应识别技术栈关键词(即使没有「技能:」行)", () => {
    const r = parseResume("熟悉 Docker 与 Kubernetes 的运维");
    expect(r.skills).toContain("Docker");
    expect(r.skills).toContain("Kubernetes");
  });

  it("技能不应重复", () => {
    const r = parseResume("技能：Java、Java\n其他：Java");
    expect(r.skills.filter((s) => s === "Java")).toHaveLength(1);
  });

  it("无技能信息时应返回空数组而非崩溃", () => {
    expect(parseResume("姓名：张三").skills).toEqual([]);
  });
});

describe("parseResume 鲁棒性(真实简历的脏数据)", () => {
  it("CRLF 应不影响解析", () => {
    const crlf = RESUME.replace(/\n/g, "\r\n");
    expect(parseResume(crlf).name).toBe("张伟");
  });

  it("全角冒号应被识别", () => {
    expect(parseResume("姓名：张伟").name).toBe("张伟");
  });

  it("英文简历也应能提取邮箱", () => {
    const r = parseResume("John Smith\nEmail: john@example.com");
    expect(r.email).toBe("john@example.com");
  });

  it("超长文本不应栈溢出或超时", () => {
    const huge = RESUME.repeat(500);
    const t0 = Date.now();
    expect(() => parseResume(huge)).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("纯数字/符号文本不应崩溃", () => {
    expect(() => parseResume("1234567890 !@#$%^&*()")).not.toThrow();
  });

  it("特殊字符不应破坏正则(如未闭合括号)", () => {
    expect(() => parseResume("( [ { \\ 简历内容")).not.toThrow();
  });

  it("极长单行(无换行)不应灾难性回溯", () => {
    // ⚠️ 真实风险:/^([\u4e00-\u9fa5a-zA-Z·\s]{2,20})$/m 遇到超长无空格行可能回溯
    const t0 = Date.now();
    expect(() => parseResume("简历内容".repeat(5000))).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("generateJDPrompt", () => {
  it("应包含姓名与技能", () => {
    const p = generateJDPrompt(parseResume(RESUME), "后端工程师 JD");
    expect(p).toContain("张伟");
    expect(p).toContain("Java");
    expect(p).toContain("后端工程师 JD");
  });

  it("姓名缺失时应给出占位而非 undefined", () => {
    const p = generateJDPrompt(parseResume(""), "JD");
    expect(p).toContain("未知");
    expect(p).not.toContain("undefined");
  });

  it("应要求严格 JSON 输出", () => {
    const p = generateJDPrompt(parseResume(RESUME), "JD");
    expect(p).toMatch(/JSON/);
  });
});

describe("parseJDMatchResult", () => {
  const FULL = {
    matchScore: 80, matchedSkills: ["Java"], missingSkills: ["Go"],
    strengths: ["基础扎实"], weaknesses: ["缺 Go 经验"],
    suggestedQuestions: ["做过 Go 项目吗"], advice: "补一个 Go 项目",
  };

  it("应解析字段完整的 JSON", () => {
    const r = parseJDMatchResult(JSON.stringify(FULL));
    expect(r?.matchScore).toBe(80);
    expect(r?.matchedSkills).toEqual(["Java"]);
  });

  it("应容忍 ```json 围栏", () => {
    const r = parseJDMatchResult('```json\n' + JSON.stringify({ ...FULL, matchScore: 75 }) + '\n```');
    expect(r?.matchScore).toBe(75);
  });

  it("应容忍前后噪声", () => {
    const r = parseJDMatchResult('分析如下:\n' + JSON.stringify({ ...FULL, matchScore: 60 }) + '\n以上。');
    expect(r?.matchScore).toBe(60);
  });

  it("非法 JSON 应返回 null 而非崩溃", () => {
    expect(parseJDMatchResult("{broken")).toBeNull();
    expect(parseJDMatchResult("")).toBeNull();
  });

  it("缺必需字段时应返回 null(R20 新增结构校验)", () => {
    // 此前只做 JSON.parse,LLM 少返回一个字段时下游拿到 undefined 会在渲染时崩。
    // 现在缺字段视为无效结果,让调用方走「解析失败」分支。
    expect(parseJDMatchResult('{"matchScore":80}')).toBeNull();
    const noScore = { ...FULL } as any; delete noScore.matchScore;
    expect(parseJDMatchResult(JSON.stringify(noScore))).toBeNull();
  });

  it("matchScore 非数字时应拒绝", () => {
    expect(parseJDMatchResult(JSON.stringify({ ...FULL, matchScore: "80" }))).toBeNull();
  });

  it("数组字段含非字符串时应拒绝", () => {
    expect(parseJDMatchResult(JSON.stringify({ ...FULL, matchedSkills: ["Java", 123] }))).toBeNull();
  });
});
