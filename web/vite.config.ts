/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  // W3-4:把体积大的独立依赖拆出主 chunk。
  // ⚠️ 更正:此前我判断"主 chunk 783 kB 是题库造成的"是**错的** ——
  // 题库迁走后主 chunk 大小未变。实测主 chunk 的主要构成是
  // recharts(图表)+ lucide-react(图标),与题库无关。
  // 拆包目的是让这些"非首屏必需"的依赖不被 HTML 阻塞下载。
  build: {
    rollupOptions: {
      output: {
        // ⚠️ 只列确实存在的依赖名。写不存在的包(如 monaco-editor,它未在
        // package.json 中声明)会让 Rollup 解析异常并可能 OOM。
        manualChunks: {
          // 图表库:仅历史页/评估页用得到
          charts: ["recharts"],
          // 图标:全站都在用,但可并行下载不阻塞首屏渲染
          icons: ["lucide-react"],
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
  },
});
