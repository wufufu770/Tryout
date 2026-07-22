// InterviewPage 子组件:输入区
// 抽出 C7 输入区(文本/代码/白板 三种模式),内部管理输入模式相关状态
// text 模式的 input/setInput 由父组件持有(供 VoicePanel 语音识别复用),code/whiteboard 状态内部管理
import { useState } from "react";
import Editor from "@monaco-editor/react";
import { cn } from "@/shared";
import { useI18n } from "@/i18n";
import { Send, Code, PenLine, Type, Eraser } from "lucide-react";

interface MessageInputProps {
  input: string;
  setInput: (v: string) => void;
  isStreaming: boolean;
  sendMessage: (contentOverride?: string) => void;
}

export function MessageInput({ input, setInput, isStreaming, sendMessage }: MessageInputProps) {
  const { t } = useI18n();
  // C7:输入区模式 - text(默认)/ code(Monaco)/ whiteboard(SVG 画板)
  const [inputMode, setInputMode] = useState<"text" | "code" | "whiteboard">("text");
  // 代码模式状态
  const [codeContent, setCodeContent] = useState("");
  const [codeLanguage, setCodeLanguage] = useState("javascript");
  // 白板模式状态:SVG 路径列表
  const [whiteboardPaths, setWhiteboardPaths] = useState<Array<{ x: number; y: number }[]>>([]);
  const [whiteboardDrawing, setWhiteboardDrawing] = useState(false);
  const [whiteboardText, setWhiteboardText] = useState("");

  return (
    <div className="shrink-0 border-t border-ide-border bg-ide-bg-alt p-2">
      {/* 模式切换 Tab */}
      <div className="mb-1.5 flex items-center gap-1">
        <button
          onClick={() => setInputMode("text")}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 text-[11px] border",
            inputMode === "text"
              ? "border-ide-accent bg-ide-accent/10 text-ide-accent"
              : "border-ide-border text-ide-fg-muted hover:text-ide-fg"
          )}
        >
          <Type size={11} /> {t("input.mode.text")}
        </button>
        <button
          onClick={() => setInputMode("code")}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 text-[11px] border",
            inputMode === "code"
              ? "border-ide-accent bg-ide-accent/10 text-ide-accent"
              : "border-ide-border text-ide-fg-muted hover:text-ide-fg"
          )}
        >
          <Code size={11} /> {t("input.mode.code")}
        </button>
        <button
          onClick={() => setInputMode("whiteboard")}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 text-[11px] border",
            inputMode === "whiteboard"
              ? "border-ide-accent bg-ide-accent/10 text-ide-accent"
              : "border-ide-border text-ide-fg-muted hover:text-ide-fg"
          )}
        >
          <PenLine size={11} /> {t("input.mode.whiteboard")}
        </button>
      </div>

      {/* 文本模式 */}
      {inputMode === "text" && (
        <div className="flex items-end gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={t("interview.inputAnswerPlaceholder")} rows={2}
            className="min-h-[2.5rem] flex-1 resize-none border border-ide-border bg-ide-bg px-2 py-1 text-ide-fg outline-none focus:border-ide-accent" />
          <button onClick={() => sendMessage()} disabled={isStreaming || !input.trim()}
            className="flex h-8 items-center gap-1 bg-ide-accent px-3 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50">
            <Send size={14} /> {t("interview.send")}
          </button>
        </div>
      )}

      {/* 代码模式:Monaco + 语言选择 */}
      {inputMode === "code" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <select
              value={codeLanguage}
              onChange={(e) => setCodeLanguage(e.target.value)}
              className="h-6 border border-ide-border bg-ide-bg px-1 text-[11px] text-ide-fg"
            >
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="go">Go</option>
              <option value="cpp">C++</option>
              <option value="sql">SQL</option>
              <option value="rust">Rust</option>
            </select>
            <span className="text-[10px] text-ide-fg-muted">{t("input.codeLanguage")}</span>
            <button
              onClick={() => { setCodeContent(""); }}
              className="ml-auto text-[10px] text-ide-fg-muted hover:text-ide-fg"
              title={t("common.clear")}
            >
              <Eraser size={11} />
            </button>
          </div>
          <div className="border border-ide-border bg-ide-bg" style={{ height: 180 }}>
            <Editor
              language={codeLanguage}
              value={codeContent}
              onChange={(v) => setCodeContent(v || "")}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: 2,
              }}
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (!codeContent.trim()) return;
                // 用 markdown 代码块包裹,便于面试官识别
                const wrapped = "```" + codeLanguage + "\n" + codeContent + "\n```";
                sendMessage(wrapped);
                setCodeContent("");
              }}
              disabled={isStreaming || !codeContent.trim()}
              className="flex h-8 items-center gap-1 bg-ide-accent px-3 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
            >
              <Send size={14} /> {t("interview.send")}
            </button>
          </div>
        </div>
      )}

      {/* 白板模式:SVG 画板 + 文本输入 */}
      {inputMode === "whiteboard" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ide-fg-muted">{t("input.mode.whiteboard")}</span>
            <button
              onClick={() => setWhiteboardPaths([])}
              className="ml-auto flex items-center gap-1 text-[10px] text-ide-fg-muted hover:text-ide-fg"
              title={t("common.clear")}
            >
              <Eraser size={11} /> {t("common.clear")}
            </button>
          </div>
          <svg
            width="100%"
            height={180}
            className="border border-ide-border bg-white cursor-crosshair"
            onMouseDown={(e) => {
              const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              setWhiteboardPaths((prev) => [...prev, [{ x, y }]]);
              setWhiteboardDrawing(true);
            }}
            onMouseMove={(e) => {
              if (!whiteboardDrawing) return;
              const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              setWhiteboardPaths((prev) => {
                if (prev.length === 0) return prev;
                const last = prev[prev.length - 1];
                return [...prev.slice(0, -1), [...last, { x, y }]];
              });
            }}
            onMouseUp={() => setWhiteboardDrawing(false)}
            onMouseLeave={() => setWhiteboardDrawing(false)}
          >
            {whiteboardPaths.map((path, i) => (
              <polyline
                key={i}
                points={path.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#1a1a1a"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          <textarea
            value={whiteboardText}
            onChange={(e) => setWhiteboardText(e.target.value)}
            placeholder={t("interview.inputAnswerPlaceholder")}
            rows={1}
            className="min-h-[1.75rem] resize-none border border-ide-border bg-ide-bg px-2 py-1 text-xs text-ide-fg outline-none focus:border-ide-accent"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="text-[10px] text-ide-fg-muted">
              {whiteboardPaths.length} paths
            </span>
            <button
              onClick={() => {
                const text = whiteboardText.trim();
                if (!text) return;
                // 白板内容暂以文本描述发送(后端为文本接口)
                const pathNote = whiteboardPaths.length > 0
                  ? `\n\n[白板: ${whiteboardPaths.length} 条路径]`
                  : "";
                sendMessage(text + pathNote);
                setWhiteboardText("");
                setWhiteboardPaths([]);
              }}
              disabled={isStreaming || !whiteboardText.trim()}
              className="flex h-8 items-center gap-1 bg-ide-accent px-3 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
            >
              <Send size={14} /> {t("interview.send")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
