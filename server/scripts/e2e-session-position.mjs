#!/usr/bin/env node
/*
 * W3-2 端到端回归:目标岗位 + 已问题目去重
 *
 * 覆盖 5 条真实链路:
 *   1. 建会话带 industry/position → 真正落库(白名单 schema 会静默剥离字段)
 *   2. 记录已问题目
 *   3. 检索时排除已问
 *   4. 重复记录幂等
 *   5. 缺 questionId → 400
 *
 * 用法:node scripts/e2e-session-position.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 3451;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-w32-"));
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };

let child = null;
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

async function api(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

child = spawn("node", ["index.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DB_DIR, INTERVIEWX_AUTH_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let srvLog = "";
child.stdout.on("data", (d) => { srvLog += d; });
child.stderr.on("data", (d) => { srvLog += d; });

let up = false;
// 探活窗口 60 秒:冷启动含 DB 备份,15 秒在慢机器/高负载下会误判为失败
  for (let i = 0; i < 120; i++) {
  try { const r = await fetch(`${BASE}/api/health`); if (r.ok) { up = true; break; } } catch { /* 未就绪 */ }
  await new Promise((r) => setTimeout(r, 500));
}
if (!up) {
  bad("后端未就绪", srvLog.slice(-800));
  cleanup();
  process.exit(1);
}

console.log("=== W3-2 目标岗位 + 已问题目 去重 ===\n");

// 1) 建会话带岗位
const created = await api("POST", "/api/sessions", {
  title: "后端面试", modelId: "x", difficulty: "normal",
  industry: "backend", position: "后端工程师",
});
const sid = created.json?.data?.sessionId;
if (sid) ok("创建会话成功");
else { bad("创建会话失败", JSON.stringify(created.json)); cleanup(); process.exit(1); }

const got = await api("GET", `/api/sessions/${sid}`);
const d = got.json?.data || {};
if (d.industry === "backend" && d.position === "后端工程师") {
  ok(`岗位字段已落库: industry=${d.industry} position=${d.position}`);
} else {
  bad(`岗位字段未落库: industry=${d.industry} position=${d.position}`);
}

// 2) 记录已问
const mark = await api("POST", `/api/sessions/${sid}/asked-questions`, {
  questionId: "backend-tech-001", industry: "backend", type: "technical", difficulty: "mid",
});
if (mark.status === 200 && mark.json?.ok) ok("记录已问题目成功");
else bad("记录已问题目失败", JSON.stringify(mark.json));

const listed = await api("GET", `/api/sessions/${sid}/asked-questions`);
const ids = (listed.json?.data || []).map((x) => x.questionId);
if (ids.length === 1 && ids[0] === "backend-tech-001") ok("已问题目列表正确");
else bad(`已问题目列表异常: ${JSON.stringify(ids)}`);

// 3) 检索排除
const searched = await api("GET", "/api/questionbank?industry=backend&exclude=backend-tech-001&limit=5");
const sids = (searched.json?.data || []).map((q) => q.id);
if (!sids.includes("backend-tech-001") && sids.length > 0) ok("检索已排除问过的题");
else bad(`检索未正确排除: ${JSON.stringify(sids)}`);

// 4) 幂等
await api("POST", `/api/sessions/${sid}/asked-questions`, { questionId: "backend-tech-001" });
const again = await api("GET", `/api/sessions/${sid}/asked-questions`);
if ((again.json?.data || []).length === 1) ok("重复记录同一题幂等(仍 1 条)");
else bad(`重复记录产生了 ${(again.json?.data || []).length} 条`);

// 5) 缺 questionId
const miss = await api("POST", `/api/sessions/${sid}/asked-questions`, {});
if (miss.status === 400) ok("缺 questionId 返回 400");
else bad(`缺 questionId 应 400,实际 ${miss.status}`);

// 附:列表接口不得泄漏参考答案
const leak = await api("GET", "/api/questionbank?industry=backend&limit=5");
const raw = JSON.stringify(leak.json);
if (!raw.includes("referenceAnswer")) ok("列表接口未泄漏 referenceAnswer");
else bad("列表接口泄漏了 referenceAnswer!");

cleanup();
console.log(`\n${"=".repeat(46)}`);
console.log(`结果:${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
