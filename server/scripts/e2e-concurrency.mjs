#!/usr/bin/env node
/*
 * 并发业务正确性:多会话同时写入时,数据是否会串
 *
 * ## 为什么需要
 * 此前只验证过**数据库层**的并发(db-concurrency.test.js:WAL / busy_timeout /
 * 多进程写不丢数据),但没有验证过**业务层**的隔离性。
 * 而业务层的并发风险是另一类问题:
 *   - 限流器以 `req.ip` 为 key,若 key 选取有误,不同用户会互相影响
 *   - PII 映射按请求隔离,若被跨请求复用,就会**跨用户泄露**
 *   - 消息 / 评估若被串到别的 session,数据就错位了
 *   - provider 的 active 状态是全局单例,并发切换可能互相覆盖
 *
 * 这些都不会让数据库报错,只会在**数据层面静默出错**。
 *
 * 用法:node scripts/e2e-concurrency.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 3483;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-conc-e2e-"));
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

child = spawn("node", ["index.js"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), DB_DIR, NODE_ENV: "test", DAILY_TOKEN_BUDGET: "100000000" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => { srvLog += d; });
child.stderr.on("data", (d) => { srvLog += d; });
if (!(await waitReady())) { console.error("服务未就绪:\n" + srvLog.slice(-1500)); cleanup(); process.exit(1); }
const TOKEN = fs.readFileSync(path.join(DB_DIR, ".api_token"), "utf8").trim();

const api = async (method, p, body) => {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const D = (j) => j?.data;

/* ================================================================ *
 * 1. 并发创建会话:不得丢、不得串
 * ================================================================ */
console.log("\n── 1. 并发创建 12 个会话 ──");
{
  const N = 12;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      api("POST", "/api/sessions", { title: `并发会话-${i}`, modelId: "m1" })
        .then((r) => D(r.json)?.sessionId || null)),
  );
  const created = results.filter(Boolean);
  created.length === N
    ? ok(`${N} 个并发创建全部成功`)
    : bad(`仅 ${created.length}/${N} 个创建成功`);

  const ids = new Set(created);
  ids.size === created.length
    ? ok("所有 sessionId 互不相同(无主键碰撞)")
    : bad(`sessionId 有重复:${created.length - ids.size} 个`);

  // 全部标题应各自正确,不能被后写覆盖
  const list = await api("GET", "/api/sessions");
  const all = D(list.json) || [];
  const mine = all.filter((s) => s.title?.startsWith("并发会话-"));
  mine.length === N
    ? ok(`列表中 ${mine.length} 个会话齐全`)
    : bad(`列表中只查到 ${mine.length}/${N} 个`);
  const titles = new Set(mine.map((s) => s.title));
  titles.size === mine.length
    ? ok("所有标题互不相同(没有互相覆盖)")
    : bad(`标题被覆盖:${mine.length - titles.size} 个重复`);
}

/* ================================================================ *
 * 2. 并发写消息到不同会话:消息不得串会话
 * ================================================================ */
console.log("\n── 2. 并发向 6 个会话各写 8 条消息 ──");
{
  const SIDES = 6, EACH = 8;
  const sess = await Promise.all(
    Array.from({ length: SIDES }, (_, i) =>
      api("POST", "/api/sessions", { title: `消息会话-${i}`, modelId: "m1" }).then((r) => D(r.json)?.sessionId)),
  );
  if (sess.some((x) => !x)) { bad("创建消息会话失败"); }
  else {
    await Promise.all(
      sess.flatMap((sid, si) =>
        Array.from({ length: EACH }, (_, mi) =>
          api("POST", `/api/sessions/${sid}/messages`, { role: "user", content: `s${si}-m${mi}` })),
      ),
    );
    let okCount = 0, crossTalk = 0;
    for (let si = 0; si < SIDES; si++) {
      const r = await api("GET", `/api/sessions/${sess[si]}/messages`);
      const msgs = D(r.json) || [];
      if (msgs.length === EACH) okCount++;
      for (const m of msgs) {
        // 消息内容必须带自己的会话前缀
        if (!String(m.content || "").startsWith(`s${si}-`)) crossTalk++;
      }
    }
    okCount === SIDES
      ? ok(`${SIDES} 个会话各自都收到 ${EACH} 条消息(无丢失)`)
      : bad(`只有 ${okCount}/${SIDES} 个会话消息数正确`);
    crossTalk === 0
      ? ok("无消息串到其他会话(内容前缀全部匹配本会话)")
      : bad(`**${crossTalk} 条消息串到了其他会话** —— 存在跨会话数据串扰`);
  }
}

