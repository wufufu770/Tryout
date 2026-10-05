/**
 * 单元测试:API 客户端(`src/api/client.ts`)—— 此前**零覆盖**
 *
 * ## 为什么重要
 * `client.ts` 是前端所有网络请求的唯一出口,承担四件容易出错的事:
 *   1. **Token 管理**:`localStorage` → `sessionStorage` 的迁移(v10.2.6/D2),
 *      以及旧 key `interviewx:api_token` → 新 key `tryout:api_token` 的迁移
 *   2. **Envelope 解包**:`{ ok: true, data }` → `data`,同时兼容旧接口直返数据
 *   3. **错误提取**:从 `{ code, message, issues, i18nKey, i18nParams }` 还原成 ApiError
 *   4. **重试判据**:仅对 502/503/504/429/TIMEOUT 以及网络错误重试,且只重试 1 次
 *
 * 这些逻辑一旦出错,症状是"偶发失败"或"用户莫名掉登录",极难排查,
 * 而此前 `src/api/` 下**一个测试文件都没有**。
 *
 * ## 环境说明
 * vitest 跑在 `environment: "node"`(见 vite.config.ts),没有 jsdom/happy-dom,
 * 因此 `sessionStorage` / `localStorage` 在 Node 里不存在 —— 本文件自备
 * 内存版 shim(见 installStorageShim),不引入新依赖。
 *
 * 另外 `api` 是**领域方法集合**(listAgents / createSession / ...),
 * 不是通用的 get/post;`retryable:false` 是 `request()` 的内部选项,
 * 公开方法并不暴露,因此重试相关断言只能从**可重试/不可重试的状态码**两侧验证。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const TOKEN_KEY = "tryout:api_token";
const LEGACY_TOKEN_KEY = "interviewx:api_token";

/* ---------- 内存版 storage shim(node 环境无 DOM storage) ---------- */
function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

let savedDescriptors: Array<[string, PropertyDescriptor | undefined]> = [];
function installStorageShim() {
  savedDescriptors = [];
  for (const name of ["sessionStorage", "localStorage"]) {
    savedDescriptors.push([name, Object.getOwnPropertyDescriptor(globalThis, name)]);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: makeStorage() });
  }
}
function restoreStorageShim() {
  for (const [name, desc] of savedDescriptors) {
    if (desc) Object.defineProperty(globalThis, name, desc);
    else delete (globalThis as any)[name];
  }
}

async function freshClient() {
  vi.resetModules();
  return await import("./client");
}

let fetchMock: ReturnType<typeof vi.fn>;

/** 构造一次 fetch 响应 */
function resp(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status < 400, status, text: async () => text, json: async () => JSON.parse(text) };
}

beforeEach(() => {
  installStorageShim();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();   // 重试里有真实 sleep,避免拖慢
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  restoreStorageShim();
});

/** 发起请求并把 pending promise 与定时器一起推进 */
async function run<T>(p: Promise<T>): Promise<T> {
  const settled = p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
  await vi.runAllTimersAsync();
  const r = await settled;
  if (!r.ok) throw r.e;
  return r.v;
}

describe("Token 管理(sessionStorage 而非 localStorage)", () => {
  it("setApiToken 写入 sessionStorage,不写 localStorage", async () => {
    const c = await freshClient();
    c.setApiToken("tok-123");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("tok-123");
    // v10.2.6(D2)的目的就是不再持久化到 localStorage(降低 XSS 持久窃取)
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("setApiToken(null) 清除 token", async () => {
    const c = await freshClient();
    c.setApiToken("tok-123");
    c.setApiToken(null);
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(c.getApiToken()).toBeNull();
  });

  it("旧 key 在读取时被迁移到新 key 并清理", async () => {
    const c = await freshClient();
    sessionStorage.setItem(LEGACY_TOKEN_KEY, "legacy-tok");
    expect(c.getApiToken()).toBe("legacy-tok");
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe("legacy-tok");
    expect(sessionStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
  });

  it("新 key 优先于旧 key", async () => {
    const c = await freshClient();
    sessionStorage.setItem(TOKEN_KEY, "new-tok");
    sessionStorage.setItem(LEGACY_TOKEN_KEY, "legacy-tok");
    expect(c.getApiToken()).toBe("new-tok");
  });

  it("两种 key 都没有时返回 null", async () => {
    const c = await freshClient();
    expect(c.getApiToken()).toBeNull();
  });

  it("storage 不可用时不抛异常(隐私模式等)", async () => {
    vi.resetModules();
    const orig = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    try {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        get() { throw new Error("blocked"); },
      });
      const c = await import("./client");
      expect(() => c.getApiToken()).not.toThrow();
      expect(c.getApiToken()).toBeNull();
      expect(() => c.setApiToken("x")).not.toThrow();
    } finally {
      // ⚠️ orig 可能本就是 undefined,只写 `if (orig)` 会永远恢复不了,
      // 那个抛错的 getter 残留下来会让后续用例全部炸掉。
      if (orig) Object.defineProperty(globalThis, "sessionStorage", orig);
      else delete (globalThis as any).sessionStorage;
    }
  });
});

describe("Envelope 解包", () => {
  it("{ ok:true, data } → 解包出 data", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(200, { ok: true, data: [{ id: "a1" }] }));
    const r = await run(c.api.listAgents());
    expect(r).toEqual([{ id: "a1" }]);
  });

  it("旧接口直返数据(无 envelope)也能取到", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(200, { legacy: true }));
    const r = await run(c.api.listSessions());
    expect(r).toEqual({ legacy: true });
  });

  it("空响应体不崩", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(200, ""));
    const r = await run(c.api.listSessionGroups());
    expect(r).toEqual({});
  });

  it("data 为 null 时返回 null(不被误判成空对象)", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(200, { ok: true, data: null }));
    const r = await run(c.api.getSessionReview("nope"));
    expect(r).toBeNull();
  });
});

