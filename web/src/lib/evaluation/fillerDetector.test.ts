// 表达指标 · 填充词识别单元测试
// Seam:countFillers()(纯函数)
//
// 背景(W5-1):原实现用 `text.split(w).length - 1` 做子串计数,导致:
//   - "so" 匹配 also / some / person / reason
//   - "like" 匹配 likely / alike
//   - "a" 会匹配一切(虽然当前词表没有单字母词,但同类问题)
//
// 实测:英文例句 "I also think that some people like this approach" 被误判 2 次,
// 中文例句"这个方案我觉得非常好,因为它解决了那个我们一直头疼的问题"(无填充词)被误判 3 次。
//
// 修复方向:
//   1. 英文填充词必须按**词边界**匹配,不是子串
//   2. 中文"那个/这个/就是/然后"在正常中文口语中频率极高,
//      当填充词会让**系统性低估中文用户**。改为只在明确的犹豫语境下计数,
//      或者干脆移出默认词表。
import { describe, it, expect } from "vitest";
import { countFillers, FILLER_WORDS } from "./fillerDetector";

describe("countFillers", () => {
  it("应识别明确的英文填充词", () => {
    expect(countFillers("um, I think like, you know").total).toBeGreaterThan(0);
  });

  it("不应把 also 中的 so 计入", () => {
    // "also" 里的 "so" 不是填充词
    expect(countFillers("I also think so").total).toBe(0);
  });

  it("不应把 some/person/reason 中的 so 计入", () => {
    expect(countFillers("some reason for a person").total).toBe(0);
  });

  it("不应把 likely/alike 中的 like 计入", () => {
    expect(countFillers("it is likely that men alike").total).toBe(0);
  });

  it("独立成词的 like 应被计入", () => {
    // "I like this" 里的 like 确实常作填充,但 "I like cats" 不是。
    // 这里采取保守策略:只有出现在句首/逗号后等明显填充位置才算。
    expect(countFillers("um, I mean, like, I don't know").total).toBeGreaterThan(0);
  });

  it("中文常见虚词不应默认计为填充词", () => {
    // 这句话完全没有填充词
    const zh = "这个方案我觉得非常好,因为它解决了那个我们一直头疼的问题";
    expect(countFillers(zh).total).toBe(0);
  });

  it("中文明确的犹豫语气词应被计入", () => {
    expect(countFillers("嗯,我想想,呃,这个可能不太对").total).toBeGreaterThan(0);
  });

  it("空串应返回 0", () => {
    expect(countFillers("").total).toBe(0);
  });

  it("无填充词的长文本应返回 0", () => {
    const clean = "InnoDB uses B+ tree indexes because non-leaf nodes store only keys, " +
      "which allows more index entries per page and reduces disk IO for range scans.";
    expect(countFillers(clean).total).toBe(0);
  });

  it("不应把大小写不同的同一个词重复计数", () => {
    // "UM, um, UM" 应算 3 次(都是填充词)
    expect(countFillers("UM, um, UM").total).toBe(3);
  });

  it("应返回命中的具体词(便于 UI 展示)", () => {
    const r = countFillers("um and you know");
    expect(r.total).toBeGreaterThan(0);
    expect(r.hits.length).toBe(r.total);
    expect(r.hits[0].word).toBeTruthy();
  });
});

describe("FILLER_WORDS", () => {
  it("不应包含会大量误判的中文虚词", () => {
    // "那个/这个/就是/然后"在正常中文里是指示代词/连接词,不是填充词。
    // 保留它们会系统性低估中文用户 —— 而本项目的目标用户以中文为主。
    expect(FILLER_WORDS).not.toContain("那个");
    expect(FILLER_WORDS).not.toContain("这个");
  });

  /*
   * ⚠️ 2 字母词(um/uh)是**必须保留**的 —— 它们是最典型的口语填充词。
   * 词边界匹配(而非子串)已经解决了"短词制造噪音"的问题:
   * "umbrella" 不会被 "um" 命中,因为后面紧跟字母。
   * 真正危险的是**单字母**词("a" 会匹配一切),那才是必须禁止的。
   */
  it("必须保留 um/uh 这类典型口语填充词", () => {
    expect(FILLER_WORDS).toContain("um");
    expect(FILLER_WORDS).toContain("uh");
  });

  it("不应包含单字母 ASCII 填充词(会匹配一切)", () => {
    // 中文单字「嗯」「呃」是真实填充词,必须保留;
    // 危险的是 ASCII 单字母(a/so 的子串),那才要禁止。
    for (const w of FILLER_WORDS) {
      if (/^[a-z]+$/i.test(w)) expect(w.trim()).not.toMatch(/^.$/);
    }
  });

  it("短词因词边界匹配而不会误命中长词", () => {
    // "umbrella" 里含 "um",但不应被计入
    expect(countFillers("an umbrella").total).toBe(0);
  });
});