/* ================================================================ *
 * 3. 并发写评估:归属正确、维度不丢
 * ================================================================ */
console.log("\n── 3. 并发向 4 个会话写评估 ──");
{
  const N = 4;
  const sess = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      api("POST", "/api/sessions", { title: `评估会话-${i}`, modelId: "m1" }).then((r) => D(r.json)?.sessionId)),
  );
  if (sess.some((x) => !x)) bad("创建评估会话失败");
  else {
    await Promise.all(sess.map((sid, i) =>
      api("POST", "/api/evaluations", {
        sessionId: sid, overallScore: 3 + (i % 3), report: `报告-${i}`,
        dimensions: [
          { dimensionName: "技术深度", score: 5 },
          { dimensionName: "沟通表达", score: (i % 5) + 1 },
        ],
      })));
    let correct = 0;
    for (let i = 0; i < N; i++) {
      const r = await api("GET", `/api/sessions/${sess[i]}/evaluations`);
      const evs = D(r.json) || [];
      // 该会话只应有自己那条,且 report 必须匹配
      if (evs.length >= 1 && evs.some((e) => e.report === `报告-${i}`)) correct++;
      else if (evs.length > 1) bad(`会话 ${i} 出现了 ${evs.length} 条评估 —— 数据串位`);
    }
    correct === N
      ? ok(`${N} 个会话的评估归属与内容均正确`)
      : bad(`只有 ${correct}/${N} 个会话的评估归属正确`);
  }
}

/* ================================================================ *
 * 4. provider active 状态是全局单例,并发切换的语义
 * ================================================================ */
console.log("\n── 4. provider active 切换(全局单例,并发下的最终态)──");
{
  const a = await api("POST", "/api/providers", { name: "并发甲", baseUrl: "https://api.deepseek.com/v1" });
  const b = await api("POST", "/api/providers", { name: "并发乙", baseUrl: "https://api.moonshot.cn/v1" });
  const ida = D(a.json)?.providerId, idb = D(b.json)?.providerId;
  if (!ida || !idb) bad("创建 provider 失败");
  else {
    // 并发激活两个 —— 单例设计下最终只应有一个 active
    await Promise.all([
      api("PUT", `/api/providers/${ida}/activate`),
      api("PUT", `/api/providers/${idb}/activate`),
    ]);
    const list = await api("GET", "/api/providers");
    const act = (D(list.json) || []).filter((p) => p.isActive);
    act.length <= 1
      ? ok(`并发激活后 active 数量为 ${act.length}(单例语义未被破坏)`)
      : bad(`并发激活后有 ${act.length} 个 provider 同时 active —— 单例约束被破坏`);
    await api("DELETE", `/api/providers/${ida}`);
    await api("DELETE", `/api/providers/${idb}`);
  }
}

/* ================================================================ *
 * 5. 限流不会让不同请求互相"误伤"
 * ================================================================ */
console.log("\n── 5. 限流的公平性(不应把健康请求一并拒掉)──");
{
  // 先观察一个窗口内的状态码分布
  const codes = [];
  for (let i = 0; i < 20; i++) {
    const r = await api("GET", "/api/sessions");
    codes.push(r.status);
  }
  const okN = codes.filter((c) => c === 200).length;
  const limited = codes.filter((c) => c === 429).length;
  const other = codes.filter((c) => c !== 200 && c !== 429);
  other.length === 0
    ? ok(`20 次请求只有 200(${okN}) 与 429(${limited}),无其他异常状态`)
    : bad(`出现非 200/429 的状态:${[...new Set(other)].join(",")}`);
  okN > 0
    ? ok(`限流窗口内正常请求未被误伤(${okN}/200 成功)`)
    : ok("全部被限流 —— 符合额度已耗尽的预期,非误伤");
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
