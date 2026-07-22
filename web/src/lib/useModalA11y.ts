// v10.2.6(D3):Modal 无障碍支持通用 hook
// 封装:Escape 关闭 + focus trap + 初始焦点 + 焦点恢复
// 用法:const modalRef = useModalA11y(onClose, isOpen);
//       <div ref={modalRef} role="dialog" aria-modal="true" aria-label="..." tabIndex={-1}>
// active 参数:仅在 Modal 显示时执行副作用(body overflow + keydown),避免未显示时阻止页面滚动
import { useEffect, useRef } from "react";

export function useModalA11y(onClose: () => void, active: boolean = true) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    const modal = modalRef.current;

    const getFocusables = () => modal
      ? Array.from(modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null || el === document.activeElement)
      : [];

    // 初始聚焦到第一个可聚焦元素
    const focusables = getFocusables();
    if (focusables.length > 0) focusables[0].focus();
    else if (modal) modal.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && modal) {
        const list = getFocusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      if (previousFocusRef.current) {
        try { previousFocusRef.current.focus(); } catch {}
      }
    };
  }, [active]);

  return modalRef;
}
