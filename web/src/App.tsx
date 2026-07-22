import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { IdeLayout } from "@/components/IdeLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InterviewPage } from "@/pages/InterviewPage";
import { toast, type ToastEvent, type ToastKind } from "@/shared";

// 路由级懒加载:减小首屏 bundle,只加载当前路由代码
const GroupInterviewPage = lazy(() => import("@/pages/GroupInterviewPage").then(m => ({ default: m.GroupInterviewPage })));
const AgentPage = lazy(() => import("@/pages/AgentPage").then(m => ({ default: m.AgentPage })));
const MarketPage = lazy(() => import("@/pages/MarketPage").then(m => ({ default: m.MarketPage })));
const FlowPage = lazy(() => import("@/pages/FlowPage").then(m => ({ default: m.FlowPage })));
const ExperiencePage = lazy(() => import("@/pages/ExperiencePage").then(m => ({ default: m.ExperiencePage })));
const MaterialPage = lazy(() => import("@/pages/MaterialPage").then(m => ({ default: m.MaterialPage })));
const HistoryPage = lazy(() => import("@/pages/HistoryPage").then(m => ({ default: m.HistoryPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const AboutPage = lazy(() => import("@/pages/AboutPage").then(m => ({ default: m.AboutPage })));

// 路由级 loading 占位
function RouteLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-ide-fg-muted">
      加载中...
    </div>
  );
}

// 路由级 ErrorBoundary + Suspense 包装:
// 每个 lazy 路由独立包裹 ErrorBoundary,使 ChunkLoadError 只影响当前路由而非整页白屏
// 第一原理:错误边界捕获子树错误,Suspense 处理异步加载,两者职责正交
function LazyRoute({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteLoading />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

// 全局 Toast 容器:监听 "app:toast" 事件并渲染
function ToastContainer() {
  const [toasts, setToasts] = useState<ToastEvent[]>([]);
  // v10.2.6(D5):存储所有 toast 定时器,组件卸载时统一清理,防止内存泄漏
  const timersRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = (e as CustomEvent<ToastEvent>).detail;
      setToasts(prev => [...prev, ev]);
      // 3 秒后自动移除
      const timer = window.setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== ev.id));
        timersRef.current.delete(timer);
      }, 3000);
      timersRef.current.add(timer);
    };
    window.addEventListener("app:toast", handler as EventListener);
    return () => {
      window.removeEventListener("app:toast", handler as EventListener);
      timersRef.current.forEach(id => clearTimeout(id));
      timersRef.current.clear();
    };
  }, []);

  const colorMap: Record<ToastKind, string> = {
    info: "bg-ide-bg-alt border-ide-border text-ide-fg",
    success: "bg-ide-success/15 border-ide-success text-ide-success",
    error: "bg-ide-danger/15 border-ide-danger text-ide-danger",
    warning: "bg-ide-warning/15 border-ide-warning text-ide-warning",
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[200] flex flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-sm border px-3 py-2 text-xs shadow-lg ${colorMap[t.kind]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<IdeLayout />}>
          {/* 首页 InterviewPage 同步加载,保证首屏速度 */}
          <Route path="/interview" element={<InterviewPage />} />
          <Route path="/group" element={<LazyRoute><GroupInterviewPage /></LazyRoute>} />
          <Route path="/flow" element={<LazyRoute><FlowPage /></LazyRoute>} />
          <Route path="/experiences" element={<LazyRoute><ExperiencePage /></LazyRoute>} />
          <Route path="/market" element={<LazyRoute><MarketPage /></LazyRoute>} />
          <Route path="/agents" element={<LazyRoute><AgentPage /></LazyRoute>} />
          <Route path="/materials" element={<LazyRoute><MaterialPage /></LazyRoute>} />
          <Route path="/history" element={<LazyRoute><HistoryPage /></LazyRoute>} />
          <Route path="/settings" element={<LazyRoute><SettingsPage /></LazyRoute>} />
          <Route path="/about" element={<LazyRoute><AboutPage /></LazyRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/interview" replace />} />
      </Routes>
      <ToastContainer />
    </ErrorBoundary>
  );
}

// 抑制未使用警告(保留 toast 供全局调用)
void toast;
