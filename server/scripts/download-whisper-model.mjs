// 下载本地 whisper 模型(供网络可达环境使用)
// 用法:
//   node scripts/download-whisper-model.mjs [tiny|base|small] [目标目录]
// 默认: small → ./data/models/whisper-small
// 镜像: HF_BASE=https://hf-mirror.com node scripts/download-whisper-model.mjs
import fs from "node:fs";
import path from "node:path";

const MODELS = {
  tiny: "Xenova/whisper-tiny",
  base: "Xenova/whisper-base",
  small: "Xenova/whisper-small",
};

const FILES = [
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
  "config.json",
  "preprocessor_config.json",
  "generation_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
];

const HF_BASE = process.env.HF_BASE || "https://huggingface.co";

async function main() {
  const size = process.argv[2] || "small";
  const model = MODELS[size];
  if (!model) {
    console.error(`未知模型: ${size}(可选 tiny/base/small)`);
    process.exit(1);
  }
  const target = path.resolve(
    process.argv[3] || path.join("data", "models", `whisper-${size}`),
  );
  const onnxDir = path.join(target, "onnx");
  fs.mkdirSync(onnxDir, { recursive: true });

  console.log(`[download] ${model} → ${target}`);
  for (const file of FILES) {
    const url = `${HF_BASE}/${model}/resolve/main/${file}`;
    const dest = path.join(target, file);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[download] FAILED ${file}: HTTP ${res.status} (${url})`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log(`[download] ✓ ${file} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
  }
  console.log(`[download] 完成。设置 WHISPER_MODEL_DIR=${target} 或放到数据目录启用`);
}

main().catch((err) => {
  console.error("[download] 失败:", err.message);
  process.exit(1);
});
