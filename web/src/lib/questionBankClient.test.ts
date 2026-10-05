// 题库加载 hook 单元测试
// Seam:fetchQuestionBank()(纯函数封装 HTTP,不依赖 React)—— 便于在无 DOM 环境测试
//
// 背景(W3-1):题库原为前端静态 import,909 KB 全进主 bundle。
// 改为按需从服务端拉取后,主 bundle 不再包含题库。
// 但前端仍需要一个"离线兜底":服务端不可达时退回 public/questionbank.json。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchQuestionBank, fetchQuestionBankStats, questionBankUrl, type QuestionLite } from "./questionBankClient";

const SAMPLE: QuestionLite = {
  id: "backend-tech-001",
  industry: "backend",
  type: "technical",
  difficulty: "mid",
  title: "HashMap",
  content: "讲讲原理",
  keyPoints: ["扩容"],
  tags: ["Java"],
  estimatedMinutes: 8,
};

let calls: string[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/api/questionbank/stats")) {
      return {
        ok: true,
        json: async () => ({ ok: true, data: { total: 1, industries: [{ id: "backend", count: 1 }], types: [], difficulties: [], available: true } }),
      } as any;
    }
    if (String(url).includes("/api/questionbank")) {
      return { ok: true, json: async () => ({ ok: true, data: [{ ...SAMPLE }] }) } as any;
    }
    // 静态兜底
    return { ok: true, json: async () => ({ version: "x", meta: {}, questions: [SAMPLE] }) } as any;
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("questionBankUrl", () => {
  it("应通过 /api/questionbank 查询,而不是直接读静态文件", () => {
    const u = questionBankUrl({ industry: "backend", limit: 5, difficulty: "normal" });
    expect(u).toContain("/api/questionbank?");
    expect(u).toContain("industry=backend");
    expect(u).toContain("limit=5");
  });

  it("应正确编码 exclude 列表", () => {
    const u = questionBankUrl({ industry: "backend", excludeIds: ["a b", "c"] });
    expect(u).toContain("exclude=");
    expect(u).not.toContain("exclude=a b");
  });

  it("未指定 limit 时不应输出 limit 参数", () => {
    expect(questionBankUrl({ industry: "x" })).not.toContain("limit=");
  });
});

describe("fetchQuestionBank", () => {
  it("应从 API 拉取列表并解包 data 数组", async () => {
    const r = await fetchQuestionBank({ industry: "backend" });
    expect(r.source).toBe("api");
    // 列表接口返回数组;统计走独立的 fetchQuestionBankStats()
    expect(Array.isArray(r.questions)).toBe(true);
  });

  it("fetchQuestionBankStats 应单独取统计", async () => {
    const s = await fetchQuestionBankStats();
    expect(s?.total).toBe(1);
    expect(s?.industries).toEqual([{ id: "backend", count: 1 }]);
  });

  it("统计接口失败时应返回 null 而非抛错", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await fetchQuestionBankStats()).toBeNull();
  });

  it("API 失败时应回退到静态文件", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/")) return { ok: false, status: 503, json: async () => ({}) } as any;
      return { ok: true, json: async () => ({ version: "x", meta: {}, questions: [SAMPLE] }) } as any;
    }));
    const r = await fetchQuestionBank({ industry: "backend" });
    expect(r.source).toBe("static");
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].id).toBe("backend-tech-001");
  });

  it("API 网络异常(抛错)也应回退而非抛出", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/")) throw new Error("network down");
      return { ok: true, json: async () => ({ version: "x", meta: {}, questions: [SAMPLE] }) } as any;
    }));
    const r = await fetchQuestionBank({ industry: "backend" });
    expect(r.source).toBe("static");
  });

  it("两处都失败时应返回空题库而不是抛错(UI 必须能降级渲染)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("all down"); }));
    const r = await fetchQuestionBank({ industry: "backend" });
    expect(r.questions).toEqual([]);
    expect(r.source).toBe("empty");
    expect(r.error).toBeTruthy();
  });

  it("返回的题目不得含 referenceAnswer(兜底文件也要剔除)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/")) return { ok: false, status: 503, json: async () => ({}) } as any;
      return {
        ok: true,
        json: async () => ({ version: "x", meta: {}, questions: [{ ...SAMPLE, referenceAnswer: "不该出现" }] }),
      } as any;
    }));
    const r = await fetchQuestionBank({ industry: "backend" });
    expect((r.questions[0] as any).referenceAnswer).toBeUndefined();
  });

  it("应透传非 array 的 questions 为空数组", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/")) return { ok: false, status: 500, json: async () => ({}) } as any;
      return { ok: true, json: async () => ({ questions: "not an array" }) } as any;
    }));
    const r = await fetchQuestionBank({ industry: "x" });
    expect(r.questions).toEqual([]);
  });
});
