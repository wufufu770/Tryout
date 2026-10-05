#!/usr/bin/env node
/*
 * ISSUE-008 端到端回归:上传路由的 multipart 与安全边界
 *
 * 覆盖此前**完全无测试**的三条上传路径及其防护:
 *   A. `/api/materials/upload` —— 简历/资料上传(multer,20MB,mime 白名单)
 *   B. `/api/agents/:id/icon`   —— 头像上传(multer,200KB,mime 白名单 + magic bytes 校验)
 *   C. 异常输入:无文件、类型不支持、超体积、伪装类型、解析结果过短
 *
 * 特别关注 `index.js:212` 的 `validateImageMagic`:
 * 它专门防"伪造 Content-Type 为 image/png 上传 HTML/JS → 经图标 URL 执行 XSS"。
 * 这个防护此前**没有任何测试**,属于典型的"安全控制存在但无回归保护"。
 *
 * 用法:node scripts/e2e-upload.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// R56:诊断信息安全格式化 —— JSON.stringify(undefined) 不是字符串,`.slice` 会崩
import { brief } from "./lib/brief.mjs";

const PORT = 3472;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-upload-"));
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

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

child = spawn("node", ["index.js"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), DB_DIR, NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => { srvLog += d; });
child.stderr.on("data", (d) => { srvLog += d; });

const ready = await waitReady();
if (!ready) { console.error("服务未就绪:\n" + srvLog.slice(-1500)); cleanup(); process.exit(1); }

const TOKEN = fs.readFileSync(path.join(DB_DIR, ".api_token"), "utf8").trim();

/** 用 FormData 发 multipart;fields 用于附带普通字段 */
async function upload(p, { field = "file", filename, contentType, body, fields = {} } = {}) {
  const fd = new FormData();
  if (body !== undefined) {
    fd.append(field, new Blob([body], { type: contentType || "application/octet-stream" }), filename || "f.bin");
  }
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(`${BASE}${p}`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: fd });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text };
}

