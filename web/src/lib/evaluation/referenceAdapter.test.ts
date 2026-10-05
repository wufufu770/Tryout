// 参考答案适配单元测试
// Seam:adaptReference() / extractScoringHints()(纯函数)
//
// 背景(V7):全库 808 题中 226 题(28%)参考答案超 500 字符,
// 集中在 coding 题(126 条完整代码),最长 1818 字符。
// 评估 prompt 要同时装 问题+回答+参考答案+锚点,过长会挤压并推高成本。
// 但**题库内容本身没错** —— 完整代码对人是有价值的学习材料。
// 所以只在**评估链路**裁剪,不动原始资产。
import { describe, it, expect } from "vitest";
import { adaptReference, extractScoringHints } from "./referenceAdapter";

describe("adaptReference", () => {
  it("短答案应原样返回", () => {
    const r = adaptReference("B+ 树因为范围查询高效。");
    expect(r.text).toBe("B+ 树因为范围查询高效。");
    expect(r.truncated).toBe(false);
  });

  it("空值应安全处理", () => {
    expect(adaptReference(null).text).toBe("");
    expect(adaptReference(undefined).originalLength).toBe(0);
  });

  it("长答案应被裁剪并声明", () => {
    const long = "句子。".repeat(200);
    const r = adaptReference(long);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(long.length);
    expect(r.text).toMatch(/已裁剪/);
    expect(r.originalLength).toBe(long.length);
  });

  it("应在句读边界截断,不得劈开半句", () => {
    const long = "第一句话内容在这里。第二句话内容也在这里。".repeat(30);
    const r = adaptReference(long, undefined, 200);
    const body = r.text.split("\n")[0];   // 去掉尾部的裁剪声明
    // 裁剪点落在句号之后 → 正文最后 20 字符应以完整句 + 句号收尾
    const tail = body.trim().slice(-20);
    expect(tail).toContain("。");
    // 不得以半个词/半句收尾:句号后不应还有残留字符
    expect(body.trim().endsWith("。")).toBe(true);
    // 正文中间不应有换行(段落未被劈开)
    expect(body).not.toContain("\n");
  });

  it("coding 题应使用更短的上限(代码自解释,判分靠锚点)", () => {
    const long = "代码行。".repeat(200);
    const code = adaptReference(long, "coding");
    const tech = adaptReference(long, "technical");
    expect(code.text.length).toBeLessThan(tech.text.length);
  });

  it("显式传入 max 应优先于题型默认值", () => {
    const long = "句子。".repeat(200);
    const r = adaptReference(long, "coding", 800);
    expect(r.text.length).toBeGreaterThan(adaptReference(long, "coding").text.length);
  });

  it("无句读的长串应退化为硬切但不崩溃", () => {
    const r = adaptReference("a".repeat(2000), undefined, 100);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(200);
  });
});

describe("extractScoringHints", () => {
  it("应优先抽取含数字/阈值的句子", () => {
    const ref = "随便说点什么。这里是扩容因子 0.75。再说点别的。链表长度达到 8 才树化。";
    const hints = extractScoringHints(ref);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.some((h) => /0\.75|8/.test(h))).toBe(true);
  });

  it("应限制数量", () => {
    const ref = Array.from({ length: 50 }, (_, i) => `阈值是 ${i} 这样的数字句子`).join("。");
    expect(extractScoringHints(ref, 3)).toHaveLength(3);
  });

  it("空输入应返回空数组", () => {
    expect(extractScoringHints(null)).toEqual([]);
    expect(extractScoringHints("")).toEqual([]);
  });

  it("过短或过长的句子应被跳过", () => {
    const ref = "短。太短了。";
    const hints = extractScoringHints(ref);
    expect(hints.every((h) => h.length >= 8 && h.length <= 80)).toBe(true);
  });

  it("结果不应重复", () => {
    const ref = "阈值是 8 时树化。阈值是 8 时树化。";
    const hints = extractScoringHints(ref);
    expect(new Set(hints).size).toBe(hints.length);
  });

  it("无判分信息的答案应返回空数组而非噪声", () => {
    expect(extractScoringHints("随便写点什么就好。")).toEqual([]);
  });
});

describe("英文边界(小数/缩写不应被误切)", () => {
  it("不应在小数点处截断", () => {
    const long = `The load factor is 0.75 which means ${"and it grows linearly under load. ".repeat(20)}`;
    const r = adaptReference(long, "technical", 120);
    // 若在小数点处误切,会出现悬空的 "0."
    expect(r.text).not.toMatch(/0\.\s*$/);
  });

  it("应在英文句号后截断,不得截在句中", () => {
    const long = `First sentence here. Second sentence here. ${"Third sentence here. ".repeat(20)}`;
    const r = adaptReference(long, "technical", 100);
    const body = r.text.split("\n")[0];   // 尾部还有裁剪声明,只看正文
    expect(body.trim().endsWith(".")).toBe(true);
    expect(body).not.toMatch(/\bThird$/);
  });
});
