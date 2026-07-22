import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // 启用 rtl 变体:支持阿拉伯语等 RTL 语言
  variants: {
    extend: {
      margin: ["rtl"],
      padding: ["rtl"],
      left: ["rtl"],
      right: ["rtl"],
      borderRadius: ["rtl"],
      borderWidth: ["rtl"],
      translate: ["rtl"],
      inset: ["rtl"],
    },
  },
  theme: {
    extend: {
      colors: {
        // 全部通过 CSS 变量驱动,切换 data-theme 即可整体换肤
        ide: {
          bg: "var(--ide-bg)",
          "bg-alt": "var(--ide-bg-alt)",
          "bg-active": "var(--ide-bg-active)",
          border: "var(--ide-border)",
          "border-active": "var(--ide-border-active)",
          fg: "var(--ide-fg)",
          "fg-muted": "var(--ide-fg-muted)",
          accent: "var(--ide-accent)",
          "accent-hover": "var(--ide-accent-hover)",
          "accent-fg": "var(--ide-accent-fg)",
          danger: "var(--ide-danger)",
          warning: "var(--ide-warning)",
          success: "var(--ide-success)",
          info: "var(--ide-info)",
        },
        bubble: {
          assistant: "var(--bubble-assistant)",
          user: "var(--bubble-user)",
          system: "var(--bubble-system)",
        },
      },
      fontFamily: {
        // UI 字体:Inter + 多语言回退(覆盖 10 种语言)
        sans: ["'Inter'", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "Roboto",
          "'PingFang SC'", "'Microsoft YaHei'", "'Hiragino Sans'", "'Noto Sans JP'", "'Noto Sans KR'",
          "'Noto Sans Arabic'", "'Noto Sans Devanagari'", "'Noto Sans Bengali'", "sans-serif"],
        // 等宽字体:JetBrains Mono(代码/终端区域)
        mono: ["'JetBrains Mono'", "'Cascadia Code'", "'SF Mono'", "Consolas", "'Courier New'", "monospace"],
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
