// 临时验证脚本:本地 whisper 转写链路
// 用法: node scripts/whisper-check.mjs <音频文件> [language]
import { readFile } from "node:fs/promises";
import { transcribeAudio } from "../services/whisper.js";

const file = process.argv[2];
const lang = process.argv[3] || "zh";
if (!file) {
  console.error("usage: node scripts/whisper-check.mjs <audio> [language]");
  process.exit(1);
}

const t0 = Date.now();
console.log(`[whisper-check] loading model + transcribing ${file} (lang=${lang}) ...`);
const buf = await readFile(file);
try {
  const result = await transcribeAudio(buf, lang);
  console.log(`[whisper-check] done in ${Date.now() - t0}ms (infer ${result.duration_ms}ms)`);
  console.log(`[whisper-check] model: ${result.model}`);
  console.log(`[whisper-check] text: "${result.text}"`);
  console.log(`[whisper-check] chunks: ${JSON.stringify(result.chunks).slice(0, 500)}`);
} catch (err) {
  console.error("[whisper-check] FAILED:", err.message);
  process.exit(1);
}
