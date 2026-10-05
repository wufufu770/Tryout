#!/usr/bin/env node
/*
 * e2e:LLM **失败转移(failover)真实触发** —— 补 `FEATURE_MATRIX.md` 里长期挂着的一条
 *   「LLM 失败转移(failover)真实触发 | 需构造上游 5xx,本机只有一个 provider」
 *
 * ## 为什么之前一直没测
 * failover 是全项目里最容易"看起来实现了"的特性:db 有 `in_failover_queue` /
 * `failover_priority` 两列,`getFailoverQueue()` 也被 `llm.js:668` 真实消费,
 * 设置页还有开关。但**没有一个测试真的让主供应商挂掉过**。
 * 于是"切换了队列却没有任何反应"这种缺陷可以长期潜伏而不被发现。
 *
 * ## 本脚本怎么做到"真实"且"零成本"
 * 起两个**本地** mock 上游(都在 127.0.0.1,与 `category:"local"` 的 SSRF 白名单一致):
 *   主供应商   → 恒返回 500
 *   备援供应商 → 返回合法的 OpenAI 格式 chat completion,内容带可识别标记
 * 然后走**真实 API**(`POST /api/providers` 建供应商 → `PUT` 设队列 → `POST /api/chat`),
 * 完全不碰数据库内部实现。
 *
 * 成本为零:两个"上游"都是本机,不会真的调用任何 LLM,也不消耗任何 token 预算。
 * 而被测的是 100% 真实代码路径 —— 建供应商、SSRF 校验、重试、队列查找、
 * 降级标记、PII 还原、错误透传。
 *
 * 前置:后端在 127.0.0.1:3001
 * 用法:node scripts/e2e-failover.mjs
 */
import http from "node:http";
import fs from "node:fs";
// R56:诊断信息安全格式化 —— JSON.stringify(undefined) 不是字符串,`.slice` 会崩
import { brief } from "./lib/brief.mjs";

const API = process.env.API_BASE || "http://127.0.0.1:3001";
const TOKEN_FILE = process.env.TRYOUT_TOKEN_FILE
  || "/home/wff/桌面/tryout/Tryout-package/Tryout/server/data/.api_token";
const TOKEN = process.env.TRYOUT_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, "utf8").trim() : "");
if (!TOKEN) { console.error("❌ 缺少 API token"); process.exit(2); }

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };

const H = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
const api = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j };
};

/* ---------------- 本地 mock 上游 ---------------- */
const MARK = "FAILOVER-STANDBY-MARKER";
let primaryHits = 0, standbyHits = 0;

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve({ server: s, port: s.address().port }));
  });
}
const primary = await listen((req, res) => {
  primaryHits++;
  req.resume();
  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "mock upstream boom" } }));
});
const standby = await listen((req, res) => {
  standbyHits++;
  req.resume();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    id: "mock", object: "chat.completion", created: Date.now(), model: "mock-standby",
    choices: [{ index: 0, message: { role: "assistant", content: MARK }, finish_reason: "stop" }],
    // 极小的 usage:既让 onUsage 记账路径被真实走到,又不浪费预算
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));
});
console.log(`\n  主(mock 500):127.0.0.1:${primary.port}`);
console.log(`  备(mock 200):127.0.0.1:${standby.port}`);

const created = [];
const cleanup = async () => {
  for (const id of created) await api("DELETE", `/api/providers/${id}`).catch(() => {});
  primary.server.close(); standby.server.close();
};

