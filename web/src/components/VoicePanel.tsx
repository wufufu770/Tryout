// 语音控制面板组件
// 嵌入 InterviewPage,提供:Agent 语音配置、自动朗读、连续识别 + 自动提交、波形可视化
import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, Mic, MicOff, Play, Square, ChevronDown, ChevronRight, Radio } from "lucide-react";
import { voiceManager, isSpeechSupported } from "@/lib/voiceManager";
import { asrRegistry } from "@/lib/asrAdapter";
import { createVoiceVisualizer, type VisualizerHandle } from "@/lib/voiceVisualizer";
import { useI18n } from "@/i18n";
import { cn } from "@/shared";

export interface AgentVoiceConfig {
  voiceURI?: string;
  rate?: number;
  pitch?: number;
}

export interface VoicePanelProps {
  /** 当前 Agent ID(用于读取/写入 per-agent 语音配置) */
  agentId?: string | null;
  /** 当前 Agent 的语音配置 */
  voiceConfig: AgentVoiceConfig;
  /** Agent 语音配置变更回调 */
  onVoiceConfigChange: (cfg: AgentVoiceConfig) => void;
  /** 自动朗读开关 */
  autoSpeak: boolean;
  /** 自动朗读开关变更 */
  onAutoSpeakChange: (v: boolean) => void;
  /** 最近一条面试官消息文本(供手动播放重听) */
  lastAssistantText?: string;
  /** ASR 识别结果回调(实时,含 interim) */
  onRecognize: (text: string) => void;
  /** 最终识别结果回调(用于自动提交) */
  onFinalRecognize?: (text: string) => void;
  /** 是否默认展开 */
  defaultExpanded?: boolean;
}

