// 语音合成管理器(基于 Web Speech API)
// 分层架构 L0:浏览器原生 SpeechSynthesis
// L1/L2/L3 预留:云端 TTS(CosyVoice / OpenAI TTS / 自研流式 TTS)

export interface SpeakOptions {
  voiceURI?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (e: SpeechSynthesisErrorEvent) => void;
}

type SpeakingListener = (speaking: boolean) => void;

// 浏览器类型补全(webkitSpeechRecognition 在 asrAdapter 中处理,这里只补 synthesis 相关)
type SpeechSynthesisWindow = Window &
  typeof globalThis & {
    speechSynthesis?: SpeechSynthesis;
  };

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  const w = window as SpeechSynthesisWindow;
  return w.speechSynthesis || null;
}

export function isSpeechSupported(): boolean {
  const synth = getSynth();
  return !!synth && typeof synth.speak === "function";
}

class VoiceManager {
  private synth: SpeechSynthesis | null;
  private voicesCache: SpeechSynthesisVoice[] = [];
  private voicesReady = false;
  private listeners: Set<SpeakingListener> = new Set();
  private _isSpeaking = false;

  constructor() {
    this.synth = getSynth();
    if (this.synth) {
      // voices 异步加载(Chrome 行为)
      const handleVoicesChanged = () => {
        this.voicesCache = this.synth!.getVoices() || [];
        this.voicesReady = true;
      };
      this.synth.onvoiceschanged = handleVoicesChanged;
      // 立即尝试一次(部分浏览器同步返回)
      handleVoicesChanged();
      // 注:lib.dom.d.ts 中 SpeechSynthesis 未声明 onstart/onend/onerror,用 as any 绕过
      (this.synth as any).onstart = () => this.setSpeaking(true);
      (this.synth as any).onend = () => this.setSpeaking(false);
      (this.synth as any).onerror = () => this.setSpeaking(false);
    }
  }

  private setSpeaking(v: boolean) {
    this._isSpeaking = v;
    this.listeners.forEach((fn) => fn(v));
  }

  get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  /** 监听朗读状态变化,返回取消函数 */
  onSpeakingChange(fn: SpeakingListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * 获取系统可用语音,中文优先排序(zh-* > 其余)
   * 不支持时返回空数组
   */
  getVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    // 每次调用刷新一次缓存(防止首次未就绪)
    const list = this.synth.getVoices() || [];
    if (list.length > 0) this.voicesCache = list;
    const voices = this.voicesCache.length > 0 ? this.voicesCache : list;
    return [...voices].sort((a, b) => {
      const aZh = a.lang?.toLowerCase().startsWith("zh") ? 0 : 1;
      const bZh = b.lang?.toLowerCase().startsWith("zh") ? 0 : 1;
      if (aZh !== bZh) return aZh - bZh;
      // 中文内部:普通话(zh-CN)优先
      if (aZh === 0) {
        const aCn = a.lang?.toLowerCase().includes("cn") ? 0 : 1;
        const bCn = b.lang?.toLowerCase().includes("cn") ? 0 : 1;
        if (aCn !== bCn) return aCn - bCn;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * 朗读文本。若正在朗读则先 cancel。
   * 不支持时静默降级(no-op),仍触发 onEnd 以保证调用方流程不阻塞
   */
  speak(text: string, opts: SpeakOptions = {}) {
    if (!this.synth || !text) {
      opts.onEnd?.();
      return;
    }
    // 先取消正在朗读的
    try {
      this.synth.cancel();
    } catch {}

    const utter = new SpeechSynthesisUtterance(text);
    const voices = this.getVoices();
    if (opts.voiceURI) {
      const matched = voices.find((v) => v.voiceURI === opts.voiceURI);
      if (matched) utter.voice = matched;
    } else {
      // 默认取第一个中文语音
      const zh = voices.find((v) => v.lang?.toLowerCase().startsWith("zh"));
      if (zh) utter.voice = zh;
    }
    if (typeof opts.rate === "number") utter.rate = opts.rate;
    if (typeof opts.pitch === "number") utter.pitch = opts.pitch;
    if (typeof opts.volume === "number") utter.volume = opts.volume;

    utter.onstart = () => {
      this.setSpeaking(true);
      opts.onStart?.();
    };
    utter.onend = () => {
      this.setSpeaking(false);
      opts.onEnd?.();
    };
    utter.onerror = (e) => {
      this.setSpeaking(false);
      opts.onError?.(e);
      opts.onEnd?.();
    };

    try {
      this.synth.speak(utter);
    } catch {
      this.setSpeaking(false);
      opts.onEnd?.();
    }
  }

  /** 停止朗读 */
  stop() {
    if (!this.synth) return;
    try {
      this.synth.cancel();
    } catch {}
    this.setSpeaking(false);
  }
}

// 单例
export const voiceManager = new VoiceManager();
