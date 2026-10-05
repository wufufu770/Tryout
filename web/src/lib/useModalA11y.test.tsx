/**
 * 无障碍(a11y)测试:`useModalA11y` —— 此前**零断言**
 *
 * ## 为什么重要
 * `useModalA11y` 被 **5 个页面/组件**使用(InterviewPage / ExperiencePage /
 * MarketPage / OnboardingModal / 自身),它承载键盘用户能否操作这些模态框:
 *   - Escape 关闭
 *   - Tab / Shift+Tab 焦点陷阱(不允许 Tab 跑到模态框外面)
 *   - 打开时聚焦第一个可聚焦元素(无可聚焦元素时聚焦容器)
 *   - 关闭后焦点恢复到打开前的元素
 *   - 打开期间锁住 body 滚动
 *
 * 这些全是**纯键盘路径**,屏幕阅读器与纯键盘用户是唯一受益者,
 * 而项目此前**没有任何 ARIA 或键盘行为的自动化断言** ——
 * 一次重构(比如把 Escape 判断挪进某个条件)就会静默劣化。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { useRef, useState } from "react";
import { useModalA11y } from "./useModalA11y";

/** 最小可用的模态框:三���可聚焦元素 + 一个容器 */
function TestModal({ onClose, active = true }: { onClose: () => void; active?: boolean }) {
  const ref = useModalA11y(onClose, active);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="测试对话框" tabIndex={-1}>
      <button type="button">第一个</button>
      <a href="#link">第二个链接</a>
      <button type="button">第三个</button>
    </div>
  );
}

/**
 * ⚠️ jsdom 没有布局引擎,`HTMLElement.offsetParent` **恒为 null**。
 * 而 hook 的 getFocusables() 用 `el.offsetParent !== null` 过滤"可见元素":
 *
 *   .filter(el => el.offsetParent !== null || el === document.activeElement)
 *
 * 于是在 jsdom 里所有元素都被判定为不可见 → 可聚焦列表恒为空 →
 * 初始焦点退到容器、Tab 陷阱完全失效。
 *
 * 这是 **jsdom 的限制,不是产品缺陷**(真实浏览器里有布局,offsetParent 正常)。
 * 本文件通过在原型上 stub `offsetParent` 模拟"元素可见",
 * 从而验证 hook 的**焦点陷阱逻辑本身**,把可见性启发式的验证留给 e2e。
 * 顺带说明:依赖 offsetParent 意味着该逻辑**在无布局环境下不可单测**,
 * 这本身是一条值得记录的可测性问题。
 */
function stubVisible() {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return document.body; },
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  stubVisible();
});
afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  delete (HTMLElement.prototype as any).offsetParent;
});

describe("Escape 关闭", () => {
  it("按 Escape 会调用 onClose", () => {
    const onClose = vi.fn();
    render(<TestModal onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape 不会冒泡到外部(阻止默认)", () => {
    const onClose = vi.fn();
    render(<TestModal onClose={onClose} />);
    const ev = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("active=false 时不注册监听(Escape 无效)", () => {
    const onClose = vi.fn();
    render(<TestModal onClose={onClose} active={false} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("初始焦点", () => {
  it("打开时聚焦到第一个可聚焦元素", () => {
    render(<TestModal onClose={() => {}} />);
    expect(document.activeElement?.textContent).toBe("第一个");
  });

  it("模态框内无可聚焦元素时聚焦到容器本身", () => {
    function Empty() {
      const ref = useModalA11y(() => {}, true);
      return <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>空模态框</div>;
    }
    render(<Empty />);
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
  });
});

describe("焦点陷阱(Tab / Shift+Tab)", () => {
  /** 把焦点放到指定元素上,模拟用户已 Tab 到那里 */
  const focusTo = (text: string) => {
    const el = screen.getByText(text);
    el.focus();
    expect(document.activeElement).toBe(el);
  };

  it("在最后一个元素上按 Tab → 回到第一个(不逃出模态框)", () => {
    render(<TestModal onClose={() => {}} />);
    focusTo("第三个");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement?.textContent).toBe("第一个");
  });

  it("在第一个元素上按 Shift+Tab → 跳到最后一个(不逃出模态框)", () => {
    render(<TestModal onClose={() => {}} />);
    focusTo("第一个");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement?.textContent).toBe("第三个");
  });

  it("焦点在容器上时 Shift+Tab 也应跳到最后一个", () => {
    render(<TestModal onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    dialog.focus();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement?.textContent).toBe("第三个");
  });

  it("模态框内无可聚焦元素时,Tab 不报错也不移动焦点", () => {
    function Empty() {
      const ref = useModalA11y(() => {}, true);
      return <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>空</div>;
    }
    render(<Empty />);
    expect(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    }).not.toThrow();
  });

  it("disabled 按钮不算可聚焦元素", () => {
    function WithDisabled() {
      const ref = useModalA11y(() => {}, true);
      return (
        <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
          <button type="button" disabled>禁用按钮</button>
          <button type="button">可用按钮</button>
        </div>
      );
    }
    render(<WithDisabled />);
    // 初始焦点应跳过 disabled 按钮,落在可用按钮上
    expect(document.activeElement?.textContent).toBe("可用按钮");
  });
});

describe("焦点恢复与滚动锁", () => {
  it("卸载时把焦点还给打开前的元素", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "打开按钮";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(<TestModal onClose={() => {}} />);
    expect(document.activeElement).not.toBe(trigger); // 焦点已移入模态框

    unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it("打开期间锁住 body 滚动,关闭后恢复", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(<TestModal onClose={() => {}} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("active=false 时不锁滚动", () => {
    const { unmount } = render(<TestModal onClose={() => {}} active={false} />);
    expect(document.body.style.overflow).not.toBe("hidden");
    unmount();
  });
});

describe("卸载后监听被正确移除", () => {
  it("unmount 后按 Escape 不再触发 onClose(否则会内存泄漏)", () => {
    const onClose = vi.fn();
    const { unmount } = render(<TestModal onClose={onClose} />);
    unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("重复开关多次不叠加监听器", async () => {
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>切换</button>
          {open && <TestModal onClose={() => { setOpen(false); onClose(); }} />}
        </>
      );
    }
    const { getByText } = render(<Host />);
    const pressEscape = () =>
      act(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });

    // 第 1 轮:打开 → Escape 关闭
    act(() => { getByText("切换").click(); });
    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);

    // 第 2 轮:再打开 → 再 Escape,验证监听被移除而非**累积**
    // (若清理失效,每开一次就多一个监听器,这里会变成 2 次)
    act(() => { getByText("切换").click(); });
    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

});
