#!/usr/bin/env node
/*
 * ISSUE-004 端到端回归:路由级鉴权断言(自动扫描路由表)
 *
 * ## 为什么需要这条测试
 * `server/test/auth.test.js` 只测 `authMiddleware` 函数本身,
 * **没有任何测试断言「真实路由在无 token 时返回 401」**。
 * 这意味着:一旦 `auth.js` 的豁免白名单被无意扩大,不会有任何测试变红。
 * 安全控制的失效是**静默**的。
 *
 * 这不是理论风险:ISSUE-003b 实测发现,豁免白名单 7 条里已有 5 条因路由改名而变成死条目,
 * 而整个项目**没有任何测试察觉**。
 *
 * ## 关键设计:路由表自动扫描
 * 这里的断言清单不是硬编码的,而是**运行时解析 `index.js` 与 `routes/*.js` 里
 * 所有 `app.<method>("/api/...")` 注册语句**得到的。
 * 因此:
 *   - 新增路由会被自动纳入鉴权断言,无需手工维护
 *   - 路由改名后旧路径若仍在白名单里,也会被暴露
 *
 * ## 鉴权必须开启
 * 现有 E2E 脚本都带 `INTERVIEWX_AUTH_DISABLED=1` 绕过鉴权。本脚本**故意不设**它,
 * 否则测的就是「没有鉴权」而非「鉴权正确工作」。
 *
 * 用法:node scripts/e2e-auth-routes.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 3457;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-auth-routes-"));
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = path.resolve(import.meta.dirname, "..");

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };

let child = null;
let srvLog = "";
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { child?.kill("SIGKILL"); } catch { /* 已退出 */ }
  try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 已删 */ }
}
process.on("exit", cleanup);
process.on("uncaughtException", (e) => { console.error("[未捕获]", e?.message); cleanup(); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("[未处理拒绝]", e?.message); cleanup(); process.exit(1); });

/* ---------- 1. 扫描路由表 ---------- */