async function api(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const LONG_TEXT = "这是一份用于测试的简历内容。".repeat(20); // 远超 10 字符下限

/* ================================================================== *
 * A. 资料上传:正常路径与类型白名单
 * ================================================================== */
console.log("\n── A. /api/materials/upload 类型白名单与解析 ──");
{
  // A1 正常 txt
  const r = await upload("/api/materials/upload", {
    filename: "resume.txt", contentType: "text/plain", body: LONG_TEXT, fields: { type: "resume" },
  });
  r.status === 200 && r.json?.data?.rawText
    ? ok(`text/plain 上传成功,解析出 ${r.json.data.rawText.length} 字符`)
    : bad(`text/plain 上传失败(${r.status})`, r.text.slice(0, 160));

  // A2 markdown
  const r2 = await upload("/api/materials/upload", {
    filename: "notes.md", contentType: "text/markdown", body: LONG_TEXT,
  });
  r2.status === 200 ? ok("text/markdown 上传成功") : bad(`text/markdown 上传失败(${r2.status})`, r2.text.slice(0, 160));

  // A3 不支持的 mime —— 应被 fileFilter 拒
  const r3 = await upload("/api/materials/upload", {
    filename: "evil.exe", contentType: "application/x-msdownload", body: "MZ\u0000\u0000",
  });
  (r3.status === 400 || r3.status === 415)
    ? ok(`不支持的类型被拒(${r3.status}):${(r3.json?.message || "").slice(0, 50)}`)
    : bad(`不支持的类型未被拒,返回 ${r3.status}`, r3.text.slice(0, 160));

  // A4 伪装:声明 text/plain 但内容是二进制 —— 允许(按扩展名走 else 分支),但内容过短应被拒
  const r4 = await upload("/api/materials/upload", {
    filename: "short.txt", contentType: "text/plain", body: "ab",
  });
  r4.status === 400
    ? ok("内容过短(<10 字符)被拒,并给出可操作提示")
    : bad(`过短内容未被拒,返回 ${r4.status}`, r4.text.slice(0, 160));

  // A5 无文件
  const r5 = await upload("/api/materials/upload", { fields: { type: "resume" } });
  r5.status === 400 ? ok("无文件时被拒(400)") : bad(`无文件时返回 ${r5.status},应为 400`);
}

/* ================================================================== *
 * B. 图标上传:mime 白名单 + magic bytes 防伪造(核心安全点)
 * ================================================================== */
console.log("\n── B. /api/agents/:id/icon mime 白名单与 magic bytes 防伪造 ──");
{
  // AgentSchema 必填:name / role(枚举) / promptTemplate
  const a = await api("POST", "/api/agents", {
    name: "icon-probe",
    role: "custom",
    promptTemplate: "你是一名技术面试官。",
  });
  const aid = a.json?.data?.agentId;
  if (!aid) {
    bad("无法创建用于测试的 agent", brief(a.json, 160));
  } else {
    // B1 正常 PNG(magic bytes 正确)
    //    PNG 签名:89 50 4E 47 0D 0A 1A 0A
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pngBody = Buffer.concat([pngHeader, Buffer.alloc(2048, 0x41)]);
    const r1 = await upload(`/api/agents/${aid}/icon`, {
      filename: "a.png", contentType: "image/png", body: pngBody,
    });
    r1.status === 200 ? ok("合法 PNG 上传成功") : bad(`合法 PNG 上传失败(${r1.status})`, r1.text.slice(0, 160));

    // B2 ⭐ 核心:伪造 Content-Type 为 image/png,内容是 HTML/JS
    const xss = Buffer.from(
      '<html><script>alert(document.cookie)</script></html>' + " ".repeat(64),
    );
    const r2 = await upload(`/api/agents/${aid}/icon`, {
      filename: "x.png", contentType: "image/png", body: xss,
    });
    const isBlocked = r2.status >= 400 || /magic|伪造|不支持|invalid|格式/i.test(r2.text);
    isBlocked
      ? ok(`**伪造 image/png 上传 HTML/JS 被拒**(${r2.status})—— XSS 防护有效`)
      : bad("**伪造 image/png 的 HTML/JS 竟被接受**,存在存储型 XSS", r2.text.slice(0, 200));

    // B3 伪装成 jpg 的 HTML
    const r3 = await upload(`/api/agents/${aid}/icon`, {
      filename: "x.jpg", contentType: "image/jpeg", body: xss,
    });
    r3.status >= 400 || /magic|伪造|格式/i.test(r3.text)
      ? ok(`伪造 image/jpeg 的 HTML 被拒(${r3.status})`)
      : bad("伪造 image/jpeg 的 HTML 竟被接受", r3.text.slice(0, 200));

    // B4 不在白名单的 mime
    const r4 = await upload(`/api/agents/${aid}/icon`, {
      filename: "x.svg", contentType: "image/svg+xml", body: xss,
    });
    r4.status >= 400
      ? ok(`SVG(可内联脚本)被拒(${r4.status})—— 正确的白名单策略`)
      : bad("SVG 被接受,存在 XSS 面", r4.text.slice(0, 200));

    // B5 体积限制 200KB
    // ⚠️ 断言收紧为「必须是 4xx」:原先写的 `status >= 400` 会把 500 也算通过,
    // 正是它让 ISSUE-012(超限返回 500)溜过。客户端上传错误绝不应是 5xx。
    const big = Buffer.concat([pngHeader, Buffer.alloc(300 * 1024, 0x41)]);
    const r5 = await upload(`/api/agents/${aid}/icon`, {
      filename: "big.png", contentType: "image/png", body: big,
    });
    r5.status >= 500
      ? bad(`300KB 图标返回 ${r5.status}(5xx):客户端体积超限不应是服务端错误,见 ISSUE-012`)
      : r5.status >= 400
        ? ok(`超过 200KB 的图标被拒(${r5.status},非 5xx)${r5.json?.multerCode ? ` [${r5.json.multerCode}]` : ""}`)
        : bad(`300KB 图标未被拒(${r5.status}),体积限制失效`);

    // B6 读回图标,确认拿到的是图片而非 HTML
    const back = await fetch(`${BASE}/api/agents/${aid}/icon`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const backBuf = Buffer.from(await back.arrayBuffer());
    const looksLikePng = backBuf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const containsScript = backBuf.toString("latin1").toLowerCase().includes("<script");
    !containsScript
      ? ok("读回的图标内容不含 <script>(无持久化 XSS)")
      : bad("**读回的图标里含 <script>**,XSS 已持久化");
    ok(`读回图标 ${back.status},PNG 签名有效=${looksLikePng}`);
  }
}

/* ================================================================== *
 * C. 限流下的稳定性:上传限流 10/分钟 已在 R3 覆盖,此处只验异常不 500
 * ================================================================== */
console.log("\n── C. 异常输入不得导致 500 ──");
{
  const cases = [
    ["空文件", { filename: "e.txt", contentType: "text/plain", body: "" }],
    ["仅换行", { filename: "e.txt", contentType: "text/plain", body: "\n\n\n" }],
    ["超长单行(2MB)", { filename: "e.txt", contentType: "text/plain", body: "x".repeat(2 * 1024 * 1024) }],
    ["伪装 PDF(非 PDF 内容)", { filename: "e.pdf", contentType: "application/pdf", body: LONG_TEXT }],
    ["损坏的 PDF 头", { filename: "e.pdf", contentType: "application/pdf", body: Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x01]) }],
  ];
  for (const [label, opt] of cases) {
    const r = await upload("/api/materials/upload", opt);
    r.status >= 500
      ? bad(`${label} → ${r.status}(服务抛 500)`)
      : ok(`${label} → ${r.status}(被安全拒绝或接受,未 500)`);
  }
  const h = await api("GET", "/api/health");
  h.status === 200 ? ok("异常输入后服务仍健康") : bad("异常输入后服务不健康");
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
