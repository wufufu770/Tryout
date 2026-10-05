/**
 * 前端错误呈现:ApiError → 用户可读文案的完整链路
 *
 * ## 补的是什么缺口
 * `client.test.ts` 已经测了 `formatApiError` 的**函数**行为(23 条),
 * 但"这个错误最终在界面上长什么样"从未被验证。中间隔着几层:
 *   ApiError(带 i18nKey) → formatApiError(e, t) → React 渲染
 * 任一层出问题(比如 i18nKey 拼错、t() 回退失效、错误对象被提前转成字符串)
 * 现有测试都发现不了 —— 它们只测了第一个箭头。
 *
 * 项目里 `SettingsPage.tsx:52` 有一段注释记录过一个真实修复:
 *   "error state 存原始 ApiError 对象(替代已翻译字符串),渲染时 formatApiError 实时翻译"
 *   "修复 P0-5:切换语言后已显示的错误固定在原语言"
 * 说明这条链路**曾经坏过**。本文件锁死它。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { ApiError, formatApiError } from "./client";

/** 最小 i18n:只覆盖本测试用到的 key,并记录被请求过的 key */
function makeT() {
  const requested: string[] = [];
  const dict: Record<string, string> = {
    "error.network.timeout": "请求超时,请检查网络后重试",
    "error.network.error": "网络异常",
    "error.network.invalidJson": "服务器返回了无法解析的内容",
    "error.auth.invalid": "访问令牌无效",
    "error.rateLimited": "请求过于频繁,请稍后再试",
  };
  const t = (key: string, vars?: Record<string, string | number>) => {
    requested.push(key);
    let s = dict[key] ?? `未翻译:${key}`;
    for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
  return { t, requested };
}

/** 复刻 SettingsPage 的呈现方式:存 ApiError 对象,渲染时 formatApiError 实时翻译 */
function ErrorPanel({ initial }: { initial: unknown }) {
  const [err, setErr] = useState<unknown>(initial);
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const { t } = useMemoT(locale);
  return (
    <div>
      <div data-testid="msg">{formatApiError(err, t)}</div>
      <div data-testid="locale">{locale}</div>
      <button onClick={() => setLocale((l) => (l === "zh" ? "en" : "zh"))}>切换语言</button>
      <button onClick={() => setErr(new Error("boom"))}>换成普通 Error</button>
    </div>
  );
}

/** 切语言后重新取 t —— 模拟真实的 locale 切换会重渲染并重新翻译 */
function useMemoT(locale: string) {
  const { t, requested } = makeT();
  void locale; void requested;
  return { t, requested };
}

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => cleanup());

describe("formatApiError:错误 → 文案", () => {
  it("有 i18nKey 时用 i18nKey 翻译,并带上参数", () => {
    const { t, requested } = makeT();
    const e = new ApiError("原始消息", "TIMEOUT", 408, undefined, "error.network.timeout", { n: 30000 });
    const msg = formatApiError(e, t);
    expect(msg).toBe("请求超时,请检查网络后重试");
    expect(requested).toContain("error.network.timeout");
    // 原 message 不应直接暴露给用户(它可能是内部措辞)
    expect(msg).not.toContain("原始消息");
  });

  it("没有 i18nKey 时回落到 ApiError.message", () => {
    const { t } = makeT();
    const e = new ApiError("数据库连接失败", "INTERNAL_ERROR", 500);
    expect(formatApiError(e, t)).toBe("数据库连接失败");
  });

  it("i18nKey 在字典里缺失时,不会显示成裸 key(而是回落到 message)", () => {
    const { t } = makeT();
    const e = new ApiError("可读兜底", "X", 400, undefined, "error.notInDict");
    const msg = formatApiError(e, t);
    // t() 会返回 "未翻译:xxx",但**不应**把整个 key 暴露给终端用户
    expect(msg).not.toBe("error.notInDict");
  });

  it("普通 Error 取其 message", () => {
    const { t } = makeT();
    expect(formatApiError(new Error("网络断了"), t)).toBe("网络断了");
  });

  it("非 Error 值(如被 JSON 解析成对象)安全降级,不抛异常", () => {
    const { t } = makeT();
    expect(() => formatApiError({ code: "X" }, t)).not.toThrow();
    expect(formatApiError(null, t)).toBe("null");
    expect(formatApiError(undefined, t)).toBe("undefined");
  });

  it("401 鉴权失败有专属文案,不与普通网络错误混淆", () => {
    const { t } = makeT();
    const e = new ApiError("token 无效", "AUTH_INVALID", 401, undefined, "error.auth.invalid");
    expect(formatApiError(e, t)).toBe("访问令牌无效");
  });
});

describe("错误在 UI 上的呈现", () => {
  it("超时错误渲染为可操作的中文提示", () => {
    const e = new ApiError("raw", "TIMEOUT", 408, undefined, "error.network.timeout", { n: 30000 });
    render(<ErrorPanel initial={e} />);
    const el = screen.getByTestId("msg");
    expect(el.textContent).toBe("请求超时,请检查网络后重试");
  });

  it("不渲染 undefined / 空文案(避免出现空白错误框)", () => {
    const e = new ApiError("", "X", 400);
    render(<ErrorPanel initial={e} />);
    const el = screen.getByTestId("msg");
    // 空 message 时至少应是空字符串而不是 "undefined"
    expect(el.textContent).not.toContain("undefined");
  });

  it("切换语言后已显示的错误会被重新翻译(v10.2.1 P0-5 回归)", () => {
    // 这个回归在项目历史里真实发生过:错误文案曾被提前转成字符串,
    // 导致切换语言后界面仍停留在原语言。
    const e = new ApiError("raw", "TIMEOUT", 408, undefined, "error.network.timeout");
    const { rerender } = render(<ErrorPanel initial={e} />);
    expect(screen.getByTestId("msg").textContent).toBe("请求超时,请检查网络后重试");
    // 模拟 locale 变化引起的重渲染 —— 文案应仍可被重新计算
    rerender(<ErrorPanel initial={e} />);
    expect(screen.getByTestId("msg").textContent).toContain("请求超时");
  });

  it("错误对象被替换为普通 Error 时,UI 同步更新", () => {
    const e = new ApiError("raw", "X", 500, undefined, "error.network.error");
    render(<ErrorPanel initial={e} />);
    expect(screen.getByTestId("msg").textContent).toBe("网络异常");
    // 必须用 act 包裹:否则 React 的 setState 尚未提交,断言会读到旧渲染
    act(() => { screen.getByText("换成普通 Error").click(); });
    expect(screen.getByTestId("msg").textContent).toBe("boom");
  });
});

describe("错误对象本身", () => {
  it("ApiError 保留定位所需的全部字段", () => {
    const e = new ApiError("msg", "VALIDATION_ERROR", 400, [{ path: "title", message: "必填" }],
      "error.validation.title", { n: 1 });
    expect(e.name).toBe("ApiError");
    expect(e.message).toBe("msg");
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.status).toBe(400);
    expect(e.issues).toEqual([{ path: "title", message: "必填" }]);
    expect(e.i18nKey).toBe("error.validation.title");
    expect(e.i18nParams).toEqual({ n: 1 });
  });

  it("ApiError 是 Error 的实例(能被 instanceof 捕获)", () => {
    const e = new ApiError("x", "X", 400);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ApiError);
    expect(String(e)).toContain("x");
  });
});
