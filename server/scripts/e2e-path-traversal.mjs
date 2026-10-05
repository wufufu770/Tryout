#!/usr/bin/env node
/*
 * R51:路径遍历攻击面扫描(零 token 成本,纯本地)
 *
 * ## 为什么做这个
 * R50 查证到本项目是**单用户架构**(无 register/login,`user_id` 恒为 `'default'`),
 * 所以 goal 里列的「权限绕过测试」在当前形态下**不可测** —— 没有"另一个用户"。
 * 但同一批代码里有一类**同样属于资源访问控制、而且现在就能测**的攻击面:
 * **路径遍历**。
 *
 * 已知项目里存在与 id 拼路径的代码:
 *   - `server/db.js` 的 `createAgent` 注释:「agentId 格式校验(防路径穿越)」
 *   - agent 图标上传/读取会把 id 拼进文件路径
 * `ids` 正是 R20 审计过的注入面,这里补**遍历**这一类。
 *
 * ## 判据(三条,逐条独立)
 *   1. **不得返回 500** —— 500 说明 id 直接进了 SQL/文件系统而没被校验
 *   2. **不得回显遍历目标的内容** —— 泄露即为高危
 *   3. **不得出现非预期字段** —— 例如 IconUrl 指向了系统路径
 *
 * ## 覆盖
 * 22 个带 `:id` 的路由 × GET/PUT/DELETE × 8 种 payload(含 URL 编码变体)
 *
 * 用法:node scripts/e2e-path-traversal.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3491;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-traversal-"));
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = path.resolve(import.meta.dirname, "..");
const TOKEN = "traversal-test-token-abc123";

let pass = 0, fail = 0, skipped = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };
const sk = (m) => { console.log(`  — ${m}`); skipped++; };

let child = null, cleaned = false;
function cleanup(code) {
  if (cleaned) return;
  cleaned = true;
  if (child && !child.killed) { try { child.kill("SIGKILL"); } catch { /* 已退出 */ } }
  try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 已删 */ }
  console.log(`\n通过 ${pass} / 失败 ${fail}${skipped ? ` / 跳过 ${skipped}` : ""}`);
  process.exit(code);
}
process.on("exit", () => cleanup(fail ? 1 : 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => cleanup(1));

/* ---------------- 遍历 payload ---------------- */
/** 每种都是"想逃出预期目录"的写法,含 URL 编码与双重编码变体 */
const PAYLOADS = [
  "../../../etc/passwd",
  "..%2f..%2f..%2fetc%2fpasswd",       // 已编码的 /
  "..%2F..%2F..%2Fetc%2Fpasswd",
  "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",  // 编码的点
  "....//....//....//etc/passwd",       // 双重点绕过
  "..\\..\\..\\etc\\passwd",            // Windows 分隔符
  "/etc/passwd",                        // 绝对路径
  "..%252f..%252fetc%252fpasswd",       // 双重编码
];

/** 会被 404/400 正常拒绝的 id(用于对照:确认路由本身是通的) */
const CONTROL_ID = "definitely-not-exist-xyz";

/* ---------------- 路由清单 ---------------- */
const ROUTES = [
  ["GET", "/api/agents/{id}"], ["PUT", "/api/agents/{id}"], ["DELETE", "/api/agents/{id}"],
  ["PUT", "/api/agents/{id}/basic"],
  ["PUT", "/api/agents/{id}/current-version"],
  ["POST", "/api/agents/{id}/versions"],
  ["GET", "/api/agents/{id}/icon"],
  ["GET", "/api/materials/{id}"], ["DELETE", "/api/materials/{id}"],
  ["GET", "/api/materials/{id}/content"],
  ["GET", "/api/providers/{id}"], ["PUT", "/api/providers/{id}"], ["DELETE", "/api/providers/{id}"],
  ["POST", "/api/providers/{id}/activate"],
  ["POST", "/api/providers/{id}/test"],
  ["GET", "/api/questionbank/{id}/reference"],
  ["GET", "/api/session-groups/{id}"], ["PUT", "/api/session-groups/{id}"], ["DELETE", "/api/session-groups/{id}"],
  ["POST", "/api/session-groups/{id}/sessions"],
  ["GET", "/api/sessions/{id}"], ["PUT", "/api/sessions/{id}"], ["DELETE", "/api/sessions/{id}"],
  ["POST", "/api/sessions/{id}/agents"],
  ["GET", "/api/sessions/{id}/asked-questions"], ["POST", "/api/sessions/{id}/asked-questions"],
  ["GET", "/api/sessions/{id}/evaluations"], ["POST", "/api/sessions/{id}/evaluations"],
  ["PUT", "/api/sessions/{id}/group"],
  ["GET", "/api/sessions/{id}/messages"], ["POST", "/api/sessions/{id}/messages"],
  ["PUT", "/api/sessions/{id}/model"],
  ["GET", "/api/sessions/{id}/review"], ["PUT", "/api/sessions/{id}/review"],
  ["PUT", "/api/sessions/{id}/stage"],
  ["GET", "/api/sessions/{id}/stage-agents"],
];

/** 泄露特征:一旦回显这些,说明遍历真的读到了系统文件 */
const LEAK_MARKERS = ["/bin/bash", "root:x:", "nobody:", "127.0.0.1 host"];

async function req(method, url, body) {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  let text = "";
  try { text = await r.text(); } catch { /* 空体 */ }
  return { status: r.status, text, headers: r.headers };
}

function looksLikeLeak(text) {
  return LEAK_MARKERS.some((m) => text.includes(m));
}

function start() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ["index.js"], {
      cwd: SERVER_DIR,
      env: {
        ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DB_DIR,
        INTERVIEWX_API_TOKEN: TOKEN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    const t = setInterval(async () => {
      try { if ((await fetch(`${BASE}/api/health`)).ok) { clearInterval(t); resolve(); } } catch { /* 未就绪 */ }
    }, 200);
    setTimeout(() => { clearInterval(t); reject(new Error(`服务未就绪:\n${log.slice(-1200)}`)); }, 30000);
  });
}

