import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { MessageSquare, Users, FileText, History, Settings, Users2, Store, Workflow, Info, Newspaper } from "lucide-react";
import { cn } from "@/shared";
import { useI18n } from "@/i18n";
import { OnboardingModal } from "@/components/OnboardingModal";

interface StatusBarState {
  sessionLabel?: string;
  modelLabel?: string;
  reasoning?: boolean;
}

interface LayoutContextValue {
  setStatusBar: (state: StatusBarState) => void;
}

const LayoutContext = createContext<LayoutContextValue>({ setStatusBar: () => {} });

export function useLayoutContext(): LayoutContextValue {
  return useContext(LayoutContext);
}

// 导航项:label 用 i18n key,渲染时通过 t() 翻译
const NAV_ITEMS = [
  { to: "/interview", labelKey: "nav.interview", Icon: MessageSquare },
  { to: "/group", labelKey: "nav.group", Icon: Users2 },
  { to: "/flow", labelKey: "nav.flow", Icon: Workflow },
  { to: "/experiences", labelKey: "nav.experiences", Icon: Newspaper },
  { to: "/market", labelKey: "nav.market", Icon: Store },
  { to: "/agents", labelKey: "nav.agents", Icon: Users },
  { to: "/materials", labelKey: "nav.materials", Icon: FileText },
  { to: "/history", labelKey: "nav.history", Icon: History },
  { to: "/settings", labelKey: "nav.settings", Icon: Settings },
  { to: "/about", labelKey: "nav.about", Icon: Info },
];

interface MenuItem {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
}
interface MenuDef {
  name: string;
  items: MenuItem[];
}

