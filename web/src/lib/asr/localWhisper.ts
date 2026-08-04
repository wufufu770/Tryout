// 本地 whisper ASR 适配器(服务端转写)
// 流程: MediaRecorder 录音(webm/opus) → 上传 /api/transcribe(服务端本地 whisper) → 一次性返回转录
// 与浏览器 SpeechRecognition 的区别:
//   - 音频不离开本机(服务端本地推理,契合本地优先基因)
//   - 所有 Chromium/Firefox/Safari 可用(不依赖 Chrome 专属 API)
// 注册进 asrRegistry 后,VoicePanel 无需改动即可切换
import { api } from "@/api/client";
import { asrRegistry, type ASRAdapter, type ASROptions } from "@/lib/asrAdapter";

// 模块级会话上下文(VoicePanel 无 sessionId,由 InterviewPage 同步)
let ctx: { sessionId: string | null; question: string } = { sessionId: null, question: "" };
export function setWhisperContext(sessionId: string | null, question: string) {
  ctx = { sessionId, question };
}

// 挑选浏览器录音格式(Chrome: webm/opus; Firefox: ogg/opus; Safari: mp4/aac)
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch { /* ignore */ }
  }
  return "";
}

export class ServerWhisperAdapter implements ASRAdapter {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private startedAt = 0;
  private active = false;
  private opts: ASROptions | null = null;

  isSupported(): boolean {
    if (typeof window === "undefined") return false;
    return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  start(opts: ASROptions): void {
    if (this.active || !this.isSupported()) {
      if (!this.isSupported()) opts.onError?.(new Error("浏览器不支持 MediaRecorder 录音"));
      return;
    }
    this.active = true;
    this.opts = opts;
    this.chunks = [];
    this.startedAt = Date.now();

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (!this.active) { // 录音期间被 stop
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const mime = pickMimeType();
        let rec: MediaRecorder;
        try {
          rec = mime
            ? new MediaRecorder(stream, { mimeType: mime })
            : new MediaRecorder(stream);
        } catch (e) {
          this.active = false;
          stream.getTracks().forEach((t) => t.stop());
          opts.onError?.(new Error("录音初始化失败"));
          return;
        }
        this.stream = stream;
        this.recorder = rec;
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) this.chunks.push(e.data);
        };
        rec.onstop = () => this.upload();
        rec.start();
      })
      .catch((err) => {
        this.active = false;
        const name = err?.name || "";
        opts.onError?.(new Error(name === "NotAllowedError" ? "麦克风权限被拒绝" : `麦克风不可用: ${err?.message || "未知错误"}`));
      });
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    try { this.recorder?.stop(); } catch { /* 未开始 */ }
    this.recorder = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  // 录音完成 → 上传转写 → 一次性 onResult(final)
  private async upload() {
    const opts = this.opts;
    this.opts = null;
    if (!opts) return;
    const blob = new Blob(this.chunks, { type: this.chunks[0]?.type || "audio/webm" });
    this.chunks = [];
    const durationMs = Date.now() - this.startedAt;
    if (blob.size === 0) {
      opts.onError?.(new Error("未录制到声音"));
      return;
    }
    try {
      const result = await api.transcribeAudio(blob, {
        sessionId: ctx.sessionId || "",
        question: ctx.question,
        durationMs,
        language: (opts.lang || "zh-CN").split("-")[0],
      });
      if (result?.ok && result.text) {
        opts.onResult(result.text, true);
      } else if (!result?.ok) {
        // 模型未安装/不可用:给出可操作提示
        const hint = result?.error?.includes("fetch failed") || result?.mode === "unavailable"
          ? "本地 whisper 模型未安装。请运行: node scripts/download-whisper-model.mjs 或设置 WHISPER_MODEL_DIR"
          : (result?.error || "转写失败,请重试");
        opts.onError?.(new Error(hint));
      } else if (!result?.text) {
        opts.onError?.(new Error("未识别到语音内容,请重试"));
      }
    } catch (e: any) {
      opts.onError?.(new Error(e?.message || "转写请求失败,请检查服务端"));
    }
  }
}

// 注册并设为默认(服务端本地 whisper 优先于浏览器云端识别)
// 浏览器 SpeechRecognition 仍保留在 registry,可通过 asrRegistry.setDefault("browser") 切回
let registered = false;
export function registerLocalWhisper() {
  if (registered) return;
  registered = true;
  asrRegistry.register("local-whisper", new ServerWhisperAdapter());
  asrRegistry.setDefault("local-whisper");
}

// 模块顶层注册:import 即生效(VoicePanel 渲染时 getDefault() 已能拿到 local-whisper,
// 不受 React 父组件 useEffect 执行时序影响)
registerLocalWhisper();
