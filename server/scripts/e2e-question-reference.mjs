#!/usr/bin/env node
/*
 * ISSUE-038 端到端回归:题目级评分基准端点
 *
 * ## 为什么需要这条测试
 * `getReferenceForScoring()` 在 R32 之前就已经写好了,但**零调用方** ——
 * 没有路由,没有任何东西真的把参考答案送到评分器面前。
 * 服务层单测证明不了"端点在跑",前端单测证明不了"服务端真的会给"。
 * 中间那段(HTTP 层)正好是这类缺陷的藏身处 —— 静默地 404,评估就一直降级,
 * 而 UI 会照旧运行,没有任何报错。
 *
 * ## 覆盖
 *   1. 有效 token + 真实题库题 → 200,且 keyPoints/referenceAnswer/type 三件套齐全
 *   2. 无 token → 401(新端点同样受全局 authMiddleware 保护,不得裸奔)
 *   3. 错 token → 401
 *   4. 不存在的题 id → 404(而不是静默返回空)
 *   5. 批量接口**仍不**带 referenceAnswer(加了单题接口不等于放松列表接口)
 *   6. 题库未生成(DB_DIR 指向空目录)→ 503,且不是 200 空对象
 *
 * 用法:npm run test:e2e:qref
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 3471;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = path.resolve(import.meta.dirname, "..");
// 真实题库目录(server/data/),题库缺失时相关断言会被跳过而不是假绿
const REAL_DB_DIR = path.resolve(SERVER_DIR, "data");
const hasBank = fs.existsSync(path.join(REAL_DB_DIR, "questionbank.json"));

let pass = 0, fail = 0, skip = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };
const sk = (m) => { console.log(`  — ${m}`); skip++; };

let child = null;
let srvLog = "";
let cleaned = false;

/** 只停服务并**等它真的退出** —— 同端口重启时,不等就会把请求打到旧实例上 */
async function stopServer() {
  const p = child;
  if (!p || p.killed) { child = null; return; }
  child = null;
  const exited = new Promise((res) => p.once("exit", res));
  try { p.kill("SIGKILL"); } catch { return; }
  await Promise.race([exited, new Promise((res) => setTimeout(res, 3000))]);
}

function cleanup(code) {
  if (cleaned) return;
  cleaned = true;
  // 退出路径不等进程回收 —— process.exit 会带走子进程
  if (child && !child.killed) { try { child.kill("SIGKILL"); } catch {} }
  child = null;
  try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch {}
  console.log(`\n通过 ${pass} / 失败 ${fail}${skip ? ` / 跳过 ${skip}` : ""}`);
  process.exit(code);
}
process.on("exit", () => { if (child) stopServer(); });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => cleanup(1));

const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-qref-"));
if (hasBank) {
  fs.cpSync(path.join(REAL_DB_DIR, "questionbank.json"), path.join(DB_DIR, "questionbank.json"));
}

function startServer(dbDir, env = {}, port = PORT) {
  return new Promise((resolve, reject) => {
    srvLog = "";
    const p = spawn(process.execPath, ["index.js"], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        DB_DIR: dbDir,
        // 不设 INTERVIEWX_AUTH_DISABLED —— 本脚本要测的就是鉴权真的生效
        INTERVIEWX_API_TOKEN: "qref-test-token",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = p;
    p.stdout.on("data", (d) => { srvLog += d; });
    p.stderr.on("data", (d) => { srvLog += d; });
    p.on("error", reject);
    // 进程提前退出(EADDRINUSE 等)要立刻失败,不能干等到超时
    p.on("exit", (code) => { if (code !== null && code !== 0) { clearInterval(t); reject(new Error(`服务退出 code=${code}:\n${srvLog.slice(-1500)}`)); } });
    const t = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (r.ok) { clearInterval(t); resolve(); }
      } catch {}
    }, 200);
    setTimeout(() => { clearInterval(t); reject(new Error(`服务未就绪:\n${srvLog.slice(-1500)}`)); }, 30000);
  });
}

