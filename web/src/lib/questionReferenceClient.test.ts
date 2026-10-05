// 前端测试:题目级评分基准的取用(守卫 ISSUE-038)
//
// ## 为什么要有这个文件
// R32 之前,`InterviewPage.runLiveEvaluation` 传的是 `undefined`,
// 而同一段代码把 `bankReferenced: !!currentQuestion` 传给 UI,
// LiveCoachPanel 据此渲染 liveCoach.bankBased —— 10 种语言里都写着
// "本次评估使用了题库作为参考"。
//
// 也就是说:**UI 明确告诉用户用了基准,实际一次都没用。**
// 这类"声称做了但没做"的缺陷比单纯的参数缺失更糟,因为它连累可信度一起坏掉。
//
// 所以本文件守的不只是"能取到 reference",还有"取不到时必须如实降级"。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchQuestionReference,
  __resetReferenceCache,
  type QuestionReferenceBlock,
} from "./questionBankClient";

const REF: QuestionReferenceBlock = {
  referenceAnswer: "候选人应先澄清一致性哈希与虚拟节点的取舍,再谈扩容迁移。",
  keyPoints: ["一致性哈希", "虚拟节点", "数据迁移"],
  type: "technical",
};

let calls: string[];
let handler: (url: string) => { ok: boolean; status?: number; json: () => Promise<any> };

beforeEach(() => {
  calls = [];
  __resetReferenceCache();
  handler = () => ({ ok: true, json: async () => ({ ok: true, data: REF }) });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    return handler(String(url));
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchQuestionReference:取到题目级判据", () => {
  it("返回 referenceAnswer / keyPoints / 权威题型", async () => {
    const r = await fetchQuestionReference("backend-tech-001");
    expect(r).not.toBeNull();
    expect(r!.referenceAnswer).toBe(REF.referenceAnswer);
    expect(r!.keyPoints).toEqual(REF.keyPoints);
    expect(r!.type).toBe("technical");
    expect(calls[0]).toBe("/api/questionbank/backend-tech-001/reference");
  });

  it("按 id 单查,不带任何批量参数 —— 不给整库拉答案的路径", async () => {
    await fetchQuestionReference("backend-tech-001");
    expect(calls[0]).not.toContain("limit");
    expect(calls[0]).not.toContain("all");
    expect(calls[0]).not.toContain("industry");
  });

  it("id 做 URL 编码,防路径穿越", async () => {
    await fetchQuestionReference("a/../b?id=1");
    expect(calls[0]).toBe("/api/questionbank/a%2F..%2Fb%3Fid%3D1/reference");
  });

  it("同一题只取一次 —— 现场评估每轮都会用到,不该反复打服务端", async () => {
    await fetchQuestionReference("q1");
    await fetchQuestionReference("q1");
    await fetchQuestionReference("q1");
    expect(calls).toHaveLength(1);
  });

  it("并发同 id 只发一次请求(一轮评 2~6 个维度,不能各拉一遍)", async () => {
    const [a, b, c] = await Promise.all([
      fetchQuestionReference("q1"),
      fetchQuestionReference("q1"),
      fetchQuestionReference("q1"),
    ]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

describe("fetchQuestionReference:取不到时必须如实降级", () => {
  // 下面每一条对应 InterviewPage 的 bankReferenced 判据:
  // 只有真的拿到 reference 才允许对用户说"用了题库作基准"。

  it("404 → null(题不存在或该题无参考答案)", async () => {
    handler = () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchQuestionReference("q404")).toBeNull();
  });

  it("503 → null(题库未生成)", async () => {
    handler = () => ({ ok: false, status: 503, json: async () => ({}) });
    expect(await fetchQuestionReference("q503")).toBeNull();
  });

  it("网络异常 → null,不向上抛(评估不该因为取不到基准就崩掉)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await fetchQuestionReference("qnet")).toBeNull();
  });

  it("keyPoints 为空 → null(buildReferenceBlock 会输出空的『考察方向:』,退化为无基准)", async () => {
    handler = () => ({ ok: true, json: async () => ({ ok: true, data: { ...REF, keyPoints: [] } }) });
    expect(await fetchQuestionReference("qempty")).toBeNull();
  });

  it("keyPoints 全是空白字符串 → null(等同没有考察方向)", async () => {
    handler = () => ({ ok: true, json: async () => ({ ok: true, data: { ...REF, keyPoints: ["  ", ""] } }) });
    expect(await fetchQuestionReference("qblank")).toBeNull();
  });

  it("referenceAnswer 缺失或非字符串 → null", async () => {
    handler = () => ({ ok: true, json: async () => ({ ok: true, data: { keyPoints: ["x"] } }) });
    expect(await fetchQuestionReference("qmiss")).toBeNull();
    handler = () => ({ ok: true, json: async () => ({ ok: true, data: { ...REF, referenceAnswer: 123 } }) });
    expect(await fetchQuestionReference("qmiss2")).toBeNull();
  });

  it("空 id → null 且不发请求", async () => {
    expect(await fetchQuestionReference("")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("失败也缓存,避免每轮评估都去撞一个不存在的题", async () => {
    handler = () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchQuestionReference("q404")).toBeNull();
    expect(await fetchQuestionReference("q404")).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
