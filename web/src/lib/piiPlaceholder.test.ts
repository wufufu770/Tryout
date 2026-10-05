// piiPlaceholder 单元测试
// Seam:纯函数公开接口(findPlaceholders / makeRestorer / piiDisplayHint)
import { describe, it, expect } from "vitest";
import {
  findPlaceholders,
  makeRestorer,
  piiDisplayHint,
  PII_PLACEHOLDER_RE,
  type PiiMapping,
} from "./piiPlaceholder";

describe("findPlaceholders", () => {
  it("应识别文本中的手机号占位符", () => {
    const r = findPlaceholders("我的号码是 [PHONE_A1B2C3D4]，请记录");
    expect(r).toHaveLength(1);
    expect(r[0].placeholder).toBe("[PHONE_A1B2C3D4]");
    expect(r[0].type).toBe("PHONE");
  });

  it("应同时识别多种类型", () => {
    const text = "[PHONE_aaaaaaaa] [EMAIL_bbbbbbbb] [IDCARD_cccccccc]";
    const r = findPlaceholders(text);
    expect(r.map((x) => x.type)).toEqual(["PHONE", "EMAIL", "IDCARD"]);
  });

  it("重复占位符应去重", () => {
    const r = findPlaceholders("[PHONE_A1B2C3D4] 和 [PHONE_A1B2C3D4]");
    expect(r).toHaveLength(1);
  });

  it("无占位符应返回空数组", () => {
    expect(findPlaceholders("这是一段普通文本")).toEqual([]);
  });

  it("不应匹配位数不足的占位符", () => {
    // 只接受 8 位 hex,避免误伤普通方括号文本
    expect(findPlaceholders("[PHONE_ABC]")).toEqual([]);
    expect(findPlaceholders("[PHONE_A1B2C3D4E5]")).toEqual([]);
  });

  it("不应匹配未知类型前缀", () => {
    expect(findPlaceholders("[BANK_12345678]")).toEqual([]);
  });
});

describe("makeRestorer", () => {
  const mapping: PiiMapping[] = [
    { placeholder: "[PHONE_A1B2C3D4]", value: "13812345678", type: "PHONE" },
    { placeholder: "[EMAIL_bbbbbbbb]", value: "zhangwei@example.com", type: "EMAIL" },
  ];

  it("应还原已知占位符", () => {
    const restore = makeRestorer(mapping);
    expect(restore("我的号码是 [PHONE_A1B2C3D4]")).toBe("我的号码是 13812345678");
  });

  it("应还原多个不同类型的占位符", () => {
    const restore = makeRestorer(mapping);
    expect(restore("联系 [PHONE_A1B2C3D4] 或 [EMAIL_bbbbbbbb]")).toBe(
      "联系 13812345678 或 zhangwei@example.com"
    );
  });

  it("未知占位符应原样保留(不能替换成 undefined)", () => {
    const restore = makeRestorer(mapping);
    expect(restore("未知 [PHONE_99999999]")).toBe("未知 [PHONE_99999999]");
  });

  it("空映射应原样返回", () => {
    const restore = makeRestorer([]);
    expect(restore("[PHONE_A1B2C3D4]")).toBe("[PHONE_A1B2C3D4]");
  });

  it("应还原同一占位符的多次出现", () => {
    const restore = makeRestorer(mapping);
    expect(restore("[EMAIL_bbbbbbbb] 和 [EMAIL_bbbbbbbb]")).toBe(
      "zhangwei@example.com 和 zhangwei@example.com"
    );
  });

  it("无占位符文本应不变", () => {
    const restore = makeRestorer(mapping);
    const text = "这段文字没有任何占位符";
    expect(restore(text)).toBe(text);
  });
});

describe("piiDisplayHint", () => {
  it("应返回各类型的中文标签", () => {
    expect(piiDisplayHint("PHONE")).toBe("手机号");
    expect(piiDisplayHint("EMAIL")).toBe("邮箱");
    expect(piiDisplayHint("IDCARD")).toBe("身份证号");
  });
});

describe("PII_PLACEHOLDER_RE", () => {
  it("应为全局正则(可重复使用)", () => {
    // matchAll 要求 g 标志;此断言防止有人改成 /y 导致后续匹配失效
    expect(PII_PLACEHOLDER_RE.global).toBe(true);
  });
});