export function VoicePanel({
  agentId,
  voiceConfig,
  onVoiceConfigChange,
  autoSpeak,
  onAutoSpeakChange,
  lastAssistantText,
  onRecognize,
  onFinalRecognize,
  defaultExpanded = false,
}: VoicePanelProps) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [speaking, setSpeaking] = useState(voiceManager.isSpeaking);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [listening, setListening] = useState(false);
  const [continuousMode, setContinuousMode] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [asrSupported, setAsrSupported] = useState(false);
  const asrRef = useRef(asrRegistry.getDefault());
  const vizCanvasRef = useRef<HTMLCanvasElement>(null);
  const vizRef = useRef<VisualizerHandle | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const autoSubmitTimerRef = useRef<number | null>(null);
  const lastFinalTextRef = useRef("");
  // autoSubmit 的 ref,避免 onResult 闭包捕获启动时的旧值(listening 期间切换开关不生效)
  const autoSubmitRef = useRef(autoSubmit);
  useEffect(() => {
    autoSubmitRef.current = autoSubmit;
  }, [autoSubmit]);

  const ttsSupported = isSpeechSupported();
  // ASR 语言跟随当前 UI 语言(取语言主代码,zh-CN/en-US 等)
  const asrLang = locale;

  // 加载语音列表 + 监听 speaking 状态
  useEffect(() => {
    if (!ttsSupported) return;
    const refresh = () => setVoices(voiceManager.getVoices());
    refresh();
    const timer = setTimeout(refresh, 300);
    const off = voiceManager.onSpeakingChange(setSpeaking);
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [ttsSupported]);

  // ASR 支持检测
  useEffect(() => {
    setAsrSupported(asrRef.current.isSupported());
  }, []);

  // 停止识别(在 expanded effect 之前定义,以便 effect 依赖)
  const stopListening = useCallback(() => {
    if (!listening) return;
    setListening(false);
    try { asrRef.current.stop(); } catch {}
    micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    micStreamRef.current = null;
    vizRef.current?.stop();
    if (autoSubmitTimerRef.current !== null) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
  }, [listening]);

  // 初始化波形可视化(canvas 存在时创建);折叠时停止 ASR + 麦克风 + 波形,避免资源泄漏
  useEffect(() => {
    if (!expanded) {
      stopListening();
      vizRef.current?.clear();
      return;
    }
    if (!vizCanvasRef.current) return;
    vizRef.current = createVoiceVisualizer(vizCanvasRef.current, "var(--ide-accent)", "bars");
    return () => {
      vizRef.current?.clear();
      vizRef.current = null;
    };
  }, [expanded, stopListening]);

  // 组件卸载时停止朗读、识别、麦克风
  useEffect(() => {
    return () => {
      voiceManager.stop();
      try { asrRef.current.stop(); } catch {}
      if (autoSubmitTimerRef.current !== null) clearTimeout(autoSubmitTimerRef.current);
      micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  // TTS 朗读时选择对应语种语音(跟随 locale)
  const localeVoices = voices.filter((v) => {
    const lang = (v.lang || "").toLowerCase();
    return lang.startsWith(locale.split("-")[0].toLowerCase());
  });
  const voiceOptions = localeVoices.length > 0 ? localeVoices : voices;

  const handlePlay = useCallback(() => {
    if (!lastAssistantText) return;
    voiceManager.speak(lastAssistantText, {
      voiceURI: voiceConfig.voiceURI,
      rate: voiceConfig.rate,
      pitch: voiceConfig.pitch,
    });
  }, [lastAssistantText, voiceConfig]);

  const handleStop = useCallback(() => {
    voiceManager.stop();
  }, []);

  // 开始识别:获取麦克风 + 启动 ASR + 启动波形
  const startListening = useCallback((continuous: boolean) => {
    if (!asrSupported || listening) return;
    setListening(true);
    lastFinalTextRef.current = "";

    // 获取麦克风流(用于波形可视化)
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then((stream) => {
        micStreamRef.current = stream;
        vizRef.current?.start(stream);
      })
      .catch(() => { /* 权限拒绝,波形保持静默基线 */ });

    asrRef.current.start({
      lang: asrLang,
      interimResults: true,
      continuous,
      onResult: (text, isFinal) => {
        onRecognize(text);
        if (isFinal && text.trim()) {
          lastFinalTextRef.current = text;
          // 自动提交:最终结果后 1.5s 无新文本则提交
          // 读 autoSubmitRef.current 而非闭包变量,使 listening 期间切换开关立即生效
          if (autoSubmitRef.current && onFinalRecognize) {
            if (autoSubmitTimerRef.current !== null) clearTimeout(autoSubmitTimerRef.current);
            autoSubmitTimerRef.current = window.setTimeout(() => {
              if (lastFinalTextRef.current.trim()) {
                onFinalRecognize(lastFinalTextRef.current.trim());
                lastFinalTextRef.current = "";
              }
              autoSubmitTimerRef.current = null;
            }, 1500);
          }
        }
      },
      onError: () => {
        setListening(false);
        micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
        micStreamRef.current = null;
        vizRef.current?.stop();
      },
    });
  }, [asrSupported, listening, asrLang, onRecognize, onFinalRecognize]);

  // 连续模式切换
  const toggleContinuous = useCallback(() => {
    if (listening) stopListening();
    const next = !continuousMode;
    setContinuousMode(next);
    if (next) startListening(true);
  }, [listening, continuousMode, startListening, stopListening]);

  // 按住说话(单次模式)
  const handleMicDown = useCallback(() => {
    if (continuousMode) return; // 连续模式不响应按住
    startListening(false);
  }, [continuousMode, startListening]);

  const handleMicUp = useCallback(() => {
    if (continuousMode) return;
    stopListening();
  }, [continuousMode, stopListening]);

  // 语音配置变更
  const handleVoiceChange = (voiceURI: string) => onVoiceConfigChange({ ...voiceConfig, voiceURI });
  const handleRateChange = (rate: number) => onVoiceConfigChange({ ...voiceConfig, rate });
  const handlePitchChange = (pitch: number) => onVoiceConfigChange({ ...voiceConfig, pitch });

  const cfg = voiceConfig;
  const rate = typeof cfg.rate === "number" ? cfg.rate : 1;
  const pitch = typeof cfg.pitch === "number" ? cfg.pitch : 1;

  return (
    <div className="border-t border-ide-border bg-ide-bg-alt">
      {/* 折叠头 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ide-fg-muted hover:bg-ide-bg-active"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {ttsSupported ? (
          <Volume2 size={12} className="text-ide-accent" />
        ) : (
          <VolumeX size={12} className="text-ide-warning" />
        )}
        <span className="text-ide-fg">{t("voice.enable")}</span>
        {/* 状态指示 */}
        <span className="ml-1 flex items-center gap-1 text-[10px]">
          {!ttsSupported && <span className="text-ide-warning">{t("voice.notSupported")}</span>}
          {ttsSupported && !asrSupported && <span className="text-ide-warning">ASR N/A</span>}
          {ttsSupported && asrSupported && <span className="text-ide-fg-muted">{t("status.ready")}</span>}
          {speaking && <span className="text-ide-accent">· {t("interview.speaking")}</span>}
          {listening && <span className="text-ide-danger">· {t("interview.listening")}</span>}
        </span>
        <span className="ml-auto text-[10px] text-ide-fg-muted">
          {agentId ? `${agentId.slice(0, 8)}` : "—"}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 px-3 pb-2">
          {/* 波形可视化 */}
          <canvas
            ref={vizCanvasRef}
            width={280}
            height={32}
            className="w-full"
            style={{ height: 32 }}
          />

          {/* 自动朗读 + 连续模式 + 自动提交 */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-[11px] text-ide-fg-muted">
              <input
                type="checkbox"
                checked={autoSpeak}
                onChange={(e) => onAutoSpeakChange(e.target.checked)}
                disabled={!ttsSupported}
                className="accent-ide-accent"
              />
              {t("voice.enable")}
            </label>
            <label className="flex items-center gap-1 text-[11px] text-ide-fg-muted">
              <input
                type="checkbox"
                checked={continuousMode}
                onChange={toggleContinuous}
                disabled={!asrSupported}
                className="accent-ide-accent"
              />
              <Radio size={10} /> {t("interview.listening")}
            </label>
            <label className="flex items-center gap-1 text-[11px] text-ide-fg-muted">
              <input
                type="checkbox"
                checked={autoSubmit}
                onChange={(e) => setAutoSubmit(e.target.checked)}
                disabled={!asrSupported || !onFinalRecognize}
                className="accent-ide-accent"
              />
              {t("interview.autoSubmit")}
            </label>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={handlePlay}
                disabled={!ttsSupported || !lastAssistantText || speaking}
                title={t("voice.enable")}
                className="flex items-center gap-1 border border-ide-border bg-ide-bg px-1.5 py-0.5 text-[10px] text-ide-fg hover:bg-ide-bg-active disabled:opacity-40"
              >
                <Play size={10} /> {t("voice.enable")}
              </button>
              <button
                onClick={handleStop}
                disabled={!speaking}
                title={t("common.close")}
                className="flex items-center gap-1 border border-ide-border bg-ide-bg px-1.5 py-0.5 text-[10px] text-ide-fg hover:bg-ide-bg-active disabled:opacity-40"
              >
                <Square size={10} /> {t("common.close")}
              </button>
            </div>
          </div>

          {/* Agent 语音配置 */}
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="text-ide-fg-muted">{t("voice.voice")}</span>
            <select
              value={cfg.voiceURI || ""}
              onChange={(e) => handleVoiceChange(e.target.value)}
              disabled={!ttsSupported || voiceOptions.length === 0}
              className="h-6 w-full min-w-0 border border-ide-border bg-ide-bg px-1 text-[11px] text-ide-fg outline-none focus:border-ide-accent disabled:opacity-50"
            >
              <option value="">{t("common.none")}</option>
              {voiceOptions.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} [{v.lang}]
                </option>
              ))}
            </select>

            <span className="text-ide-fg-muted">{t("voice.rate")} {rate.toFixed(1)}</span>
            <input
              type="range" min={0.5} max={2} step={0.1} value={rate}
              onChange={(e) => handleRateChange(parseFloat(e.target.value))}
              disabled={!ttsSupported}
              className="w-full accent-ide-accent disabled:opacity-50"
            />

            <span className="text-ide-fg-muted">{t("voice.pitch")} {pitch.toFixed(1)}</span>
            <input
              type="range" min={0} max={2} step={0.1} value={pitch}
              onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
              disabled={!ttsSupported}
              className="w-full accent-ide-accent disabled:opacity-50"
            />
          </div>

          {/* 按住说话(连续模式关闭时可用) */}
          {!continuousMode && (
            <div className="flex items-center gap-2">
              <button
                onMouseDown={handleMicDown}
                onMouseUp={handleMicUp}
                onMouseLeave={handleMicUp}
                onTouchStart={(e) => { e.preventDefault(); handleMicDown(); }}
                onTouchEnd={(e) => { e.preventDefault(); handleMicUp(); }}
                disabled={!asrSupported}
                className={cn(
                  "flex items-center gap-1 border px-2 py-1 text-[11px] select-none",
                  listening
                    ? "border-ide-danger bg-ide-danger/20 text-ide-danger"
                    : "border-ide-border bg-ide-bg text-ide-fg hover:bg-ide-bg-active",
                  !asrSupported && "opacity-40",
                )}
                title={asrSupported ? t("interview.listening") : t("voice.notSupported")}
              >
                {listening ? <Mic size={12} /> : <MicOff size={12} />}
                {listening ? t("common.close") : t("interview.listening")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
