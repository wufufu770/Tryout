// 主题系统:通过 data-theme 属性 + CSS 变量实现多主题切换
// 主题定义集中在此,便于扩展
export type ThemeId = "interviewx-dark" | "github-light" | "muted-warm" | "cyber";

export interface ThemeMeta {
  id: ThemeId;
  name: string;          // fallback 中文名
  nameKey: string;       // i18n key for name
  description: string;   // fallback 中文描述
  descKey: string;       // i18n key for description
  swatch: string[]; // 色块预览:[背景, 强调, 前景]
}

export const THEMES: ThemeMeta[] = [
  {
    id: "interviewx-dark",
    name: "深色终端",
    nameKey: "theme.interviewx-dark.name",
    description: "GitHub Dark 深黑 + 绿色强调,默认主题",
    descKey: "theme.interviewx-dark.desc",
    swatch: ["#0d1117", "#7ee787", "#e6edf3"],
  },
  {
    id: "github-light",
    name: "浅色日间",
    nameKey: "theme.github-light.name",
    description: "米白背景 + 蓝色强调,适合明亮环境",
    descKey: "theme.github-light.desc",
    swatch: ["#ffffff", "#0969da", "#24292f"],
  },
  {
    id: "muted-warm",
    name: "暖色护眼",
    nameKey: "theme.muted-warm.name",
    description: "低饱和暖灰 + 琥珀强调,长时间阅读舒适",
    descKey: "theme.muted-warm.desc",
    swatch: ["#1e1b16", "#d4a05a", "#d6cfc2"],
  },
  {
    id: "cyber",
    name: "赛博朋克",
    nameKey: "theme.cyber.name",
    description: "深紫黑 + 霓虹粉青,视觉冲击强",
    descKey: "theme.cyber.desc",
    swatch: ["#0a0a14", "#ff2d95", "#e0e0ff"],
  },
];

const STORAGE_KEY = "interviewx:theme";

export function getStoredTheme(): ThemeId {
  const DEFAULT: ThemeId = "interviewx-dark";
  try {
    if (typeof localStorage === "undefined") return DEFAULT;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const v = raw as ThemeId;
    return THEMES.some((t) => t.id === v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setStoredTheme(id: ThemeId) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
  applyTheme(id);
}

export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", id);
}
