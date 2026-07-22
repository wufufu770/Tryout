// ErrorBoundary:捕获子树渲染错误,避免整页白屏
// 从第一原理:class 组件的 componentDidCatch 是 React 唯一能捕获渲染错误的机制
// 增强:专门识别 ChunkLoadError(lazy import 失败),提示用户刷新页面
import { Component, type ReactNode } from "react";
import { tStatic } from "@/i18n";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error?: Error;
}

// 检测 ChunkLoadError:lazy import 的 chunk 加载失败(部署后旧 hash 失效 / 网络中断)
function isChunkLoadError(error: Error | undefined): boolean {
  if (!error) return false;
  return (
    error.name === "ChunkLoadError" ||
    /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module/i.test(error.message)
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // 控制台打印便于调试,生产可接入日志服务
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: undefined });
    // 强制刷新当前路由,避免错误状态残留
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const chunkError = isChunkLoadError(this.state.error);
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-ide-bg p-6 text-center">
        <div className="text-2xl">{chunkError ? "🔄" : "⚠️"}</div>
        <div className="text-sm font-semibold text-ide-fg">
          {chunkError ? tStatic("errorBoundary.chunkLoadTitle") : tStatic("errorBoundary.title")}
        </div>
        <div className="max-w-md break-all text-xs text-ide-fg-muted">
          {chunkError
            ? tStatic("errorBoundary.chunkLoadMessage")
            : (this.state.error?.message || tStatic("errorBoundary.unknown"))}
        </div>
        <button
          onClick={this.handleReload}
          className="mt-2 bg-ide-accent px-4 py-1.5 text-xs text-ide-accent-fg hover:bg-ide-accent-hover"
        >
          {tStatic("errorBoundary.reload")}
        </button>
      </div>
    );
  }
}