const TOKEN = "qref-test-token";
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const j = async (url, init, port = PORT) => {
  const r = await fetch(`http://127.0.0.1:${port}${url}`, init);
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

console.log("▶ ISSUE-038 题目级评分基准端点 e2e");

try {
  await startServer(DB_DIR);
} catch (e) {
  bad("服务启动失败", String(e.message || e));
  cleanup(1);
}

// 取一道真实题 id(用统计接口拿不到 id,直接从题库文件读,避免新增只为测试的接口)
let sampleId = null;
let sampleType = null;
try {
  const b = JSON.parse(fs.readFileSync(path.join(REAL_DB_DIR, "questionbank.json"), "utf8"));
  sampleId = b.questions[0].id;
  sampleType = b.questions[0].type;
} catch { /* hasBank 已判定,这里不该到 */ }

// ---- 1. 鉴权 ----
{
  const r = await j(`/api/questionbank/${encodeURIComponent(sampleId || "x")}/reference`);
  if (r.status === 401) ok("无 token → 401(新端点受全局鉴权保护)");
  else bad("无 token 未被拒绝", `期望 401,实得 ${r.status}`);
}
{
  const r = await j(`/api/questionbank/${encodeURIComponent(sampleId || "x")}/reference`, {
    headers: { Authorization: "Bearer wrong-token" },
  });
  if (r.status === 401) ok("错 token → 401");
  else bad("错 token 未被拒绝", `期望 401,实得 ${r.status}`);
}

// ---- 2. 有效请求 ----
if (!hasBank) {
  sk("题库未生成,跳过参考块内容断言");
} else {
  const r = await j(`/api/questionbank/${encodeURIComponent(sampleId)}/reference`, { headers: H });
  if (r.status !== 200) {
    bad("有效题 id → 200", `实得 ${r.status} body=${JSON.stringify(r.body)}`);
  } else {
    ok("有效题 id → 200");
    const d = r.body?.data;
    if (typeof d?.referenceAnswer === "string" && d.referenceAnswer.trim()) ok("返回 referenceAnswer");
    else bad("缺 referenceAnswer", JSON.stringify(d));
    if (Array.isArray(d?.keyPoints) && d.keyPoints.length > 0) ok(`返回 keyPoints(${d.keyPoints.length} 项)`);
    else bad("缺 keyPoints", JSON.stringify(d));
    if (d?.type === sampleType) ok(`返回权威题型 type=${sampleType}`);
    else bad("type 缺失或与题库不符", `期望 ${sampleType},实得 ${d?.type}`);
  }

  // 编码:含斜杠/问号的 id 不应穿越路径
  const weird = await j(`/api/questionbank/${encodeURIComponent("a/../b")}/reference`, { headers: H });
  if (weird.status === 404) ok("含斜杠的 id → 404(未穿越路径)");
  else bad("含斜杠 id 行为异常", `期望 404,实得 ${weird.status}`);

  // 不存在的题
  const miss = await j(`/api/questionbank/no-such-q-xyz/reference`, { headers: H });
  if (miss.status === 404) ok("不存在的题 id → 404(不静默返回空)");
  else bad("不存在的题 id 未 404", `实得 ${miss.status}`);
}

// ---- 3. 批量接口仍不泄露 ----
{
  const stats = await j("/api/questionbank/stats", { headers: H });
  const ind = stats.body?.data?.industries?.[0]?.id;
  if (!ind) {
    sk("题库无行业数据,跳过批量接口泄露断言");
  } else {
    const list = await j(`/api/questionbank?industry=${encodeURIComponent(ind)}&limit=5`, { headers: H });
    const arr = Array.isArray(list.body?.data) ? list.body.data : [];
    const leaked = arr.filter((q) => "referenceAnswer" in q);
    if (arr.length && leaked.length === 0) ok(`批量接口未泄露 referenceAnswer(${arr.length} 题)`);
    else if (!arr.length) sk("批量接口返回空,跳过");
    else bad("批量接口泄露了 referenceAnswer", `${leaked.length}/${arr.length} 题带答案`);
  }
}

// ---- 4. 题库未生成 → 503(负向:本脚本**做不到** e2e,只做单测覆盖) ----
//
// ⚠️ 这里原本写了"换空 DB_DIR 起第二个实例"来模拟题库缺失,实测得到 404 而非 503。
// 查证结论:`loadQuestionBank()` 读的是 `path.join(SERVER_ROOT, "data", "questionbank.json")`
// —— **硬编码路径,不受 DB_DIR 影响**。换 DB_DIR 完全没碰到题库,请求照常打到了
// 有题库的实例上,于是走了"题不存在"的 404 分支。
//
// 也就是说题库文件位置是写死的,要模拟缺失只能临时重命名 `server/data/questionbank.json`。
// 门禁会并发跑多个 e2e 脚本,动这个共享文件会把别的脚本打成假红 —— 不做。
// 该路径改由 `server/test/question-reference.test.js` 在服务层覆盖。
const BANK_PATH_HARDCODED = path.resolve(SERVER_DIR, "data", "questionbank.json");
sk(`题库缺失(503)路径不在本 e2e 覆盖:题库路径硬编码于 ${path.relative(SERVER_DIR, BANK_PATH_HARDCODED)}(不随 DB_DIR 变化),模拟缺失需动共享文件,与并发 e2e 冲突;改由服务层单测覆盖`);

cleanup(fail ? 1 : 0);
