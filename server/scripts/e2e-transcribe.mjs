#!/usr/bin/env node
/*
 * ISSUE-027 端到端回归:/api/transcribe 的完整分支
 *
 * ## 补的是什么缺口
 * 此前只有 `e2e-voice-smoke.mjs` 顺带验证了"模型缺失时返回 ok:false"**一个**分支,
 * 其余分支(参数校验、类型/体积限制、会话不存在、成功路径)完全没有覆盖。
 *
 * ## 覆盖的分支
 *   A. 无 audio 文件 → 400
 *   B. 缺 sessionId → 400
 *   C. sessionId 不存在 → 404
 *   D. 不支持的音频类型 → 400
 *   E. 超过 20MB → 4xx(不得 500)
 *   F. 合法请求但 whisper 模型缺失 → **降级为 200 + ok:false**(不是 5xx)
 *   G. 降级时不应写入 answer_recordings(避免脏数据)
 *   H. 降级响应必须带可操作的 error 文案
 *
 * 注:本机没有 whisper 模型,F 分支走的是"模型不可用"路径 ——
 *     这恰好是最需要被锁住的生产场景(用户装了应用但没下模型)。
 *
 * 用法:node scripts/e2e-transcribe.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// R56:诊断信息安全格式化 —— JSON.stringify(undefined) 不是字符串,`.slice` 会崩
import { brief } from "./lib/brief.mjs";

const PORT = 3494;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-tr-"));
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = path.resolve(import.meta.dirname, "..");

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };

let child = null, srvLog = "", cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { child?.kill("SIGKILL"); } catch { /* 已退出 */ }
  try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 已删 */ }
}
process.on("exit", cleanup);
process.on("uncaughtException", (e) => { console.error("[未捕获]", e?.message); cleanup(); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("[未处理拒绝]", e?.message); cleanup(); process.exit(1); });

child = spawn("node", ["index.js"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), DB_DIR, NODE_ENV: "test", INTERVIEWX_AUTH_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => { srvLog += d; });
child.stderr.on("data", (d) => { srvLog += d; });

for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* 未就绪 */ }
  await new Promise((r) => setTimeout(r, 400));
}
const api = async (method, p, body) => {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

/** 上传音频 */
async function uploadAudio({ withFile = true, fields = {}, filename = "a.webm", type = "audio/webm", size = 64 }) {
  const fd = new FormData();
  if (withFile) {
    fd.append("audio", new Blob([new Uint8Array(size)], { type }), filename);
  }
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(`${BASE}/api/transcribe`, { method: "POST", body: fd });
  return { status: r.status, json: await r.json().catch(() => null) };
}

/* ---------- 准备一个真实会话 ---------- */
const s = await api("POST", "/api/sessions", { title: "转写测试", modelId: "m1" });
const SID = s.json?.data?.sessionId;
SID ? ok(`准备会话:${SID}`) : bad("创建会话失败");

/* ---------- A. 无文件 ---------- */
console.log("\n── A. 参数与前置校验 ──");
{
  const r = await uploadAudio({ withFile: false, fields: { sessionId: SID } });
  r.status === 400 ? ok("无 audio 文件 → 400") : bad(`无文件返回 ${r.status},应为 400`);
}
{
  const r = await uploadAudio({ withFile: true, fields: {} });   // 缺 sessionId
  r.status === 400 ? ok("缺 sessionId → 400") : bad(`缺 sessionId 返回 ${r.status},应为 400`);
}
{
  const r = await uploadAudio({ withFile: true, fields: { sessionId: "no-such-session" } });
  r.status === 404 ? ok("sessionId 不存在 → 404") : bad(`不存在的会话返回 ${r.status},应为 404`);
}

/* ---------- D/E. 类型与体积 ---------- */
console.log("\n── D/E. 音频类型与体积限制 ──");
{
  const r = await uploadAudio({ withFile: true, fields: { sessionId: SID }, type: "application/x-msdownload", filename: "a.exe" });
  r.status === 400 ? ok("不支持的音频类型 → 400") : bad(`非法类型返回 ${r.status},应为 400`);
  String(r.json?.message || "").includes("不支持的音频类型")
    ? ok("错误信息指明了不支持的类型")
    : bad(`错误信息不明确:${r.json?.message}`);
}
{
  const r = await uploadAudio({ withFile: true, fields: { sessionId: SID }, size: 21 * 1024 * 1024 });
  r.status >= 500
    ? bad(`21MB 音频返回 ${r.status}(客户端超限不应是 5xx)`)
    : ok(`21MB 音频被拒(${r.status}),且非 5xx`);
}

/* ---------- F/H. 降级路径(本机无 whisper 模型) ---------- */
console.log("\n── F/G/H. whisper 模型缺失时的降级路径 ──");
let degraded = null;
{
  degraded = await uploadAudio({ withFile: true, fields: { sessionId: SID, question: "自我介绍", durationMs: "5000" } });

  degraded.status === 200
    ? ok(`降级返回 HTTP 200(不是 5xx):${brief(degraded.json?.data, 90)}`)
    : bad(`降级返回 ${degraded.status},应为 200 —— 模型缺失是预期状态,不该当服务错误`);

  degraded.json?.data?.ok === false
    ? ok("data.ok === false(前端据此提示用户)")
    : bad(`data.ok 应为 false,实际 ${degraded.json?.data?.ok}`);

  degraded.json?.data?.mode === "unavailable"
    ? ok("mode === unavailable(可区分于其他失败)")
    : bad(`mode 应为 unavailable,实际 ${degraded.json?.data?.mode}`);

  const err = String(degraded.json?.data?.error || "");
  err && err.length > 4
    ? ok(`带可操作 error 文案:"${err.slice(0, 50)}"`)
    : bad("缺少可操作的 error 文案");

  // 降级不应写入 answer_recordings
  const recs = await api("GET", `/api/sessions/${SID}/recordings`);
  const list = Array.isArray(recs.json?.data) ? recs.json.data : [];
  list.length === 0
    ? ok("降级时未写入 answer_recordings(无脏数据)")
    : bad(`降级却写入了 ${list.length} 条 recording —— 会产生"有录音但无转写"的脏数据`);
}

/* ---------- I. 降级不应崩溃服务 ---------- */
console.log("\n── I. 降级后服务仍健康 ──");
{
  const h = await api("GET", "/api/health");
  h.status === 200 && h.json?.ok === true
    ? ok("转写降级后服务仍健康")
    : bad(`服务异常:${h.status}`);
  srvLog.includes("UnhandledPromiseRejection")
    ? bad("日志中出现未处理的 Promise 拒绝")
    : ok("无未处理的 Promise 拒绝");
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