export function IdeLayout() {
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<StatusBarState>({ reasoning: false });
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const { t, dir, locale } = useI18n();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  // 全局键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        navigate("/interview");
        window.dispatchEvent(new CustomEvent("tryout:new-session"));
        return;
      }
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "enter") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tryout:send"));
      } else if (key === "m") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("tryout:focus-model"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  const runMenuItem = (fn?: () => void) => {
    setOpenMenu(null);
    fn?.();
  };

  const menus: MenuDef[] = [
    {
      name: t("menu.file"),
      items: [
        {
          label: t("menu.newSession"),
          shortcut: "Ctrl+Shift+N",
          onClick: () => {
            navigate("/interview");
            window.dispatchEvent(new CustomEvent("tryout:new-session"));
          },
        },
        {
          label: t("menu.goToAgents"),
          onClick: () => navigate("/agents"),
        },
        {
          label: t("menu.goToMaterials"),
          onClick: () => navigate("/materials"),
        },
      ],
    },
    {
      name: t("common.edit"),
      items: [
        {
          label: t("interview.end"),
          onClick: () => window.dispatchEvent(new CustomEvent("tryout:new-session")),
        },
        {
          label: t("common.retry"),
          onClick: () => window.dispatchEvent(new CustomEvent("tryout:retry")),
        },
      ],
    },
    {
      name: t("menu.view"),
      items: [
        { label: t("nav.interview"), onClick: () => navigate("/interview") },
        { label: t("nav.group"), onClick: () => navigate("/group") },
        { label: t("nav.flow"), onClick: () => navigate("/flow") },
        { label: t("nav.experiences"), onClick: () => navigate("/experiences") },
        { label: t("nav.market"), onClick: () => navigate("/market") },
        { label: t("nav.agents"), onClick: () => navigate("/agents") },
        { label: t("nav.materials"), onClick: () => navigate("/materials") },
        { label: t("nav.history"), onClick: () => navigate("/history") },
        { label: t("nav.settings"), onClick: () => navigate("/settings") },
        { label: t("nav.about"), onClick: () => navigate("/about") },
      ],
    },
    {
      name: t("menu.help"),
      items: [
        { label: t("menu.shortcuts"), onClick: () => setShowHelp(true) },
        { label: t("menu.aboutTryout"), onClick: () => setShowAbout(true) },
      ],
    },
  ];

  const ctxValue = useMemo<LayoutContextValue>(() => ({ setStatusBar: setStatus }), []);

  return (
    <LayoutContext.Provider value={ctxValue}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-ide-bg text-ide-fg">
        {/* 顶部标题栏 */}
        <header className="relative flex h-7 shrink-0 items-center justify-between bg-ide-bg-alt px-3 text-xs text-ide-fg select-none">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-ide-accent">Tryout</span>
            <nav ref={menuRef} className="flex items-center gap-0.5 text-ide-fg-muted">
              {menus.map((m) => (
                <div key={m.name} className="relative">
                  <button
                    onClick={() => setOpenMenu(openMenu === m.name ? null : m.name)}
                    onMouseEnter={() => openMenu && setOpenMenu(m.name)}
                    className={cn(
                      // R32(ISSUE-022):min-h-6 把 20px 撑到 24px(WCAG 2.5.8 AA)。
                      //   顶部栏 h-7(28px)放得下 24px,不会溢出。
                      //   shrink-0:R27 实测 flex 容器会把这类按钮压扁,不能省。
                      "min-h-6 shrink-0 px-2 py-0.5 hover:bg-ide-bg-active hover:text-ide-fg",
                      openMenu === m.name && "bg-ide-bg-active text-ide-fg",
                    )}
                  >
                    {m.name}
                  </button>
                  {openMenu === m.name && (
                    <div className="absolute left-0 top-full z-50 mt-px min-w-[200px] border border-ide-border bg-ide-bg-alt py-1 rtl:left-auto rtl:right-0">
                      {m.items.map((item, i) => (
                        <div key={i}>
                          {item.separator && <div className="my-1 border-t border-ide-border" />}
                          <button
                            onClick={() => runMenuItem(item.onClick)}
                            className="flex w-full items-center justify-between px-3 py-1 text-left hover:bg-ide-bg-active"
                          >
                            <span>{item.label}</span>
                            {item.shortcut && (
                              <span className="ml-4 text-[10px] text-ide-fg-muted">{item.shortcut}</span>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </div>
          <div className="hidden min-w-0 truncate text-ide-fg-muted sm:block md:max-w-[40%]">{t("layout.appTagline")}</div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* 左侧 ActivityBar(RTL 时通过 dir=rtl 自动翻转) */}
          <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-ide-border bg-ide-bg-alt py-2 rtl:border-r-0 rtl:border-l">
            {NAV_ITEMS.map(({ to, labelKey, Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={t(labelKey)}
                className={({ isActive }) =>
                  cn(
                    "group relative flex h-10 w-10 items-center justify-center text-ide-fg-muted transition-colors hover:text-ide-fg",
                    isActive && "text-ide-fg"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute left-0 top-0 h-full w-0.5 bg-ide-accent rtl:left-auto rtl:right-0" />
                    )}
                    <Icon size={20} />
                    <span className="pointer-events-none absolute left-12 z-50 whitespace-nowrap bg-ide-bg-active px-2 py-1 text-xs text-ide-fg opacity-0 transition-opacity group-hover:opacity-100 rtl:left-auto rtl:right-12">
                      {t(labelKey)}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* 主内容区 */}
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>

        {/* 底部状态栏 */}
        <footer className="flex h-6 shrink-0 items-center justify-between gap-2 border-t border-ide-border bg-ide-bg px-3 text-[11px] text-ide-fg-muted select-none">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-ide-accent">●</span>
            <span className="min-w-0 truncate text-ide-fg">{status.sessionLabel || t("layout.noSession")}</span>
            <span className="shrink-0 text-ide-border">│</span>
            <span className="min-w-0 truncate">{status.modelLabel || t("layout.noModel")}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={status.reasoning ? "text-ide-accent" : ""}>{status.reasoning ? t("layout.reasoningOn") : t("layout.reasoningOff")}</span>
            <span className="hidden text-ide-border sm:inline">│</span>
            <span className="hidden lg:inline">{t("layout.shortcutHint", { new: t("layout.shortcutNew"), send: t("layout.shortcutSend"), model: t("layout.shortcutModel") })}</span>
            <span className="hidden text-ide-border sm:inline">│</span>
            <span className="text-ide-fg">{now.toLocaleTimeString(locale, { hour12: false })}</span>
          </div>
        </footer>

        {/* 快捷键说明弹窗 */}
        {showHelp && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowHelp(false)}>
            <div className="w-full max-w-[420px] border border-ide-border bg-ide-bg-alt p-5 text-sm text-ide-fg" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 text-base font-semibold">{t("shortcuts.title")}</div>
              <div className="space-y-2">
                <div className="flex justify-between"><span>{t("shortcuts.newSession")}</span><kbd className="bg-ide-bg-active px-1.5 py-0.5 text-xs">Ctrl+Shift+N</kbd></div>
                <div className="flex justify-between"><span>{t("shortcuts.sendMessage")}</span><kbd className="bg-ide-bg-active px-1.5 py-0.5 text-xs">Ctrl+Enter</kbd></div>
                <div className="flex justify-between"><span>{t("shortcuts.switchModel")}</span><kbd className="bg-ide-bg-active px-1.5 py-0.5 text-xs">Ctrl+M</kbd></div>
              </div>
              <div className="mt-4 text-right">
                <button onClick={() => setShowHelp(false)} className="bg-ide-accent px-3 py-1 text-xs text-ide-accent-fg">{t("common.close")}</button>
              </div>
            </div>
          </div>
        )}

        {/* 关于弹窗 */}
        {showAbout && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAbout(false)}>
            <div className="w-full max-w-[380px] border border-ide-border bg-ide-bg-alt p-5 text-sm text-ide-fg" onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 text-lg font-semibold text-ide-accent">Tryout</div>
              <div className="text-xs text-ide-fg-muted">{t("about.appTagline")}</div>
              <div className="mt-3 space-y-1 text-xs">
                <div>{t("about.feature1")}</div>
                <div className="text-ide-fg-muted">{t("about.feature2")}</div>
              </div>
              <div className="mt-4 text-right">
                <button onClick={() => setShowAbout(false)} className="bg-ide-accent px-3 py-1 text-xs text-ide-accent-fg">{t("common.close")}</button>
              </div>
            </div>
          </div>
        )}

        {/* C3:首次访问 onboarding 画像采集 */}
        <OnboardingModal />
      </div>
    </LayoutContext.Provider>
  );
}
