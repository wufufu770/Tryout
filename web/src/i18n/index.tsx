// i18n:零依赖轻量国际化方案
// 从第一原理:i18n = (1) 当前语言 state + (2) 翻译字典 + (3) t(key) 查找函数
// 不引入 react-i18next,避免额外依赖;用 React Context 实现
//
// 按需加载:默认 zh-CN 同步加载(避免首屏闪烁),其余 9 种语言用 dynamic import
// Vite 会自动把每个动态 import 的 JSON 拆成独立 chunk,首次切换时才下载
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import zhCN from "./locales/zh-CN.json";

export type Locale = "zh-CN" | "en-US" | "hi-IN" | "es-ES" | "fr-FR" | "ar-SA" | "bn-BD" | "pt-BR" | "ru-RU" | "ja-JP";

export interface LocaleMeta {
  code: Locale;
  label: string;       // 用本语言显示的名称,如 "中文"
  englishName: string; // 英文名,如 "Chinese"
  dir: "ltr" | "rtl";  // 文本方向
}

// 10 种语言,按使用人数排序
export const LOCALES: LocaleMeta[] = [
  { code: "zh-CN", label: "中文", englishName: "Chinese", dir: "ltr" },
  { code: "en-US", label: "English", englishName: "English", dir: "ltr" },
  { code: "hi-IN", label: "हिन्दी", englishName: "Hindi", dir: "ltr" },
  { code: "es-ES", label: "Español", englishName: "Spanish", dir: "ltr" },
  { code: "fr-FR", label: "Français", englishName: "French", dir: "ltr" },
  { code: "ar-SA", label: "العربية", englishName: "Arabic", dir: "rtl" },
  { code: "bn-BD", label: "বাংলা", englishName: "Bengali", dir: "ltr" },
  { code: "pt-BR", label: "Português", englishName: "Portuguese", dir: "ltr" },
  { code: "ru-RU", label: "Русский", englishName: "Russian", dir: "ltr" },
  { code: "ja-JP", label: "日本語", englishName: "Japanese", dir: "ltr" },
];

// 按需加载器:每个非默认语言一个 dynamic import,Vite 自动拆 chunk
const localeLoaders: Record<Locale, () => Promise<any>> = {
  "zh-CN": () => Promise.resolve(zhCN),
  "en-US": () => import("./locales/en-US.json"),
  "hi-IN": () => import("./locales/hi-IN.json"),
  "es-ES": () => import("./locales/es-ES.json"),
  "fr-FR": () => import("./locales/fr-FR.json"),
  "ar-SA": () => import("./locales/ar-SA.json"),
  "bn-BD": () => import("./locales/bn-BD.json"),
  "pt-BR": () => import("./locales/pt-BR.json"),
  "ru-RU": () => import("./locales/ru-RU.json"),
  "ja-JP": () => import("./locales/ja-JP.json"),
};

// 字典缓存:加载后保留,避免重复请求
// messageCache 供 tStatic(非 hook 版本)使用;I18nProvider 内部用 useState 管理同一份数据
const messageCache: Partial<Record<Locale, Record<string, string>>> = {
  "zh-CN": zhCN as any,
};

const STORAGE_KEY = "interviewx:locale";

function detectInitialLocale(): Locale {
  // 1. localStorage
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && localeLoaders[saved]) return saved;
  } catch { /* 隐私模式 */ }
  // 2. 浏览器语言:先精确匹配,再回退到 primary tag
  const nav = navigator.language || "zh-CN";
  for (const l of LOCALES) {
    if (nav === l.code) return l.code;
  }
  for (const l of LOCALES) {
    if (nav.startsWith(l.code.split("-")[0])) return l.code;
  }
  // 3. 默认中文
  return "zh-CN";
}

interface I18nContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
  loading: boolean; // 目标语言字典加载中
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);
  const [loading, setLoading] = useState(false);
  // MESSAGES 移到 useState:每次字典加载完成更新 state,自动触发所有消费组件重渲染
  // 替代 dictVersion 反模式:messages 引用变化即触发重渲染,无需额外的版本号
  const [messages, setMessages] = useState<Partial<Record<Locale, Record<string, string>>>>({ "zh-CN": zhCN as any });

  const dir = LOCALES.find((l) => l.code === locale)?.dir ?? "ltr";

  // 同步 <html lang> 和 <html dir>,确保整页方向正确
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  // 首次挂载:若初始 locale 非默认,需异步加载字典
  useEffect(() => {
    if (messages[locale]) return;
    let cancelled = false;
    setLoading(true);
    localeLoaders[locale]()
      .then(mod => {
        if (cancelled) return;
        const dict = mod.default || mod;
        // 同步更新 state(驱动重渲染)和 cache(供 tStatic 使用)
        messageCache[locale] = dict;
        setMessages(prev => ({ ...prev, [locale]: dict }));
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setLoading(false);
        console.error(`[i18n] 加载 ${locale} 字典失败:`, err);
      });
    return () => { cancelled = true; };
  }, [locale, messages]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { console.warn("Failed to persist locale:", e); }
    // 若字典未加载,上面 useEffect 会触发加载;加载完 messages 更新自动触发重渲染
  }, []);

  // t 依赖 locale + messages:字典加载完成后 messages 引用变化,自动触发所有调用 t() 的组件重渲染
  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const dict = messages[locale] || messages["zh-CN"] || {};
    let str = dict[key] ?? (zhCN as any)[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        // 用 split/join 替代 RegExp,避免 ReDoS 风险和特殊字符转义问题
        str = str.split(`{${k}}`).join(String(v));
      }
    }
    return str;
  }, [locale, messages]);

  return (
    <I18nContext.Provider value={{ locale, dir, t, setLocale, loading }}>
      {loading && !messages[locale] ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#888", fontSize: 14 }}>
          Loading…
        </div>
      ) : children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

// 非 hook 版本:供 class 组件(如 ErrorBoundary)在渲染期使用
// 读取当前 localStorage 的 locale,查对应字典,查不到 fallback 到 zh-CN 再到 key 本身
export function tStatic(key: string, vars?: Record<string, string | number>): string {
  let locale: Locale = "zh-CN";
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && localeLoaders[saved]) locale = saved;
  } catch { /* ignore */ }
  const dict = messageCache[locale] || (zhCN as any);
  let str = dict[key] ?? (zhCN as any)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      // 用 split/join 替代 RegExp,与 t() 保持一致
      str = str.split(`{${k}}`).join(String(v));
    }
  }
  return str;
}
