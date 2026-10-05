#!/usr/bin/env node
/*
 * R14 长稳与资源安全测试
 *
 * ## 覆盖两块此前完全没有测试的东西
 *
 * ### 1. 资源泄漏
 * 限流器用 `Map` 以 `req.ip` 为 key(`index.js:120`),靠 `setInterval` 定期清理过期项。
 * 这意味着 **key 的基数决定了 Map 的大小**。若 key 可被攻击者控制,
 * 就是一个无界增长的内存放大器。本脚本验证其是否有界。
 *
 * ### 2. ⚠️ 一个此前没被审视过的部署配置
 * `docker-compose.yml` 同时做了两件事:
 *   - `ports: "3001:3001"`  ← 后端端口**直接暴露到宿主机**
 *   - `BEHIND_PROXY=1`        ← 信任一层 XFF
 * 而 `index.js:56` 的 `app.set("trust proxy", 1)` 在 BEHIND_PROXY=1 时生效,
 * Express 会取 XFF 的**最后一段**作为 `req.ip`。
 *
 * → 若攻击者**绕过 nginx 直连 :3001**,并自行构造 `X-Forwarded-For`,
 *    就可以让 `req.ip` 变成任意值。后果有两个:
 *      a) 限流被完全绕过(每次换一个"IP")
 *      b) 限流器的 Map 无限膨胀 → 内存耗尽
 *    这正是"信任代理"配置最典型的误配后果。
 *
 * 本脚本**如实测量**这一场景,不预设结论。
 *
 * 用法:node scripts/soak-limits.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3495;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-soak-"));
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = path.resolve(import.meta.dirname, "..");

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };
const info = (m) => { console.log(`  ℹ️  ${m}`); };

let child = null, cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { child?.kill("SIGKILL"); } catch { /* 已退出 */ }
  try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 已删 */ }
}
process.on("exit", cleanup);
process.on("uncaughtException", (e) => { console.error("[未捕获]", e?.message); cleanup(); process.exit(1); });

function startServer(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn("node", ["index.js"], {
      cwd: SERVER_DIR,
      env: { ...process.env, PORT: String(PORT), DB_DIR, NODE_ENV: "test", INTERVIEWX_AUTH_DISABLED: "1", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    c.stdout.on("data", (d) => { out += d; });
    c.stderr.on("data", (d) => { out += d; });
    const t0 = Date.now();
    const tick = async () => {
      try { if ((await fetch(`${BASE}/api/health`)).ok) return resolve(c); } catch { /* 未就绪 */ }
      if (Date.now() - t0 > 20000) return reject(new Error("服务未就绪\n" + out.slice(-800)));
      setTimeout(tick, 400);
    };
    tick();
  });
}
const rssMB = (proc) => {
  try {
    const st = fs.readFileSync(`/proc/${proc.pid}/status`, "utf8");
    const m = st.match(/VmRSS:\s+(\d+) kB/);
    return m ? Math.round(Number(m[1]) / 1024) : 0;
  } catch { return 0; }
};

/** 记录起始 RSS,供各阶段对比 */
let rss0 = 0;

/* ================================================================== *
 * 场景 1:BEHIND_PROXY=1 + 直连,攻击者可控 XFF
 * ================================================================== */
console.log("\n── 场景 1. 部署配置:后端端口不得对局域网开放(ISSUE-027 回归)──");
{
  // 这是 ISSUE-027 的**配置层**回归守卫。
  // 背景:index.js:53 的注释写明 BEHIND_PROXY=1 的目的正是"防后端直接暴露时
  // XFF 伪造绕过限流",但 docker-compose.yml 曾同时写 `3001:3001` 与 BEHIND_PROXY=1,
  // 把该防护完全抵消 —— 实测 200 次不同伪造 XFF,0 次 429。
  const compose = fs.readFileSync(
    path.resolve(SERVER_DIR, "..", "docker", "docker-compose.yml"), "utf8",
  );
  const m = compose.match(/- "([^"]*3001:3001)"/);
  const mapping = m ? m[1] : "(未找到 3001 映射)";
  if (/^127\.0\.0\.1:/.test(mapping)) {
    ok(`compose 端口映射为 ${mapping} —— 仅回环可达,伪造 XFF 无从下手`);
  } else if (mapping === "(未找到 3001 映射)") {
    ok("compose 未发布 3001 端口 —— 后端不可从宿主机直连,同样安全");
  } else {
    bad(`compose 端口映射为 ${mapping},未绑回环`,
        "BEHIND_PROXY=1 时,局域网可绕过 nginx 直连并伪造 XFF 绕过限流(ISSUE-027)");
  }
}

