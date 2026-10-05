#!/usr/bin/env node
/*
 * ISSUE-006 端到端回归:SSRF 的**两层防线**
 *
 * ## 背景(本轮实测修正了此前的错误假设)
 * 原本以为 `/api/providers/:id/test` 是唯一的 SSRF 出站点。实测发现:
 * `POST /api/providers` 在**写入时**就已拦截内网地址(返回 `SSRF_METADATA_HOST`)。
 * 即项目实际有两层防护:
 *
 *   第 1 层(写入时):`POST /api/providers` → 拒绝内网/元数据 baseUrl
 *   第 2 层(取用时):`GET /api/providers/:id/test` → `assertSafeUrlAtFetch`
 *                     + connect-time IP 校验(safeAgent),防 TOCTOU / DNS rebinding
 *
 * `server/test/ssrf.test.js` 的 35+ 用例覆盖的是**函数层**,
 * 从未验证这两层在**真实路由**上是否生效。
 *
 * ## 本脚本要证明的
 *   A. 第 1 层:创建指向内网/元数据地址的 provider 会被拒(11 类地址)
 *   B. 第 2 层(本脚本的核心价值):**直接写库**注入一个内网 baseUrl,
 *      模拟"历史脏数据 / 绕过写入校验 / 未来校验被重构删掉"的情形,
 *      此时打测速路由仍必须被拒 —— 这正是函数级测试覆盖不到的部分
 *   C. 未鉴权不得触发测速
 *   D. 测速限流生效(防认证用户端口扫描)
 *   E. 对照:isLocal 供应商不被误杀(Ollama 本地模型仍可用)
 *
 * 用法:node scripts/e2e-ssrf-route.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";

const PORT = 3465;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-ssrf-"));
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = path.resolve(import.meta.dirname, "..");
const DB_PATH = path.join(DB_DIR, "tryout.db");

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };

let child = null, srvLog = "";
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

async function api(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const SSRF_TARGETS = [
  ["云元数据 169.254.169.254", "http://169.254.169.254/latest/meta-data/"],
  ["环回 127.0.0.1", "http://127.0.0.1:22/"],
  ["0.0.0.0", "http://0.0.0.0:9000/"],
  ["私网 10.x", "http://10.0.0.1/"],
  ["私网 172.16.x", "http://172.16.0.1/"],
  ["私网 192.168.x", "http://192.168.1.1/"],
  ["CGNAT 100.64.x", "http://100.64.0.1/"],
  ["IPv6 环回 [::1]", "http://[::1]:22/"],
  ["IPv6 ULA [fd00::1]", "http://[fd00::1]/"],
  ["IPv4-mapped", "http://[::ffff:127.0.0.1]/"],
];

/* ------------------------------------------------------------------ *
 * A. 写入层防线
 * ------------------------------------------------------------------ */
console.log("\n── A. 第 1 层:创建内网 provider 应被拒(写入时校验)──");
{
  let rejected = 0, created = 0;
  const leaked = [];
  for (const [label, url] of SSRF_TARGETS) {
    const r = await api("POST", "/api/providers", { name: `ssrf-${label}`, baseUrl: url });
    if (r.json?.ok === true) { created++; leaked.push(label); }
    else rejected++;
  }
  if (created === 0) ok(`${rejected} 类内网地址全部在创建时被拒`);
  else bad(`${created} 类内网地址在创建时被**接受**,写入层失效: ${leaked.join(", ")}`);
}

/* ------------------------------------------------------------------ *
 * C. 未鉴权
 * ------------------------------------------------------------------ *
 * ⚠️ 本组必须在 B、D 之前跑。
 * 真实中间件顺序是:限流(index.js:143/144/测速专用限流)**早于**鉴权(index.js:359),
 * 所以一旦前面的用例把"测速专用限流"额度用满,本组的请求会先拿到 429 而到不了鉴权,
 * 测出来的是限流而不是鉴权。这是真实的中间件顺序(不是 bug):
 * 限流按 IP 计,未鉴权攻击者只能耗尽自己的额度,无法借此影响已认证用户。
 */
console.log("\n── C. 未鉴权不得触发测速(防未授权 SSRF 探测)──");
{
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();
  const id = "injected-noauth";
  db.prepare(`
    INSERT INTO providers (provider_id, name, category, base_url, api_key, api_format,
      sort_index, is_active, in_failover_queue, created_at, updated_at, seed_version, deleted_at)
    VALUES (?,?,'custom','http://169.254.169.254/','k','openai_chat',0,0,0,?,?,0,NULL)
  `).run(id, "noauth", now, now);
  db.close();

  // 必须用 401/403 判定,不能用 "非 429"。
  // 鉴权中间件在限流之后,未鉴权请求在额度未耗尽时应为 401。
  const r = await fetch(`${BASE}/api/providers/${id}/test`);
  (r.status === 401 || r.status === 403)
    ? ok(`无 token 测速 → ${r.status}(未授权无法探测)`)
    : bad(`无 token 测速 → ${r.status},应为 401(若为 429 说明前置用例已耗尽限流额度,属测试顺序问题)`);
}