/** 从源码里解析出所有 /api 路由注册:返回 [{ method, path, paramCount }] */
function scanRoutes() {
  const files = [path.join(SERVER_DIR, "index.js")];
  const routesDir = path.join(SERVER_DIR, "routes");
  if (fs.existsSync(routesDir)) {
    for (const f of fs.readdirSync(routesDir)) {
      if (f.endsWith(".js")) files.push(path.join(routesDir, f));
    }
  }
  const out = [];
  // app.get/post/put/delete("/api/...") 以及 router.get(...) 等
  const re = /\b(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*["'`](\/api\/[^"'`]*)["'`]/g;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      out.push({
        method: m[1].toUpperCase(),
        path: m[2],
        // :param 数量,用于构造一个必然不存在的 id
        paramCount: (m[2].match(/:\w+/g) || []).length,
      });
    }
  }
  // 去重
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.method} ${r.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------- 2. 启服务(鉴权必须开启) ---------- */

/**
 * 启动服务并等待就绪。
 * NOTE(ISSUE-009):本机 Node 24 + better-sqlite3 11.10.0 存在**间歇性原生崩溃**
 * (约 1/3~1/2 概率,服务在迁移完成后 SIGABRT)。该缺陷与鉴权无关,
 * 属依赖层问题,已单独跟踪。此处做有限次重试,**仅用于绕开该已知缺陷**,
 * 并在重试时打印明确提示 —— 绝不掩盖鉴权断言本身的失败。
 */
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
    const crashed = srvLog.includes("Assertion failed");
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
    if (attempt < maxAttempts) {
      console.log(`  ⚠️  第 ${attempt} 次启动${crashed ? "命中已知缺陷 ISSUE-009(native abort)" : "未就绪"},重试…`);
    }
  }
  return { ready: false, attempts: maxAttempts };
}

const { ready, attempts } = await startWithRetry();
if (!ready) {
  console.error(`服务在重试 ${attempts} 次后仍未能启动:\n` + srvLog.slice(-2000));
  cleanup();
  process.exit(1);
}
if (attempts > 1) {
  console.log(`  ℹ  经 ${attempts} 次尝试才启动成功(命中 ISSUE-009 间歇性崩溃,见 qa/ISSUES.md)`);
}

async function waitReady(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function samplePath(p, paramCount) {
  // 用一个必然不存在的 id 替换所有路径参数
  let out = p;
  for (let i = 0; i < paramCount; i++) out = out.replace(/:\w+/, "nonexistent-id-000");
  return out;
}

async function hit(method, p, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const r = await fetch(`${BASE}${p}`, {
      method,
      headers,
      ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
    });
    return r.status;
  } catch (e) {
    return `ERR:${e.message}`;
  }
}

/* ---------- 3. 跑断言 ---------- */

const TOKEN_FILE = path.join(DB_DIR, ".api_token");
if (!fs.existsSync(TOKEN_FILE)) {
  console.error(`未生成 token 文件:${TOKEN_FILE}\n` + srvLog.slice(-2000));
  cleanup();
  process.exit(1);
}
const VALID_TOKEN = fs.readFileSync(TOKEN_FILE, "utf8").trim();
ok(`服务已启动,token 已生成(${VALID_TOKEN.length} 字符)`);

const routes = scanRoutes();
console.log(`  ℹ 扫描到 ${routes.length} 条 /api 路由`);

/**
 * 已知 GET 免认证路径(与 auth.js 的 GET_EXEMPT_EXACT_PATHS 对应)。
 * ISSUE-003b 清理死条目后只剩 2 条。新增豁免必须同时更新这里,
 * 否则本测试会失败 —— 这正是我们想要的"扩大白名单必须被察觉"。
 */
const GET_EXEMPT = new Set([
  "/api/evaluations",        // 仅注册 POST,GET 豁免当前不生效
  "/api/analysis/weakness",  // ISSUE-003:实际会泄露 recentScores[].sessionId,待产品决策
]);
/** 完全豁免(健康检查) */
const FULL_EXEMPT = new Set(["/api/health"]);

console.log("\n── A. 无 token 访问受保护路由 → 必须 401 ──");
let aPass = 0, aFail = 0;
const offenders = [];
for (const r of routes) {
  const p = samplePath(r.path, r.paramCount);
  if (FULL_EXEMPT.has(r.path)) continue;
  if (r.method === "GET" && GET_EXEMPT.has(r.path)) continue;
  const st = await hit(r.method, p, null);
  if (st === 401) aPass++;
  else { aFail++; offenders.push(`${r.method} ${r.path} → ${st}`); }
}
if (aFail === 0) ok(`${aPass} 条受保护路由全部正确返回 401`);
else {
  bad(`${aFail} 条路由在无 token 时未返回 401:`);
  for (const o of offenders) console.log(`     ${o}`);
}

console.log("\n── B. 错误 token → 必须 401 ──");
const wrongToken = "definitely-not-the-right-token-0000";
let bFail = 0, checked = 0;
for (const r of routes) {
  const p = samplePath(r.path, r.paramCount);
  if (FULL_EXEMPT.has(r.path)) continue;
  if (r.method === "GET" && GET_EXEMPT.has(r.path)) continue;
  // 只抽查 20 条,避免测试本身过长
  if (checked++ >= 20) break;
  const st = await hit(r.method, p, wrongToken);
  if (st !== 401) { bFail++; bad(`${r.method} ${r.path} 用了错误 token 却返回 ${st}`); }
}
if (bFail === 0) ok("抽查 20 条路由,错误 token 均被拒 401");

console.log("\n── C. 有效 token → 不得是 401/403 ──");
let cFail = 0, cChecked = 0;
for (const r of routes) {
  if (r.method !== "GET") continue;
  const p = samplePath(r.path, r.paramCount);
  if (cChecked++ >= 20) break;
  const st = await hit(r.method, p, VALID_TOKEN);
  if (st === 401 || st === 403) { cFail++; bad(`GET ${r.path} 带有效 token 却被拒 ${st}`); }
}
if (cFail === 0) ok("抽查 20 条 GET 路由,有效 token 均未被拒");

console.log("\n── D. 健康检查豁免边界 ──");
{
  const st = await hit("GET", "/api/health", null);
  st === 200 ? ok("GET /api/health 无 token → 200(豁免正确)") : bad(`/api/health 无 token 返回 ${st},应为 200`);
}
{
  // verbose 模式泄露 host/port/tokenBudget,必须要求认证
  const st = await hit("GET", "/api/health?verbose=1", null);
  st === 401 ? ok("GET /api/health?verbose=1 无 token → 401(verbose 受保护)") : bad(`/api/health?verbose=1 无 token 返回 ${st},应为 401(会泄露 host/port/tokenBudget)`);
}

console.log("\n── E. 豁免白名单健康度(ISSUE-003b)──");
{
  // 白名单里的每条都应对应真实路由,否则是死条目(改名后未同步)
  const realPaths = new Set(routes.map((r) => r.path));
  const dead = [...GET_EXEMPT].filter((p) => !realPaths.has(p));
  const fullDead = [...FULL_EXEMPT].filter((p) => !realPaths.has(p));
  if (dead.length === 0 && fullDead.length === 0) {
    ok("豁免白名单中无死条目");
  } else {
    // 这不是断言失败,而是一条体检报告:死条目说明白名单已失维护
    bad(`豁免白名单存在 ${dead.length} 条死条目(路由改名后未同步,见 ISSUE-003b):`);
    for (const d of dead) console.log(`     ${d}  —— 当前无对应路由,豁免形同虚设`);
    for (const d of fullDead) console.log(`     ${d}  —— 当前无对应路由`);
  }
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
