// 前端可观测性:零依赖,原生 API 实现
// 从第一原理:可观测性 = (1) 错误捕获 + (2) 性能指标 + (3) 上报通道
//
// 三类信号:
// 1. 错误:window.onerror + unhandledrejection + console.error 拦截
// 2. 性能:PerformanceObserver 监听 LCP/FID/CLS/INP/TTFB
// 3. 用户行为:可选,通过 track() 手动埋点
//
// 上报策略:
// - 错误:立即上报(sendBeacon,页面卸载也能送达)
// - 性能:缓冲上报(页面加载完成后批量上报一次)
// - 行为:按需上报
//
// 隐私:不收集用户输入、不收集 cookie、不收集 IP(后端自行记录)
// 限流:前端本地限流,同 msg 60s 内最多上报 5 次(防雪崩)

const ENDPOINT = "/api/log";
const FLUSH_INTERVAL_MS = 10_000; // 缓冲区刷新间隔
const MAX_BATCH = 20; // 批量上报最大条数
const DEDUP_WINDOW_MS = 60_000; // 去重窗口
const DEDUP_MAX = 5; // 同 msg 窗口内最大上报次数

interface LogEntry {
  level: "debug" | "info" | "warn" | "error" | "fatal";
  msg: string;
  fields?: Record<string, any>;
  type?: "error" | "performance" | "event";
}

const buffer: LogEntry[] = [];
const dedupMap = new Map<string, { count: number; firstAt: number }>();
let initialized = false;

// 本地去重:同 msg 60s 内最多 DEDUP_MAX 次
function shouldDedup(msg: string): boolean {
  const now = Date.now();
  const entry = dedupMap.get(msg);
  if (!entry || now - entry.firstAt > DEDUP_WINDOW_MS) {
    dedupMap.set(msg, { count: 1, firstAt: now });
    return false;
  }
  entry.count++;
  return entry.count > DEDUP_MAX;
}

// 上报单条(用 sendBeacon,页面卸载也能送达)
function send(entry: LogEntry): void {
  if (shouldDedup(entry.msg)) return;
  try {
    const payload = JSON.stringify(entry);
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(ENDPOINT, blob);
    } else {
      // fallback: fetch with keepalive
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => { /* ignore */ });
    }
  } catch {
    /* 上报失败不影响主流程 */
  }
}

// 缓冲上报:批量发送
function flush(): void {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, MAX_BATCH);
  for (const entry of batch) {
    send(entry);
  }
}

// 添加到缓冲区
function enqueue(entry: LogEntry): void {
  if (entry.level === "error" || entry.level === "fatal") {
    // 错误立即上报
    send(entry);
  } else {
    buffer.push(entry);
    if (buffer.length >= MAX_BATCH) {
      flush();
    }
  }
}

// 手动埋点
export function track(msg: string, fields?: Record<string, any>): void {
  enqueue({ level: "info", msg, fields, type: "event" });
}

// 错误上报
export function reportError(msg: string, fields?: Record<string, any>): void {
  enqueue({ level: "error", msg, fields, type: "error" });
}

// 性能指标上报
export function reportMetric(metric: string, value: number, rating?: string): void {
  enqueue({
    level: "info",
    msg: `metric:${metric}`,
    fields: { metric, value, rating },
    type: "performance",
  });
}

// 初始化:注册全局错误捕获和性能观察器
export function initObservability(): void {
  if (initialized) return;
  initialized = true;

  // 1. 全局 JS 错误
  window.addEventListener("error", (e) => {
    reportError(e.message || "unknown error", {
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack?.slice(0, 2000),
      url: location.pathname,
    });
  });

  // 2. Promise 未捕获拒绝
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    reportError("unhandledrejection", {
      stack: reason?.stack?.slice(0, 2000) || String(reason).slice(0, 500),
      url: location.pathname,
    });
  });

  // 3. 性能指标:Web Vitals
  // LCP (Largest Contentful Paint)
  if ("PerformanceObserver" in window) {
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) {
          const rating = last.startTime < 2500 ? "good" : last.startTime < 4000 ? "needs-improvement" : "poor";
          reportMetric("LCP", Math.round(last.startTime), rating);
        }
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
    } catch { /* some browsers don't support LCP */ }

    // CLS (Cumulative Layout Shift)
    try {
      let clsValue = 0;
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const lsEntry = entry as any;
          if (!lsEntry.hadRecentInput) {
            clsValue += lsEntry.value || 0;
          }
        }
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
      // 页面隐藏时上报最终 CLS
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && clsValue > 0) {
          const rating = clsValue < 0.1 ? "good" : clsValue < 0.25 ? "needs-improvement" : "poor";
          reportMetric("CLS", Number(clsValue.toFixed(4)), rating);
        }
      }, { once: true });
    } catch { /* ignore */ }

    // INP (Interaction to Next Paint) - 替代 FID
    try {
      let maxINP = 0;
      const inpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = (entry as any).duration || 0;
          if (duration > maxINP) maxINP = duration;
        }
      });
      inpObs.observe({ type: "event", buffered: true });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && maxINP > 0) {
          const rating = maxINP < 200 ? "good" : maxINP < 500 ? "needs-improvement" : "poor";
          reportMetric("INP", Math.round(maxINP), rating);
        }
      }, { once: true });
    } catch { /* ignore */ }

    // TTFB (Time to First Byte)
    try {
      const navEntries = performance.getEntriesByType("navigation");
      if (navEntries.length > 0) {
        const ttfb = (navEntries[0] as PerformanceNavigationTiming).responseStart;
        if (ttfb > 0) {
          const rating = ttfb < 800 ? "good" : ttfb < 1800 ? "needs-improvement" : "poor";
          reportMetric("TTFB", Math.round(ttfb), rating);
        }
      }
    } catch { /* ignore */ }
  }

  // 4. 定时刷新缓冲区
  setInterval(flush, FLUSH_INTERVAL_MS);

  // 5. 页面卸载时强制刷新
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);

  // 6. 上报初始加载
  track("page_load", { url: location.pathname });
}