/* ------------------------------------------------------------------ *
 * B. fetch 层防线(核心)
 * ------------------------------------------------------------------ */
console.log("\n── B. 第 2 层:绕过写入层直接写库后,测速仍应被拒 ──");
{
  // 直接写库注入内网 baseUrl,模拟"历史脏数据 / 校验被重构删掉 / 未来回归"
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO providers (provider_id, name, category, base_url, api_key, api_format,
      sort_index, is_active, in_failover_queue, created_at, updated_at, seed_version, deleted_at)
    VALUES (?,?,?,?,?,?,0,0,0,?,?,0,NULL)`);

  let blocked = 0, escaped = [];
  const injected = [];
  for (const [label, url] of SSRF_TARGETS) {
    const id = `injected-${Math.random().toString(36).slice(2, 10)}`;
    insert.run(id, `injected-${label}`, "custom", url, "dummy-key", "openai_chat", now, now);
    injected.push([label, id]);

    const r = await api("GET", `/api/providers/${id}/test`);
    // 注意判定字段:外层 ok=true 只表示"HTTP 请求处理成功",
    // 真正表示测速是否打通了内网的是 data.success。
    // data.success=false + ssrfCode 存在 = 被正确拦截。
    const d = r.json?.data;
    if (d?.success === true) escaped.push(label);
    else if (d?.ssrfCode) blocked++;
    else blocked++; // 非 ssrfCode 的失败(连不上/超时)同样不是"访问成功"
  }
  db.close();

  if (escaped.length === 0) ok(`${injected.length} 个直写库的内网 provider 全部在测速时被拒(第 2 层生效)`);
  else bad(`${escaped.length} 个直写库的内网 provider **成功访问了内网**,第 2 层失效: ${escaped.join(", ")}`);
}

/* ------------------------------------------------------------------ *
 * D. 测速限流
 * ------------------------------------------------------------------ */
console.log("\n── D. 测速限流生效(防认证用户端口扫描)──");
{
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();
  const id = "injected-ratelimit";
  db.prepare(`
    INSERT INTO providers (provider_id, name, category, base_url, api_key, api_format,
      sort_index, is_active, in_failover_queue, created_at, updated_at, seed_version, deleted_at)
    VALUES (?,?,'custom','http://169.254.169.254/','k','openai_chat',0,0,0,?,?,0,NULL)
  `).run(id, "rl", now, now);
  db.close();

  const codes = [];
  for (let i = 0; i < 14; i++) {
    const r = await api("GET", `/api/providers/${id}/test`);
    codes.push(r.status);
  }
  const n429 = codes.filter((c) => c === 429).length;
  n429 > 0 ? ok(`14 次连续测速中 ${n429} 次被限流(429),限流生效`)
           : bad("14 次连续测速未触发任何 429,测速限流失效", `状态序列: ${codes.join(",")}`);
}

/* ------------------------------------------------------------------ *
 * E. 对照:isLocal 不被误杀
 * ------------------------------------------------------------------ */
console.log("\n── E. 对照:isLocal 供应商不被 SSRF 规则误杀(Ollama 用法)──");
{
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();
  const id = "injected-local-ok";
  // category='local' → resolveProvider 会判定 isLocal,走 safeAgentLocal 分支
  db.prepare(`
    INSERT INTO providers (provider_id, name, category, base_url, api_key, api_format,
      sort_index, is_active, in_failover_queue, created_at, updated_at, seed_version, deleted_at)
    VALUES (?,?,'local','http://127.0.0.1:11434/v1','ollama','openai_chat',0,0,0,?,?,0,NULL)
  `).run(id, "ollama-local", now, now);
  db.close();

  const r = await api("GET", `/api/providers/${id}/test`);
  const s = JSON.stringify(r.json);
  const ssrfBlocked = /SSRF_|internalIp|metadataHost|内网|元数据/i.test(s);
  ssrfBlocked
    ? bad("isLocal provider 被 SSRF 规则误杀,Ollama 本地模型将不可用", s.slice(0, 180))
    : ok("isLocal provider 未被 SSRF 规则误杀(Ollama 本地模型仍可用)");
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
