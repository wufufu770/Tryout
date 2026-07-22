// ASR(语音识别)适配器
// 分层架构 L0:浏览器原生 SpeechRecognition / webkitSpeechRecognition
// L1/L2/L3 预留:云端 ASR(Whisper / CosyVoice / 自研流式 ASR)
//
// 未来可注册云端 ASR:
//   asrRegistry.register("whisper", new WhisperASRAdapter({ apiKey, endpoint }));
//   asrRegistry.setDefault("whisper");

export interface ASROptions {
  onResult: (text: string, isFinal: boolean) => void;
  onError?: (e: Error) => void;
  /** BCP-47 语言,默认 zh-CN */
  lang?: string;
  /** 是否返回中间结果,默认 true */
  interimResults?: boolean;
  /** 连续模式,默认 false(单次识别) */
  continuous?: boolean;
}

export interface ASRAdapter {
  start(opts: ASROptions): void;
  stop(): void;
  isSupported(): boolean;
}

// 浏览器 SpeechRecognition 类型补全(标准尚未统一,webkit 前缀仍广泛使用)
interface SpeechRecognitionLikeEvent extends Event {
  readonly resultIndex: number;
  readonly results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: { transcript: string };
    };
  };
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionLikeEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as SpeechRecognitionWindow;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * 浏览器原生 ASR 适配器
 * 不支持时 isSupported 返回 false,start/stop 为 no-op
 */
export class BrowserASRAdapter implements ASRAdapter {
  private recognition: SpeechRecognitionLike | null = null;

  isSupported(): boolean {
    return getRecognitionCtor() !== null;
  }

  start(opts: ASROptions): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      opts.onError?.(new Error("浏览器不支持语音识别(SpeechRecognition)"));
      return;
    }
    // 已在识别则先停
    this.stop();
    try {
      const rec = new Ctor();
      rec.lang = opts.lang || "zh-CN";
      rec.interimResults = opts.interimResults ?? true;
      rec.continuous = opts.continuous ?? false;
      rec.maxAlternatives = 1;

      rec.onresult = (e: SpeechRecognitionLikeEvent) => {
        let text = "";
        let isFinal = false;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) isFinal = true;
          text += r[0]?.transcript || "";
        }
        if (text) opts.onResult(text, isFinal);
      };
      rec.onerror = (e: Event) => {
        const err = e as Event & { error?: string };
        opts.onError?.(new Error(`ASR 错误: ${err.error || "unknown"}`));
      };
      rec.onend = () => {
        this.recognition = null;
      };

      this.recognition = rec;
      rec.start();
    } catch (e: any) {
      opts.onError?.(new Error(`ASR 启动失败: ${e?.message || e}`));
    }
  }

  stop(): void {
    if (!this.recognition) return;
    try {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      this.recognition.stop();
    } catch {}
    this.recognition = null;
  }
}

interface ASRRegistry {
  register(name: string, adapter: ASRAdapter): void;
  get(name: string): ASRAdapter | undefined;
  getDefault(): ASRAdapter;
  setDefault(name: string): void;
  list(): string[];
  unregister(name: string): boolean;
}

function createRegistry(): ASRRegistry {
  const map = new Map<string, ASRAdapter>();
  let defaultName = "browser";

  // 默认注册浏览器适配器
  map.set("browser", new BrowserASRAdapter());

  return {
    register(name, adapter) {
      map.set(name, adapter);
    },
    get(name) {
      return map.get(name);
    },
    getDefault() {
      return map.get(defaultName) || map.get("browser")!;
    },
    setDefault(name) {
      if (map.has(name)) defaultName = name;
    },
    list() {
      return Array.from(map.keys());
    },
    unregister(name) {
      if (name === "browser") return false; // 默认项不可移除
      return map.delete(name);
    },
  };
}

export const asrRegistry: ASRRegistry = createRegistry();
