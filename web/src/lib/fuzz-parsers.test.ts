// 属性/模糊测试:**解析层** —— 放在 web 侧,因为要 import `scoringEngine.ts`
//
// ## 为什么做这个
// goal 的「全绿后继续扩展」列了模糊测试与属性测试,一直没做。
// 变异测试(R44~R48)找的是「**已有断言抓不住**的破坏」;
// 模糊测试找的是「**我根本没想到的输入**」——两者互补:
//
//   变异测试:已知输入形态下,测试套件够不够强
//   模糊测试:未知输入形态下,代码会不会崩
//
// ## 为什么这个文件特别重要
// `parseDimensionScore` 的输入是 **LLM 的输出**。
// 那不是我能完全控制的字符串:它可能截断、可能带 markdown、可能用中文引号、
// 可能是空串、可能嵌套几千层。
// 而 R40(ISSUE-070)刚给这里加了「截断降级」路径 ——
// **最该被模糊测试的恰恰是这个新路径**。
//
// ## 硬性要求(本文件的全部价值所在)
// **任何输入都不得抛异常。**
// 抛异常 ⇒ 500 ⇒ 用户看到"服务器内部错误",且**错误信息会进日志**。
// 返回 `null` 才是契约内的行为。
import { describe, it, expect } from "vitest";
import { parseDimensionScore, buildDimensionPrompt, sanitizeForScoring, wrapUntrusted } from "./evaluation/scoringEngine";

/* ---------------- 确定性伪随机:失败可复现 ---------------- */
function makeRng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

const CHARS = [
  "", " ", "\n", "\t", "\0", "{", "}", "[", "]", '"', "'", "\\", "/",
  "A", "a", "0", "9", "中", "😀", "﻿", "", "", "",
  "\\\\", "\\u0041", "%s", "${}", "{{", "<script>", "..",
  "A".repeat(200), "中".repeat(200), "\ud800", "\udfff", "　",
];

function fuzzString(rng: () => number, maxLen = 40) {
  const n = Math.floor(rng() * maxLen);
  let s = "";
  for (let i = 0; i < n; i++) s += CHARS[Math.floor(rng() * CHARS.length)];
  return s;
}

/** 截断:随机拼出"看起来像 JSON"的碎片 */
function fuzzTruncatedJson(rng: () => number) {
  const pieces = [
    '{"reasoning":"', '"matched_anchor_id":"', '"evidence":["', '"confidence":"',
    "}", "]", "},", "],", '","', "\\", "null", "true", "1.5",
  ];
  const p = pieces[Math.floor(rng() * pieces.length)];
  return fuzzString(rng, 20) + p + fuzzString(rng, 20);
}

/** 深嵌套:JSON 栈溢出是解析层最经典的崩法 */
function fuzzDeepNest(rng: () => number) {
  const n = 10 + Math.floor(rng() * 400);
  return "[".repeat(n) + fuzzString(rng, 10) + "]".repeat(n);
}

