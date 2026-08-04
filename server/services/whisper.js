// 本地语音转写服务(whisper via @xenova/transformers)
// 策略:
// - 纯 JS/WASM/ONNX 推理,零原生编译依赖
// - 模型来源优先级: 本地目录(WHISPER_MODEL_DIR 或 DB_DIR/models/whisper-*) → 在线下载(HF)
// - 懒加载:首次转写时才初始化 pipeline,避免拖慢启动
// - 模型缺失/网络不可达时返回明确错误码,由调用方降级(浏览器 ASR)
import { pipeline } from "@xenova/transformers";
import fs from "node:fs";
import path from "node:path";

const MODELS = {
  tiny: "Xenova/whisper-tiny",
  base: "Xenova/whisper-base",
  small: "Xenova/whisper-small",
};

// 加载模式:local(本地目录)/online(在线下载)
let loadMode = "auto";
let transcriber = null;
let initializing = null;

/**
 * 解析本地模型目录(存在则优先)
 * @param {string} dbDir 应用数据目录(DB_DIR)
 * @returns {{mode: string, path?: string, model: string}}
 */
export function resolveModelSource(dbDir) {
  // 1) 显式指定本地目录
  if (process.env.WHISPER_MODEL_DIR) {
    const p = path.resolve(process.env.WHISPER_MODEL_DIR);
    if (fs.existsSync(path.join(p, "onnx"))) {
      return { mode: "local", path: p, model: p };
    }
  }
  // 2) 数据目录下 models/whisper-{tiny,base,small}
  if (dbDir) {
    for (const name of ["whisper-small", "whisper-base", "whisper-tiny"]) {
      const p = path.join(dbDir, "models", name);
      if (fs.existsSync(path.join(p, "onnx"))) {
        return { mode: "local", path: p, model: name };
      }
    }
  }
  // 3) 在线兜底
  const model = MODELS[process.env.WHISPER_MODEL || "small"] || MODELS.small;
  return { mode: "online", model };
}

async function getTranscriber(dbDir) {
  if (transcriber) return transcriber;
  if (initializing) return initializing;
  initializing = (async () => {
    const src = resolveModelSource(dbDir);
    if (src.mode === "local") {
      // 本地模型:local_files_only 防止意外联网
      transcriber = await pipeline("automatic-speech-recognition", src.path, {
        quantized: true,
        local_files_only: true,
      });
      loadMode = "local";
    } else {
      transcriber = await pipeline("automatic-speech-recognition", src.model, {
        quantized: true,
      });
      loadMode = "online";
    }
    return transcriber;
  })().catch((err) => {
    initializing = null;
    throw err;
  });
  return initializing;
}

/**
 * 转写音频 Buffer
 * @param {Buffer} audio 音频数据(wav/webm/ogg/mp3 等 whisper 支持的格式)
 * @param {string} [language] 语言代码,默认 zh
 * @param {string} [dbDir] 应用数据目录(用于解析本地模型)
 * @returns {Promise<{ok: boolean, text: string, model: string, mode: string, duration_ms: number, chunks: object[], error?: string}>}
 */
export async function transcribeAudio(audio, language = "zh", dbDir) {
  const started = Date.now();
  let t;
  try {
    t = await getTranscriber(dbDir);
  } catch (err) {
    return {
      ok: false,
      text: "",
      model: "",
      mode: "unavailable",
      duration_ms: 0,
      chunks: [],
      error: `whisper 模型不可用: ${err.message}`,
    };
  }
  try {
    const output = await t(audio, {
      language,
      return_timestamps: true,
    });
    const text = (output?.text || "").trim();
    const chunks = Array.isArray(output?.chunks)
      ? output.chunks.map((c) => ({ timestamp: c.timestamp, text: c.text }))
      .filter((c) => c.text.trim())
      : [];
    return {
      ok: true,
      text,
      model: "local-whisper",
      mode: loadMode,
      duration_ms: Date.now() - started,
      chunks,
    };
  } catch (err) {
    return {
      ok: false,
      text: "",
      model: "local-whisper",
      mode: loadMode,
      duration_ms: Date.now() - started,
      chunks: [],
      error: `转写失败: ${err.message}`,
    };
  }
}

/** 估算语速(字/分钟),基于音频时长与字数 */
export function estimateWPM(text, audioDurationSec) {
  if (!text || audioDurationSec <= 0) return 0;
  const chars = text.replace(/\s+/g, "").length;
  return Math.round((chars / audioDurationSec) * 60);
}

export const whisper = {
  transcribe: transcribeAudio,
  estimateWPM,
  resolveModelSource,
};
