// InfoTip:小方框 + 感叹号,hover/focus/click 弹出解释
// fixed 定位 + getBoundingClientRect 计算位置,避免被 overflow 容器截断
// P0 修复:z-index 降到 z-40(低于 modal 的 z-50);监听 scroll/resize 关闭;Esc 关闭;顶部夹紧
import { useLayoutEffect, useEffect, useRef, useState } from "react";
import { cn } from "@/shared";
import { useI18n } from "@/i18n";

interface InfoTipProps {
  text: string;
  size?: number;
  className?: string;
}

export function InfoTip({ text, size = 12, className }: InfoTipProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 弹窗打开时根据触发元素位置 + 视口边界计算最佳位置
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tipRef.current) return;
    const trigRect = triggerRef.current.getBoundingClientRect();
    const tipRect = tipRef.current.getBoundingClientRect();
    const margin = 6;

    // 优先放下方,下方不够放上方
    let top = trigRect.bottom + margin;
    if (top + tipRect.height + margin > window.innerHeight) {
      top = trigRect.top - tipRect.height - margin;
    }
    // 上下都不够时贴顶(P0 L1 修复)
    if (top < margin) top = margin;

    // 水平居中,溢出夹紧
    let left = trigRect.left + trigRect.width / 2 - tipRect.width / 2;
    if (left < margin) left = margin;
    if (left + tipRect.width + margin > window.innerWidth) {
      left = window.innerWidth - tipRect.width - margin;
    }

    setPos({ top, left });
  }, [open, text]);

  // P0 H2 修复:打开期间监听 scroll(capture 捕获溢出容器)和 resize,直接关闭
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // P1 M2 修复:Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span
      ref={triggerRef}
      className={cn("relative inline-flex shrink-0 align-middle", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // P1 M1 修复:click 只打开不 toggle(避免桌面端 hover 已打开后点击反而关闭)
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
    >
      <span
        role="img"
        aria-label={t("common.hint")}
        tabIndex={0}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center justify-center border border-ide-fg-muted/50 text-ide-fg-muted cursor-help"
        style={{ width: size, height: size, fontSize: size - 2, lineHeight: 1, borderRadius: 2 }}
      >
        !
      </span>
      {open && (
        <span
          ref={tipRef}
          // P0 H1 修复:z-40 低于 modal(z-50)和帮助弹窗(z-[100]),不会遮盖模态层
          className="pointer-events-none fixed z-40 w-max max-w-[240px] border border-ide-border bg-ide-bg-alt px-2 py-1.5 text-[11px] leading-relaxed text-ide-fg shadow-xl"
          role="tooltip"
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
