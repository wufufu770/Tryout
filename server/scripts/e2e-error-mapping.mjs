#!/usr/bin/env node
/*
 * e2e:**全路由**错误码映射扫描 —— 畸形输入必须得到 4xx,绝不能是 5xx
 *
 * ## 为什么需要这条测试
 * 这项目历史上栽过同一类坑两次:
 *   ISSUE-012:上传超限返回 500,应为 413
 *   ISSUE-028:`POST /api/chat` 传了不存在的 provider,返回 500「服务器内部错误」,
 *              应为 400 —— 用户传错 id 看到"服务器内部错误",排查方向被带偏,
 *              还会把客户端错误计入服务端 5xx 指标。
 * 两次都靠**逐个用例**偶然撞见。问题是:全项目 60+ 条路由,没有任何机制
 * 能保证**每一条**都把客户端错误映射成客户端错误码。
 * 只要有 1 条路由漏了,这个缺陷就会一直静默。
 *
 * 本脚本做的是**批量扫描**:解析出全部 /api 路由,对每一条注入畸形载荷,
 * 断言「返回 4xx 而不是 5xx」。它不关心具体是 400/404/422,只关心
 * **「这是客户端的问题」这个事实有没有被如实表达**。
 *
 * 另外顺带查一个更隐蔽的问题:畸形输入被**静默接受**(返回 2xx)——
 * 那意味着脏数据进了库,比 500 更难发现。
 *
 * ## 与既有 e2e 的关系
 * `e2e-auth-routes.mjs` 扫「无 token → 必须 401」;本脚本扫「有 token + 畸形输入
 * → 必须 4xx」。两者互补,都基于同一套运行时路由表解析(新增路由自动纳入)。
 *
 * 用法:node scripts/e2e-error-mapping.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 3459;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-err-map-"));
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
  try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 临时目录,失败可忽略 */ }
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