describe("模糊测试:parseDimensionScore(LLM 输出的解析器)", () => {
  it("2000 条畸形输入一律不抛异常,且返回值自洽", () => {
    const rng = makeRng(0xc0ffee);
    const gens = [fuzzString, fuzzTruncatedJson, fuzzDeepNest];
    const throws: Array<{ input: string; err: string }> = [];
    let ok = 0, nulled = 0;

    for (let i = 0; i < 2000; i++) {
      const input = gens[i % gens.length](rng);
      let r: any;
      try {
        r = parseDimensionScore(input, "技术深度");
      } catch (e: any) {
        if (throws.length < 5) throws.push({ input: input.slice(0, 80), err: e.message });
        continue;
      }
      if (r === null) { nulled++; continue; }
      ok++;
      expect(typeof r.matchedAnchorId).toBe("string");
      expect(r.score).toBeGreaterThanOrEqual(1);
      expect(r.score).toBeLessThanOrEqual(5);
      expect(r.dimensionName).toBe("技术深度");
      expect(Array.isArray(r.evidence)).toBe(true);
    }

    expect(throws, `${throws.length} 条畸形输入让解析器抛了异常`).toEqual([]);
    // 两种结果都合法;只要"抛出"与"半成品"为 0 即可
    expect(ok + nulled).toBe(2000);
  });

  it("结构完整但语义无效的 JSON 不得给出分数(否则是静默给假分)", () => {
    const bad = [
      '{"matched_anchor_id":"Z"}',      // 非法锚点
      '{"matched_anchor_id":123}',      // 类型错
      '{"matched_anchor_id":null}',
      '{"matched_anchor_id":""}',
      '{"matched_anchor_id":"AB"}',     // 两位
      '{}',
      '{"reasoning":"只有 reasoning 没有 anchor"}',
    ];
    for (const s of bad) {
      expect(parseDimensionScore(s, "技术深度"), `不该给出分数却给了 ← 输入 ${s}`).toBeNull();
    }
  });

  it("evidence 类型非法时**降级为空但仍给分**(R40 的容错设计,不是 bug)", () => {
    // ⚠️ 我第一版把这条写进了「不该给出分数」的列表,测试红了。
    //   查 `parseDimensionScore` 后确认:evidence 非数组时走 `Array.isArray(...) ? ... : []`
    //   降级为空,**这是 R40 有意的容错** —— 判据(anchor)有效就不该因为证据格式问题作废。
    //   这条测试的意义是把这个设计**锁定下来**,免得以后有人"顺手修正"成整条丢弃。
    for (const s of [
      '{"matched_anchor_id":"A","evidence":"不是数组"}',
      '{"matched_anchor_id":"A","evidence":123}',
      '{"matched_anchor_id":"B","evidence":{}}',
    ]) {
      const r = parseDimensionScore(s, "技术深度");
      expect(r, `evidence 格式问题不该让整条作废 ← ${s}`).not.toBeNull();
      expect(r!.evidence).toEqual([]);
      expect(r!.noEvidence).toBe(true);
    }
  });

  it("返回值自洽:分数由锚点映射而来,noEvidence 与证据数量一致", () => {
    const rng = makeRng(12345);
    const SCORE: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
    for (let i = 0; i < 500; i++) {
      const L = "ABCDE"[Math.floor(rng() * 5)];
      const s = JSON.stringify({
        reasoning: fuzzString(rng, 20),
        matched_anchor_id: L,
        evidence: rng() > 0.5 ? [fuzzString(rng, 15)] : [],
        confidence: "high",
      });
      const r = parseDimensionScore(s, "技术深度");
      if (!r) continue;
      expect(r!.matchedAnchorId).toBe(L);
      expect(r!.score).toBe(SCORE[L]);
      expect(r!.noEvidence).toBe(r!.evidence.length === 0);
    }
  });
});

describe("模糊测试:prompt 构造层不得抛异常", () => {
  it("buildDimensionPrompt 面对任意 question/answer/reference 不得抛异常", () => {
    const rng = makeRng(999);
    const dim = { key: "technical", name: "技术深度", anchors: { 1: "低", 5: "高" } } as any;
    for (let i = 0; i < 400; i++) {
      const q = fuzzString(rng, 60);
      const a = fuzzString(rng, 200);
      const ref: any =
        i % 3 === 0
          ? { keyPoints: [fuzzString(rng, 20)], referenceAnswer: fuzzString(rng, 100), questionType: fuzzString(rng, 10) }
          : i % 3 === 1
            ? { keyPoints: [], referenceAnswer: "", questionType: "" }
            : undefined;
      const p = buildDimensionPrompt(dim, q, a, ref);
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it("sanitizeForScoring / wrapUntrusted 对任意输入不抛异常且返回字符串", () => {
    const rng = makeRng(4242);
    for (let i = 0; i < 500; i++) {
      const s = fuzzString(rng, 100);
      expect(typeof sanitizeForScoring(s)).toBe("string");
      expect(typeof wrapUntrusted(s)).toBe("string");
    }
  });
});