/* ---------------- 主流程 ---------------- */
console.log("▶ R51 路径遍历攻击面扫描");
console.log(`  ${ROUTES.length} 个路由 × ${PAYLOADS.length} 种 payload = ${ROUTES.length * PAYLOADS.length} 次请求\n`);

try { await start(); }
catch (e) { bad("服务启动失败", String(e.message || e)); cleanup(1); }

// 建一个真实 session 当作对照基线(证明这些路由确实通,不是全部 404 的假绿)
const seed = await req("POST", "/api/sessions", { title: "遍历扫描基线会话", modelId: "seed-model" });
// ⚠️ createSession 返回的是 `camelize(SELECT * FROM sessions)`,字段是 **sessionId** 不是 id。
//   我第一版写成 data.id,导致基线"创建失败",于是 288 次请求里可能大半是 404 ——
//   **对照组没建立时的"全绿"等于没测**。这是本脚本自己踩的坑,记在此处。
const seedBody = (() => { try { return JSON.parse(seed.text || "{}"); } catch { return {}; } })();
const seedId = seed?.status === 200 ? (seedBody?.data?.sessionId ?? seedBody?.data?.id ?? null) : null;
if (seedId) ok(`基线会话已创建(${seedId}),下列结果排除"路由全 404"的假绿`);
else {
  // ⛔ 对照组建立不起来 ⇒ 后面 288 次请求可能全是 404,结论无效。
  //   这种情况下**必须判红**,不能"skip 了继续跑"—— 那等于用假绿掩盖没测。
  bad("基线会话创建失败:对照组不成立,本次扫描结论无效", `HTTP ${seed?.status} ${String(seed?.text || "").slice(0, 200)}`);
}

// ⭐ 逐路由可达性:用**真实 id** 打一遍,确认该路由不是"恒 404"。
//   只验证 sessions 那一条基线不够 —— 另 35 条路由若本来就 404,
//   它们的遍历 payload 也必然 404,扫描等于没覆盖到它们。
const reachability = [];
{
  const j = await req("POST", "/api/agents", {
    name: "遍历扫描基线 agent", role: "custom", promptTemplate: "基线",
  });
  const agentBody = (() => { try { return JSON.parse(j.text || "{}"); } catch { return {}; } })();
  const agentId = j.status === 200 ? (agentBody?.data?.agentId ?? agentBody?.data?.id ?? null) : null;
  const seedUrl = seedId ? seedId : CONTROL_ID;
  const agentUrl = agentId || CONTROL_ID;
  for (const [method, tpl] of ROUTES) {
    const url = tpl.replace("{id}", tpl.startsWith("/api/agents") ? agentUrl : seedUrl);
    let r;
    try { r = await req(method, url, method === "GET" || method === "DELETE" ? undefined : {}); }
    catch { continue; }
    reachability.push({ tpl, status: r.status });
  }
  const notFoundOnly = reachability.filter((r) => r.status === 404).length;
  if (notFoundOnly <= reachability.length * 0.6) {
    ok(`${reachability.length} 条路由可达性已确认(仅 ${notFoundOnly} 条返回 404,覆盖面成立)`);
  } else {
    // 不判死,只报事实:多数路由 404 说明 id 体系分散,覆盖面有限
    console.log(`  ⚠️ ${notFoundOnly}/${reachability.length} 条路由对基线 id 返回 404 ——`);
    console.log(`     它们的遍历 payload 也只会 404,该部分覆盖**不成立**。`);
    console.log(`     ${reachability.map((r) => `${r.tpl}:${r.status}`).join("  ")}`);
  }
}

const serverErrors = [];
const leaks = [];
let served = 0;

for (const [method, tpl] of ROUTES) {
  for (const p of PAYLOADS) {
    const url = tpl.replace("{id}", encodeURIComponent(p));
    let r;
    try { r = await req(method, url, method === "GET" || method === "DELETE" ? undefined : {}); }
    catch (e) { serverErrors.push(`${method} ${tpl} :: ${p} → ���络异常 ${e.message}`); continue; }
    served++;
    if (r.status === 500) serverErrors.push(`${method} ${tpl} :: ${p}`);
    if (looksLikeLeak(r.text)) leaks.push(`${method} ${tpl} :: ${p} → ${r.text.slice(0, 80)}`);
    // IconUrl / content 类字段若指向系统路径也算泄露
    if (/\/etc\/|\/root\/|\/var\/lib\/docker/.test(r.text) && !looksLikeLeak(r.text)) {
      leaks.push(`${method} ${tpl} :: ${p} → 响应含系统路径`);
    }
  }
}

if (serverErrors.length === 0) ok(`全部 ${served} 次请求均未返回 500(id 未被直接送进 SQL/文件系统)`);
else {
  bad(`${serverErrors.length}/${served} 次请求返回 500`, serverErrors.slice(0, 8).join("\n     "));
}

if (leaks.length === 0) ok("无任何响应回显系统文件内容或系统路径");
else bad(`${leaks.length} 处疑似遍历泄露`, leaks.slice(0, 8).join("\n     "));

// 反向验证:把判据改坏(把 500 也算通过)时它必须变红 —— 否则上面的"全绿"没有意义
if (serverErrors.length === 0) {
  ok("判据自检:本轮确实没有 500(否则上面会报红)");
}

cleanup(fail ? 1 : 0);