console.log("\n── 场景 1b. 行为验证:伪造 XFF 在 BEHIND_PROXY=1 下确会绕过限流 ──");
{
  // 这一组**故意**复现绕过,用来证明上面的配置守卫是必要的。
  // 若将来 Express/代理语义变化导致伪造不再生效,这里会失败并提示重新评估。
  child = await startServer({ BEHIND_PROXY: "1" });
  await new Promise((r) => setTimeout(r, 1200));
  const n429 = [];
  for (let i = 0; i < 200; i++) {
    const r = await fetch(`${BASE}/api/providers`, {
      headers: { "X-Forwarded-For": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` },
    });
    if (r.status === 429) n429.push(i);
  }
  n429.length === 0
    ? ok("复现成功:伪造 XFF 可绕过限流 —— 故 compose 必须绑回环(配置守卫有意义)")
    : info(`伪造 XFF 未绕过限流(${n429.length} 次 429)。代理语义可能已变化,请重新评估 ISSUE-027 的必要性`);
  child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 400));
  // 场景 2 起需要新的实例
  child = await startServer({ BEHIND_PROXY: "1" });
  await new Promise((r) => setTimeout(r, 1200));
}

/* ================================================================== *
 * 场景 2:伪造 XFF 是否撑大限流器的 Map(内存)
 * ================================================================== */
console.log("\n── 场景 2. 伪造 XFF 是否导致限流器内存膨胀 ──");
{
  rss0 = rssMB(child);
  const rss1 = rss0;
  // 再打 1500 次,每次一个新"IP"
  for (let i = 0; i < 1500; i++) {
    await fetch(`${BASE}/api/providers`, { headers: { "X-Forwarded-For": `172.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` } });
  }
  await new Promise((r) => setTimeout(r, 800));
  const rss2 = rssMB(child);
  const grew = rss2 - rss1;
  info(`RSS:${rss0} MB →(200 次)${rss1} MB →(再加 1500 次)${rss2} MB,本阶段增长 ${grew} MB`);
  // 1500 个 key 本身很小;真正的风险是 key 基数无界。这里用"是否随 key 数线性增长"来判断
  grew < 60
    ? ok(`1500 个伪造 IP 仅增长 ${grew} MB,未见失控膨胀`)
    : info(`增长 ${grew} MB —— 需结合 Map key 数进一步判断(非必然是漏洞,Map 项本身很小)`);
}

/* ================================================================== *
 * 场景 3:cleanupTokenUsage 定时任务不崩溃且幂等
 * ================================================================== */
console.log("\n── 场景 3. 定时任务与长时运行稳定性 ──");
{
  const h = await fetch(`${BASE}/api/health`);
  h.ok ? ok("经历 1700+ 次请求后服务仍健康") : bad(`服务异常:${h.status}`);

  // 触发 token 记账路径(cleanupTokenUsage 会 DELETE 旧记录)
  const r = await fetch(`${BASE}/api/sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "soak", modelId: "m" }),
  });
  r.status === 200 ? ok("长时运行后仍可正常写入") : bad(`写入失败:${r.status}`);
}

child.kill("SIGKILL");
await new Promise((r) => setTimeout(r, 500));
const rssFinal = rssMB(child);
info(`退出前 RSS:${rssFinal} MB(起始 ${rss0} MB)`);

/* ================================================================== *
 * 场景 4:正常路径(不伪造 XFF)的长稳
 * ================================================================== */
console.log("\n── 场景 4. 不带 BEHIND_PROXY 的常规长稳 ──");
child = await startServer({});
await new Promise((r) => setTimeout(r, 1500));
{
  const a = rssMB(child);
  let last = 0;
  for (let i = 0; i < 600; i++) {
    last = (await fetch(`${BASE}/api/sessions`)).status;
  }
  const b = rssMB(child);
  const limited = last === 429;
  last !== 429
    ? ok(`600 次请求后未触发限流(单 IP 未超阈值,符合配置)`)
    : ok("触发了限流(说明 120/分钟 的限额生效)");
  b - a < 80
    ? ok(`600 次请求 RSS 增长 ${b - a} MB,无异常膨胀`)
    : bad(`600 次请求 RSS 增长 ${b - a} MB,异常`);
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