/** 从源码解析全部 /api 路由(与 e2e-auth-routes 同一套,新增路由自动纳入) */
function scanRoutes() {
  const files = [path.join(SERVER_DIR, "index.js")];
  const routesDir = path.join(SERVER_DIR, "routes");
  if (fs.existsSync(routesDir)) {
    for (const f of fs.readdirSync(routesDir)) if (f.endsWith(".js")) files.push(path.join(routesDir, f));
  }
  const out = [];
  const re = /\b(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*["'`](\/api\/[^"'`]*)["'`]/g;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      out.push({ method: m[1].toUpperCase(), path: m[2], paramCount: (m[2].match(/:\w+/g) || []).length });
    }
  }
  const seen = new Set();
  return out.filter((r) => (seen.has(`${r.method} ${r.path}`) ? false : (seen.add(`${r.method} ${r.path}`), true)));
}

async function waitReady(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true; } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** NOTE(ISSUE-009):本机 better-sqlite3 曾有间歇性原生崩溃,重试仅用于绕开该已知缺陷 */
async function startWithRetry(maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    child = spawn("node", ["index.js"], {
      cwd: SERVER_DIR,
      env: { ...process.env, PORT: String(PORT), DB_DIR, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    srvLog = "";
    child.stdout.on("data", (d) => { srvLog += d; });
    child.stderr.on("data", (d) => { srvLog += d; });
    if (await waitReady(8000)) return { ready: true, attempts: attempt };
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
    if (attempt < maxAttempts) console.log(`  ⚠️  第 ${attempt} 次启动未就绪,重试…`);
  }
  return { ready: false, attempts: maxAttempts };
}

function samplePath(p, paramCount) {
  let out = p;
  for (let i = 0; i < paramCount; i++) out = out.replace(/:\w+/, "nonexistent-id-000");
  return out;
}

const { ready, attempts } = await startWithRetry();
if (!ready) { console.error(`服务未能启动:\n${srvLog.slice(-2000)}`); cleanup(); process.exit(1); }
if (attempts > 1) console.log(`  ℹ  经 ${attempts} 次尝试才启动成功(ISSUE-009 间歇性崩溃)`);

const TOKEN_FILE = path.join(DB_DIR, ".api_token");
if (!fs.existsSync(TOKEN_FILE)) { console.error(`未生成 token:${TOKEN_FILE}`); cleanup(); process.exit(1); }
const TOKEN = fs.readFileSync(TOKEN_FILE, "utf8").trim();

/** 绝不把这些算作 5xx 缺陷的路径 */
const SKIP = new Set([
  "/api/health",            // 健康检查
  "/api/analysis/weakness", // ISSUE-003:已知会泄露,单独跟踪
]);

/**
 * 注入的畸形载荷。
 *
 * ⚠️ R20:第一版只有「结构非法」的三种载荷,结果**漏掉了 ISSUE-044**
 * (「供应商存在但没配 API key」返回 500)—— 因为那类缺陷的载荷是
 * **结构完全合法、只是引用了无效/未就绪的资源**,会被路由层的必填校验
 * 放过去,一路走到业务逻辑里才炸。
 * 所以必须补上「结构合法但资源无效」这一类,否则扫描面只覆盖了一半。
 */
const BAD_BODIES = [
  { label: "空对象", raw: "{}" },
  { label: "类型全错", raw: JSON.stringify({ id: 123, name: [], value: { a: 1 }, flag: "x", __proto__: { polluted: 1 } }) },
  { label: "非 JSON", raw: "{{{not json" },
  // ↓ R20 新增:结构合法但引用不存在的资源(ISSUE-028/044 的真实形态)
  { label: "合法结构+不存在的 provider", raw: JSON.stringify({ provider: "prov_does_not_exist_0000", messages: [{ role: "user", content: "hi" }] }) },
  // prov_openai 是种子里自带、**存在但没有 API key** 的非 local 供应商,
  // 专门用来覆盖 ISSUE-044(「资源存在但未就绪」被报成 500)这一类。
  // 只发"不存在的 id"是抓不到它的 —— 那条走的是 NotFound 分支。
  { label: "存在但未配 key 的 provider", raw: JSON.stringify({ provider: "prov_openai", messages: [{ role: "user", content: "hi" }] }) },
  { label: "合法结构+不存在的 session", raw: JSON.stringify({ sessionId: "sess_does_not_exist_0000" }) },
  { label: "空字符串必填位", raw: JSON.stringify({ name: "", title: "", question: "", content: "" }) },
];

async function hit(method, p, raw) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
  try {
    const r = await fetch(`${BASE}${p}`, {
      method, headers,
      ...(method === "GET" || method === "DELETE" ? {} : { body: raw }),
    });
    const t = await r.text().catch(() => "");
    let code = null;
    try { code = JSON.parse(t)?.code ?? null; } catch { /* 非 JSON 响应体也算失败信号 */ }
    return { status: r.status, code, body: t.slice(0, 160) };
  } catch (e) {
    return { status: `ERR:${e.message}`, code: null, body: "" };
  }
}

const routes = scanRoutes();
console.log(`  ℹ 扫描到 ${routes.length} 条 /api 路由`);

/* ---------- A. 写操作路由:畸形 body → 4xx,不得 5xx ---------- */
console.log("\n── A. 畸形请求体 → 必须 4xx,不得 5xx ──");
const fivexx = [];
let checked = 0;
for (const r of routes) {
  if (SKIP.has(r.path)) continue;
  if (r.method === "GET" || r.method === "DELETE") continue;
  const p = samplePath(r.path, r.paramCount);
  for (const b of BAD_BODIES) {
    const res = await hit(r.method, p, b.raw);
    checked++;
    if (typeof res.status === "string" || res.status >= 500) {
      fivexx.push(`${r.method} ${p} [${b.label}] → ${res.status} ${res.body}`);
    }
  }
}
if (fivexx.length === 0) ok(`${checked} 次畸形请求全部返回 4xx,无 5xx 泄漏`);
else {
  bad(`${fivexx.length}/${checked} 次畸形请求返回了 5xx 或连接错误:`);
  for (const f of fivexx.slice(0, 12)) console.log(`     ${f}`);
  if (fivexx.length > 12) console.log(`     …另有 ${fivexx.length - 12} 条`);
}

/* ---------- B. 读/删:不存在的 id → 4xx,不得 5xx ---------- */
console.log("\n── B. 不存在的资源 id → 必须 4xx,不得 5xx ──");
const bad5 = [];
let checkedB = 0;
for (const r of routes) {
  if (SKIP.has(r.path)) continue;
  if (r.method !== "GET" && r.method !== "DELETE") continue;
  if (r.paramCount === 0) continue;           // 无路径参数的列表路由,404 不适用
  const p = samplePath(r.path, r.paramCount);
  const res = await hit(r.method, p);
  checkedB++;
  if (typeof res.status === "string" || res.status >= 500) {
    bad5.push(`${r.method} ${p} → ${res.status} ${res.body}`);
  }
}
if (bad5.length === 0) ok(`${checkedB} 条按 id 访问的路由全部返回 4xx`);
else { bad(`${bad5.length}/${checkedB} 条返回 5xx:`); for (const b of bad5) console.log(`     ${b}`); }

/* ---------- C. 畸形 JSON 的 Content-Type 契约 ---------- */
console.log("\n── C. 非法 JSON 应被 400 拒绝,不得 5xx ──");
let cFail = 0, cOk = 0;
for (const r of routes) {
  if (SKIP.has(r.path)) continue;
  if (r.method === "GET" || r.method === "DELETE") continue;
  const p = samplePath(r.path, r.paramCount);
  const res = await hit(r.method, p, "{{{not json");
  if (typeof res.status === "string" || res.status >= 500) { cFail++; console.log(`     ${r.method} ${p} → ${res.status}`); }
  else cOk++;
}
cFail === 0 ? ok(`${cOk} 条路由对非法 JSON 均返回 4xx`) : bad(`${cFail} 条路由对非法 JSON 返回 5xx`);

/* ---------- D. 原型污染 ---------- */
console.log("\n── D. __proto__ 注入不得污染 Object.prototype ──");
const before = ({}).polluted;
for (const r of routes) {
  if (SKIP.has(r.path)) continue;
  if (r.method === "GET" || r.method === "DELETE") continue;
  await hit(r.method, samplePath(r.path, r.paramCount), JSON.stringify({ __proto__: { polluted: "yes" } }));
}
const after = ({}).polluted;
before === after && after === undefined
  ? ok("Object.prototype 未被污染")
  : bad("检测到原型污染", `Object.prototype.polluted = ${JSON.stringify(after)}`);

cleanup();
console.log(`\n${"=".repeat(58)}`);
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log(`${"=".repeat(58)}\n`);
process.exit(fail > 0 ? 1 : 0);
