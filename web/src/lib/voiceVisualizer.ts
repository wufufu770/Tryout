// voiceVisualizer:语音波形可视化(纯 Canvas,零依赖)
// 从第一原理:波形 = 音量随时间变化的曲线
// 用 Web Audio API 的 AnalyserNode 获取频域数据,绘制柱状/曲线波形
// 支持两种模式:录音(ASR)时显示输入波形;播放(TTS)时显示输出波形

export interface VisualizerHandle {
  /** 开始采集(传入 MediaStream,如麦克风) */
  start: (stream: MediaStream) => void;
  /** 停止采集 */
  stop: () => void;
  /** 清空画布 */
  clear: () => void;
}

/**
 * 创建波形可视化器
 * @param canvas 目标 canvas 元素
 * @param color 波形颜色(默认 accent 绿)
 * @param mode "bars" 柱状 | "wave" 曲线
 */
export function createVoiceVisualizer(
  canvas: HTMLCanvasElement,
  color = "#7ee787",
  mode: "bars" | "wave" = "bars",
): VisualizerHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { start: () => {}, stop: () => {}, clear: () => {} };

  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let rafId: number | null = null;
  let paused = false;
  const bufferLen = 64;
  const dataArray = new Uint8Array(bufferLen);

  const draw = () => {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!analyser) {
      // 无数据时画静默基线
      ctx.fillStyle = color + "30";
      const barW = w / bufferLen - 2;
      for (let i = 0; i < bufferLen; i++) {
        const barH = 2;
        ctx.fillRect(i * (barW + 2), (h - barH) / 2, barW, barH);
      }
      if (!paused) rafId = requestAnimationFrame(draw);
      return;
    }

    analyser.getByteFrequencyData(dataArray);

    if (mode === "bars") {
      const barW = w / bufferLen - 2;
      for (let i = 0; i < bufferLen; i++) {
        const v = dataArray[i] / 255;
        const barH = Math.max(2, v * h);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.4 + v * 0.6;
        ctx.fillRect(i * (barW + 2), (h - barH) / 2, barW, barH);
      }
      ctx.globalAlpha = 1;
    } else {
      // 曲线模式
      analyser.getByteTimeDomainData(dataArray);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const sliceW = w / bufferLen;
      for (let i = 0; i < bufferLen; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceW, y);
      }
      ctx.stroke();
    }
    if (!paused) rafId = requestAnimationFrame(draw);
  };

  // 启动初始绘制(静默基线)
  rafId = requestAnimationFrame(draw);

  return {
    start(stream) {
      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        // 若 RAF 已停止(stop 后或 clear 后),重启绘制循环
        if (rafId === null) {
          paused = false;
          rafId = requestAnimationFrame(draw);
        }
      } catch {
        /* AudioContext 创建失败,忽略,保持静默基线 */
      }
    },
    stop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      // R28:释放 WebAudio —— disconnect()/close() 在已断开/已关闭时抛,属幂等清理。
      try {
        source?.disconnect();
      } catch {
        // 见上
      }
      try {
        audioCtx?.close();
      } catch {
        // 见上
      }
      audioCtx = null;
      analyser = null;
      source = null;
      // 只画一次静默基线,不重启 RAF(避免 CPU 持续占用)
      paused = true;
      draw();
      paused = false;
    },
    clear() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      paused = true;
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