describe("错误提取", () => {
  it("从 envelope 提取 code / message / issues / i18nKey / i18nParams", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(400, {
      ok: false, code: "VALIDATION_ERROR", message: "modelId 为必填",
      issues: [{ path: "modelId", message: "为必填" }],
      i18nKey: "error.validation.modelId", i18nParams: { n: 1 },
    }));
    const err = await run(c.api.createSession({ title: "t" } as any)).catch((e) => e);
    expect(err).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "modelId 为必填",
      status: 400,
      i18nKey: "error.validation.modelId",
      i18nParams: { n: 1 },
    });
  });

  it("缺少 message 时回落到 error 字段", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(400, { ok: false, error: "来自旧接口的错误" }));
    const err = await run(c.api.createSessionGroup({ name: "g" } as any)).catch((e) => e);
    expect(err.message).toBe("来自旧接口的错误");
  });

  it("code 缺失时兜底为 INTERNAL_ERROR", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(400, { ok: false, message: "boom" }));
    const err = await run(c.api.createMaterial({} as any)).catch((e) => e);
    expect(err.code).toBe("INTERNAL_ERROR");
  });

  it("非 JSON 响应抛可识别错误,而不是裸 SyntaxError", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(200, "<html>502 Bad Gateway</html>"));
    const err = await run(c.api.listAgents()).catch((e) => e);
    expect(err.i18nKey).toBe("error.network.invalidJson");
  });
});

describe("重试判据(MAX_RETRY=1)", () => {
  it("502 重试一次后成功", async () => {
    const c = await freshClient();
    fetchMock
      .mockResolvedValueOnce(resp(502, "bad gateway"))
      .mockResolvedValueOnce(resp(200, { ok: true, data: "recovered" }));
    const r = await run(c.api.listAgents() as any);
    expect(r).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("连续 502 只重试 1 次即抛错(不多打)", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(502, "bad gateway"));
    const err = await run(c.api.listAgents()).catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err.status).toBe(502);
  });

  it("503 / 504 同样可重试", async () => {
    for (const code of [503, 504]) {
      const c = await freshClient();
      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce(resp(code, "gw"))
        .mockResolvedValueOnce(resp(200, { ok: true, data: [{ id: "a" }] }));
      const r = await run(c.api.listAgents());
      expect(r).toEqual([{ id: "a" }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it("429 会重试(带退避)", async () => {
    const c = await freshClient();
    fetchMock
      .mockResolvedValueOnce(resp(429, { ok: false, message: "slow down" }))
      .mockResolvedValueOnce(resp(200, { ok: true, data: "ok" }));
    const r = await run(c.api.listAgents() as any);
    expect(r).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ISSUE-030:日预算耗尽虽然也是 429,但当天不可能恢复 —— 退避重试 100% 必然失败。
  // 之前只按 status 判可重试,会对这种错误做满 MAX_RETRY 次无意义等待。
  it("TOKEN_BUDGET_EXCEEDED 即使是 429 也**不重试**", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(
      resp(429, {
        ok: false,
        code: "TOKEN_BUDGET_EXCEEDED",
        message: "已达日 token 预算(500000),请明天再试",
        retryAfterSeconds: 3600,
      }),
    );
    const err = await run(c.api.listAgents() as any).catch((e) => e);
    expect(err.code).toBe("TOKEN_BUDGET_EXCEEDED");
    expect(err.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 关键断言:只发了一次,没有退避重试
  });

  it("4xx 属客户端错误,**不重试**", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(400, { ok: false, code: "VALIDATION_ERROR", message: "bad" }));
    await run(c.api.createSession({} as any)).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("404 不重试", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(404, { ok: false, code: "NOT_FOUND", message: "不存在" }));
    const err = await run(c.api.getSession("missing")).catch((e) => e);
    expect(err.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("500 不重试(非网关类故障,重试无意义)", async () => {
    const c = await freshClient();
    fetchMock.mockResolvedValue(resp(500, { ok: false, message: "服务器内部错误" }));
    await run(c.api.listAgents()).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("网络错误(TypeError)会重试", async () => {
    const c = await freshClient();
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(resp(200, { ok: true, data: 1 }));
    const r = await run(c.api.listAgents() as any);
    expect(r).toBe(1);
  });
});

describe("ApiError 构造", () => {
  it("携带 code/status/i18nKey/i18nParams 供前端本地化渲染", async () => {
    vi.resetModules();
    const { ApiError } = await import("./client");
    const e = new ApiError("请求超时(30000ms)", "TIMEOUT", 408, undefined, "error.network.timeout", { n: 30000 });
    expect(e.name).toBe("ApiError");
    expect(e.code).toBe("TIMEOUT");
    expect(e.status).toBe(408);
    expect(e.i18nKey).toBe("error.network.timeout");
    expect(e.i18nParams).toEqual({ n: 30000 });
  });
});