try {
  /* ---------------- 建两个本地供应商 ---------------- */
  console.log("\n── A. 建立主/备两个本地供应商 ──");
  const a = await api("POST", "/api/providers", {
    name: `E2E-Failover-Primary-${Date.now()}`, category: "local",
    baseUrl: `http://127.0.0.1:${primary.port}/v1`, apiFormat: "openai_chat", modelName: "mock",
  });
  if (a.status >= 400 || !a.json?.data?.providerId) {
    bad("创建主供应商失败", brief(a.json, 200));
  } else {
    created.push(a.json.data.providerId);
    ok(`主供应商已建:${a.json.data.providerId}`);
  }
  const b = await api("POST", "/api/providers", {
    name: `E2E-Failover-Standby-${Date.now()}`, category: "local",
    baseUrl: `http://127.0.0.1:${standby.port}/v1`, apiFormat: "openai_chat", modelName: "mock",
  });
  if (b.status >= 400 || !b.json?.data?.providerId) {
    bad("创建备援供应商失败", brief(b.json, 200));
  } else {
    created.push(b.json.data.providerId);
    ok(`备援供应商已建:${b.json.data.providerId}`);
  }
  if (created.length < 2) { await cleanup(); process.exit(1); }
  const [pid, sid] = created;

  /* ---------------- 备援入队 ---------------- */
  console.log("\n── B. 把备援放进 failover 队列 ──");
  const q = await api("PUT", `/api/providers/${sid}`, { inFailoverQueue: true, failoverPriority: 1 });
  if (q.status >= 400) bad("设置 failover 队列失败", brief(q.json, 200));
  else {
    const got = q.json?.data;
    got?.inFailoverQueue === true
      ? ok(`备援已入队(inFailoverQueue=${got.inFailoverQueue}, priority=${got.failoverPriority})`)
      : bad("入队未生效,返回值里 inFailoverQueue 不为 true", JSON.stringify(got));
  }
  // ⚠️ 列表接口的主键字段是 `id`,而 POST/PUT 的返回体是 `providerId`。
  //   (前端 SettingsPage 用的也是 p.id,所以这不是产品缺陷,但两处命名不一致,
  //    很容易写错 —— 本脚本第一版就栽在这里。)
  const list = await api("GET", "/api/providers");
  const inQ = (list.json?.data || []).filter((p) => p.inFailoverQueue);
  inQ.some((p) => p.id === sid)
    ? ok(`队列查询可见备援(当前队列 ${inQ.length} 个)`)
    : bad("GET /api/providers 看不到备援在队列中", `列表主键字段样例:${Object.keys(list.json?.data?.[0] || {}).slice(0, 3)}`);

  /* ---------------- 真实触发 failover ---------------- */
  console.log("\n── C. 主供应商 500,观察是否真的转移 ──");
  primaryHits = 0; standbyHits = 0;
  const t0 = Date.now();
  const r = await api("POST", "/api/chat", { provider: pid, messages: [{ role: "user", content: "ping" }], stream: false });
  const ms = Date.now() - t0;
  const d = r.json?.data;

  if (r.status !== 200) {
    bad(`failover 后仍非 200(HTTP ${r.status})`, brief(r.json, 200));
  } else if (d?.content !== MARK) {
    bad("响应内容不是备援返回的标记,说明流量没走到备援", brief(d, 200));
  } else {
    ok(`failover 成功:内容来自备援(${ms}ms)`);
  }
  primaryHits > 0
    ? ok(`主供应商确实被打到 ${primaryHits} 次(先失败才谈得上转移)`)
    : bad("主供应商一次都没被调用,测试无效");
  primaryHits > 1
    ? ok(`主供应商经历重试(${primaryHits} 次)后才耗尽,确认重试→转移的顺序`)
    : bad(`主供应商只被调用 ${primaryHits} 次,未见重试(MAX_RETRY 未生效?)`);
  standbyHits === 1
    ? ok(`备援被调用 ${standbyHits} 次(应恰好 1 次)`)
    : bad(`备援被调用 ${standbyHits} 次,期望 1 次`);

  console.log("\n── D. 降级标记是否透出 ──");
  d?.degraded === true
    ? ok(`degraded=true 已标记`)
    : bad("degraded 未标记为 true,前端无法告知用户结果来自备援", JSON.stringify(d));
  d?.degradedFrom
    ? ok(`degradedFrom=${d.degradedFrom}`)
    : bad("degradedFrom 缺失,无法定位是哪个备援顶上的");

  /* ---------------- 反向:队列为空时不得静默成功 ---------------- */
  console.log("\n── E. 反向:把备援移出队列后应回到失败 ──");
  const off = await api("PUT", `/api/providers/${sid}`, { inFailoverQueue: false, failoverPriority: 0 });
  if (off.status >= 400) bad("移出队列失败", brief(off.json, 160));
  else {
    primaryHits = 0; standbyHits = 0;
    const r2 = await api("POST", "/api/chat", { provider: pid, messages: [{ role: "user", content: "ping" }], stream: false });
    if (r2.status === 200) {
      bad("备援已移出队列,请求却仍返回 200 —— 说明响应并非来自主供应商", brief(r2.json?.data, 160));
    } else {
      ok(`无备援时如实报错(HTTP ${r2.status}),未伪造成功`);
    }
    standbyHits === 0
      ? ok("备援未被调用,队列逻辑确实生效")
      : bad(`备援仍被调用 ${standbyHits} 次,移出队列未生效`);
  }

  /* ---------------- 反向:流式请求不走 failover ---------------- */
  console.log("\n── F. 反向:流式请求不应走 failover(已写 response 无法回退)──");
  await api("PUT", `/api/providers/${sid}`, { inFailoverQueue: true, failoverPriority: 1 });
  primaryHits = 0; standbyHits = 0;
  const rs = await fetch(`${API}/api/chat`, {
    method: "POST", headers: H,
    body: JSON.stringify({ provider: pid, messages: [{ role: "user", content: "ping" }], stream: true }),
  });
  await rs.text().catch(() => "");
  standbyHits === 0
    ? ok("流式请求未调用备援(符合 `if (stream) throw primaryError` 的设计)")
    : bad(`流式请求却调用了备援 ${standbyHits} 次,与代码意图不符`);
} finally {
  await cleanup();
}

console.log(`\n${"=".repeat(58)}`);
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log(`${"=".repeat(58)}\n`);
process.exit(fail > 0 ? 1 : 0);
