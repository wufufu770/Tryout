#!/usr/bin/env node
/*
 * ISSUE-008 端到端回归:全路由冒烟 —— 61 条路由逐个打一遍,不允许 5xx
 *
 * ## 定位
 * 后端有 61 条 /api 路由,此前有 47 条**完全没有任何测试**。
 * 逐条补 happy path 成本很高,但**"任何路由在基础请求下都不该崩"**
 * 这条不变量可以用极低成本守住,而且正好覆盖那 47 条路由的崩溃风险 ——
 * 未测试代码最常见的失败就是未捕获异常 → 500。
 *
 * ## 做法
 * 与 `e2e-auth-routes.mjs` 一样**运行时扫描** `index.js` 与 `routes/*.js`
 * 解析出全部路由(而非硬编码清单),对每条:
 *   1. 用合法 method + 替换过路径参数的 URL 打一次
 *   2. 断言 **不是 5xx**
 *   3. 记录状态码分布,便于人工判断覆盖情况
 *
 * 注意:本测试**不断言业务正确性**,只断言"不崩"。
 * 4xx(参数缺失/未找到/校验失败)都是**预期且正确**的响应。
 *
 * 用法:node scripts/e2e-route-smoke.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// R56:诊断信息安全格式化 —— JSON.stringify(undefined) 不是字符串,`.slice` 会崩
import { brief } from "./lib/brief.mjs";

const PORT = 3481;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-smoke-"));
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

async function waitReady(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/* ---------- 扫描路由表 ---------- */
function scanRoutes() {
  const files = [path.join(SERVER_DIR, "index.js")];
  const routesDir = path.join(SERVER_DIR, "routes");
  if (fs.existsSync(routesDir)) {
    for (const f of fs.readdirSync(routesDir)) if (f.endsWith(".js")) files.push(path.join(routesDir, f));
  }
  const out = [];
  const re = /\b(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*["'`](\/api\/[^"'`]*)["'`]/g;
  for (const file of files) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(re)) {
      out.push({ method: m[1].toUpperCase(), path: m[2], params: (m[2].match(/:\w+/g) || []).length });
    }
  }
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.method} ${r.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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

const routes = scanRoutes();
ok(`服务已启动,扫描到 ${routes.length} 条 /api 路由`);

/** 把路径参数替换成一个必然不存在的 id;multipart 路由走 JSON(会被 4xx,也算预期) */
function samplePath(r) {
  let p = r.path;
  for (let i = 0; i < r.params; i++) p = p.replace(/:\w+/, "smoke-nonexistent-id");
  return p;
}

const results = [];
console.log("\n── 逐条打请求,断言无 5xx ──");
for (const r of routes) {
  const p = samplePath(r);
  let status = 0, err = null;
  try {
    const res = await fetch(`${BASE}${p}`, {
      method: r.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      ...(r.method === "GET" || r.method === "DELETE" ? {} : { body: "{}" }),
    });
    status = res.status;
    await res.text();
  } catch (e) {
    err = e.message;
  }
  results.push({ ...r, p, status, err });
  if (err) bad(`${r.method} ${p} → 请求异常:${err}`);
  else if (status >= 500) bad(`${r.method} ${p} → **${status}**`, "该路由在基础请求下即崩溃,属未测试代码的典型失败");
}

const crashed = results.filter((x) => x.status >= 500 || x.err);
const byStatus = {};
for (const x of results) {
  const k = x.err ? "ERR" : String(x.status);
  byStatus[k] = (byStatus[k] || 0) + 1;
}
ok(`状态码分布:${Object.entries(byStatus).sort().map(([k, v]) => `${k}×${v}`).join(" ")}`);

if (crashed.length === 0) {
  ok(`${results.length} 条路由全部无 5xx(含此前零覆盖的路由)`);
} else {
  bad(`${crashed.length} 条路由返回 5xx 或抛异常:`);
  for (const c of crashed) console.log(`     ${c.method} ${c.p} → ${c.err || c.status}`);
}

/* ---------- 补充:业务正确性的窄检查(挑用户必经的几条) ---------- */
console.log("\n── 业务正确性抽查(不只是不崩)──");
{
  // 1. GET /api/sessions 空列表
  const s = await fetch(`${BASE}/api/sessions`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const sj = await s.json().catch(() => null);
  Array.isArray(sj?.data) ? ok(`GET /api/sessions 返回数组(当前 ${sj.data.length} 条)`) : bad(`GET /api/sessions 返回结构异常:${brief(sj, 120)}`);

  // 2. GET /api/materials 列表
  const m = await fetch(`${BASE}/api/materials`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const mj = await m.json().catch(() => null);
  Array.isArray(mj?.data) ? ok(`GET /api/materials 返回数组(当前 ${mj.data.length} 条)`) : bad(`GET /api/materials 返回结构异常:${brief(mj, 120)}`);

  // 3. 缺必填字段时应 400 而不是 500
  const bad1 = await fetch(`${BASE}/api/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ title: "smoke-no-model" }),   // 缺 modelId
  });
  bad1.status === 400 ? ok("POST /api/sessions 缺必填字段 → 400(校验生效)") : bad(`缺必填字段返回 ${bad1.status},应为 400`);

  // 4. 畸形 JSON 应 400
  const bad2 = await fetch(`${BASE}/api/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: "{not-json",
  });
  bad2.status === 400 ? ok("畸形 JSON → 400") : bad(`畸形 JSON 返回 ${bad2.status},应为 400`);

  // 5. 不存在的资源应 404 而非 500
  const nf = await fetch(`${BASE}/api/sessions/definitely-not-exist`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  nf.status === 404 ? ok("不存在的 session → 404") : bad(`不存在的 session 返回 ${nf.status},应为 404`);
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
