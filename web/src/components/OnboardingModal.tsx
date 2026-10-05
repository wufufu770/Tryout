import { useEffect, useState } from "react";
import { Briefcase, Building2, Calendar, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { useModalA11y } from "@/lib/useModalA11y";

// C3:目标画像采集 - 首次访问弹出 3 问(岗位/公司/截止日期)
// 持久化到 localStorage,刷新不再弹出
const COMPLETED_KEY = "tryout:onboarding:completed";
const PROFILE_KEY = "tryout:onboarding:profile";

export interface OnboardingProfile {
  position: string;
  company: string;
  deadline: string;
}

export function loadOnboardingProfile(): OnboardingProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p !== "object" || !p) return null;
    return {
      position: String(p.position || ""),
      company: String(p.company || ""),
      deadline: String(p.deadline || ""),
    };
  } catch {
    return null;
  }
}

export function isOnboardingCompleted(): boolean {
  try {
    return JSON.parse(localStorage.getItem(COMPLETED_KEY) || "false") === true;
  } catch {
    return false;
  }
}

export function OnboardingModal() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState("");
  const [company, setCompany] = useState("");
  const [deadline, setDeadline] = useState("");

  // 首次挂载检测:未完成则弹窗
  useEffect(() => {
    if (!isOnboardingCompleted()) {
      // 延迟 300ms 弹出,避免与首屏渲染抢占
      const timer = setTimeout(() => setOpen(true), 300);
      return () => clearTimeout(timer);
    }
  }, []);

  const complete = (skip: boolean) => {
    try {
      localStorage.setItem(COMPLETED_KEY, "true");
      if (!skip) {
        const profile: OnboardingProfile = {
          position: position.trim(),
          company: company.trim(),
          deadline: deadline.trim(),
        };
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      }
    } catch (e) {
      // R28:localStorage 写入失败(隐身模式配额为 0、已用满 5MB、扩展冲突等)
      //   会让**引导画像丢失** —— 用户下次进来还要重填一遍。
      //   原先是 `catch {}`,完全静默。这里记 error 以便排查;
      //   不阻断流程(画像只是个性化增强,不是核心功能),
      //   但绝不能悄无声息。同一类问题见 `IntegrationSettings.tsx`。
      console.error("[onboarding] 画像写入 localStorage 失败(下次进入需重填):", e);
    }
    setOpen(false);
    // 通知其他组件(如首屏推荐可根据画像定制)
    window.dispatchEvent(new CustomEvent("tryout:onboarding-completed", { detail: { skipped: skip } }));
  };

  // v10.2.6(D3):hooks 必须在条件 return 之前调用,传 active 控制副作用执行时机
  const modalRef = useModalA11y(() => complete(true), open);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4"
      onClick={() => complete(true)}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("onboarding.title")}
        tabIndex={-1}
        className="w-full max-w-[420px] border border-ide-border bg-ide-bg-alt p-5 text-sm text-ide-fg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题区 */}
        <div className="mb-1 flex items-start justify-between">
          <div>
            <div className="text-base font-semibold text-ide-accent">{t("onboarding.title")}</div>
            <div className="mt-0.5 text-xs text-ide-fg-muted">{t("onboarding.subtitle")}</div>
          </div>
          <button
            onClick={() => complete(true)}
            // R32(ISSUE-022):min-w-6 min-h-6 = 24×24,WCAG 2.5.8 AA 最低值。
            //   纯图标按钮的热区就等于图标本身(实测 16×16),是全站最难点。
            //   ⚠️ shrink-0 不可省:R27 实测过 flex 容器会把只写 min-h 的按钮压扁。
            //   刻意用 min-* 而非伪元素扩热区 —— getBoundingClientRect() 量不到
            //   ::after,那样改 e2e 仍然量出 16px,等于没修。
            className="flex min-h-6 min-w-6 shrink-0 items-center justify-center text-ide-fg-muted hover:text-ide-fg"
            // 图标按钮:title 只在鼠标悬停时显示,触屏与读屏用户拿不到。
            // aria-label 提供稳定的无障碍名。
            aria-label={t("onboarding.skip")}
            title={t("onboarding.skip")}
          >
            <X size={16} />
          </button>
        </div>

        {/* 表单区 */}
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs text-ide-fg-muted">
              <Briefcase size={12} />
              <span>{t("onboarding.position")}</span>
              <span className="text-ide-danger">*</span>
            </label>
            <input
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder={t("onboarding.positionHint")}
              autoFocus
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg outline-none focus:border-ide-accent"
            />
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs text-ide-fg-muted">
              <Building2 size={12} />
              <span>{t("onboarding.company")}</span>
            </label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={t("onboarding.companyHint")}
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg outline-none focus:border-ide-accent"
            />
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs text-ide-fg-muted">
              <Calendar size={12} />
              <span>{t("onboarding.deadline")}</span>
            </label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg outline-none focus:border-ide-accent"
            />
            <div className="mt-0.5 text-[10px] text-ide-fg-muted">{t("onboarding.deadlineHint")}</div>
          </div>
        </div>

        {/* 按钮区 */}
        <div className="mt-5 flex justify-between gap-2">
          <button
            onClick={() => complete(true)}
            className="border border-ide-border px-3 py-1.5 text-xs text-ide-fg-muted hover:bg-ide-bg-active"
          >
            {t("onboarding.skip")}
          </button>
          <button
            onClick={() => complete(false)}
            disabled={!position.trim()}
            className="bg-ide-accent px-4 py-1.5 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("onboarding.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
