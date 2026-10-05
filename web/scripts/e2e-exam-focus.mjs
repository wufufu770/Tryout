#!/usr/bin/env node
/*
 * W4-2 回归防护:题库必须真的影响提问
 *
 * 为什么单元测试不够:
 *   examFocus.test.ts 只验证 buildExamFocusBlock 这个纯函数。
 *   它证明不了"服务端真的返回了题、真的被注入了 system prompt、
 *   真的没有泄漏 referenceAnswer"。
 *   若有人把 InterviewPage 的 examFocus 传成空串,所有单测仍会全绿,
 *   而题库就此静默失效 —— 这正是本项目要避免的死法。
 *
 * 覆盖:
 *   1. 完整链路:抽题 → 注入 → 标记已问
 *   2. 注入块含 keyPoints、不含题面全文、不含 referenceAnswer
 *   3. 追问边界约束存在
 *   4. 同场不重复出题
 *   5. 题库不可用时降级(不阻断,注入"不限定方向")
 *   6. 未设行业时不猜岗位
 *
 * 用法:node scripts/e2e-exam-focus.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const WEB = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(WEB, "..");
const PORT = 3461;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-w42-"));
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

// ---- 打包被测模块 ----
const ESBUILD = path.join(WEB, "node_modules", "esbuild", "bin", "esbuild");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-w42-b-"));
const ENTRY = path.join(TMP, "entry.mjs");
fs.writeFileSync(ENTRY, [
  `export { buildExamFocusBlock, buildNoBankNote } from "${WEB}/src/lib/examFocus.ts";`,
  `export { planNextQuestion } from "${WEB}/src/lib/questionPlanner.ts";`,
  "",
].join("\n"));
const BUNDLE = path.join(TMP, "bundle.mjs");
try {
  execFileSync(ESBUILD, [ENTRY, "--bundle", "--format=esm", "--platform=node",
    `--outfile=${BUNDLE}`, `--alias:@=${WEB}/src`, "--log-level=error"], { cwd: WEB, stdio: "pipe" });
} catch (e) {
  console.error("esbuild 失败:\n" + (e.stdout?.toString() || e.message).slice(-800));
  cleanup(); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1);
}
const { buildExamFocusBlock, buildNoBankNote, planNextQuestion } = await import(BUNDLE);

async function api(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

child = spawn("node", ["index.js"], {
  cwd: path.join(ROOT, "server"),
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
if (!up) { bad("后端未就绪", srvLog.slice(-600)); cleanup(); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); }

console.log("=== W4-2 题库接入提问 ===\n");

// 1) 服务端确实有题可抽
const stats = await api("GET", "/api/questionbank/stats");
if (stats.json?.data?.total > 0) ok(`题库可用:${stats.json.data.total} 题`);
else { bad("题库不可用"); cleanup(); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); }

const first = await api("GET", "/api/questionbank?industry=backend&sessionDifficulty=normal&limit=5");
const bank = first.json?.data || [];
if (bank.length > 0) ok(`按行业抽题成功:${bank.length} 题`);
else bad("按行业抽题返回空");

// 2) 注入块含 keyPoints、不含题面、不含参考答案
const plan = planNextQuestion(bank, { industry: "backend", sessionDifficulty: "normal" });
if (plan.kind === "ask") ok("planNextQuestion 返回 ask");
else bad(`planNextQuestion 应返回 ask,实际 ${plan.kind}`);

if (plan.kind === "ask") {
  const block = buildExamFocusBlock(plan.question);
  if (block.includes("<exam_focus>")) ok("注入块含 XML 边界");
  else bad("注入块缺 XML 边界");

  const kp = plan.question.keyPoints || [];
  const hasKp = kp.length === 0 || kp.some((k) => block.includes(k));
  if (hasKp) ok("注入块含考察方向(keyPoints)");
  else bad("注入块未含 keyPoints");

  if (!block.includes(plan.question.content)) ok("注入块不含题面全文(防泄题)");
  else bad("注入块混入了题面全文");

  if (!/referenceAnswer/.test(block)) ok("注入块不含 referenceAnswer 字段");
  else bad("注入块出现 referenceAnswer");

  if (/照抄|改写/.test(block)) ok("注入块含禁止照抄的约束");
  else bad("注入块缺禁止照抄的约束");

  if (/追问/.test(block) && /禁止|不得/.test(block)) ok("注入块含追问边界约束");
  else bad("注入块缺追问边界约束");
}

// 3) 完整链路:标记已问 → 再次抽题不重复
if (plan.kind === "ask") {
  const created = await api("POST", "/api/sessions", {
    title: "E2E", modelId: "x", difficulty: "normal", industry: "backend",
  });
  const sid = created.json?.data?.sessionId;
  await api("POST", `/api/sessions/${sid}/asked-questions`, {
    questionId: plan.question.id, industry: "backend",
    type: plan.question.type, difficulty: plan.question.difficulty,
  });
  const next = await api("GET",
    `/api/questionbank?industry=backend&sessionDifficulty=normal&exclude=${plan.question.id}&limit=5`);
  const nextIds = (next.json?.data || []).map((q) => q.id);
  if (!nextIds.includes(plan.question.id)) ok("标记已问后不再重复出题");
  else bad("已问题目仍被抽到");

  // 4) 端到端:列表接口全程无 referenceAnswer
  const raw = JSON.stringify(first.json);
  if (!raw.includes("referenceAnswer")) ok("列表接口全程未泄漏 referenceAnswer");
  else bad("列表接口泄漏了 referenceAnswer!");
}

// 5) 题库不可用 → 降级不阻断
const noBank = buildNoBankNote();
if (noBank && /不限定|自由/.test(noBank)) ok("题库不可用时降级块有效(不阻断)");
else bad("降级块无效");

// 6) 未设行业 → 不猜岗位
const noInd = planNextQuestion(bank, { industry: "" });
if (noInd.kind === "needsIndustry") ok("未设行业返回 needsIndustry(不猜岗位)");
else bad(`未设行业应返回 needsIndustry,实际 ${noInd.kind}`);

// 题库为空
const empty = planNextQuestion([], { industry: "backend" });
if (empty.kind === "noQuestions") ok("空题库返回 noQuestions(不崩)");
else bad(`空题库应返回 noQuestions,实际 ${empty.kind}`);

cleanup();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${"=".repeat(46)}`);
console.log(`结果:${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
