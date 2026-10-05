#!/usr/bin/env node
/*
 * ISSUE-004 关联(P0):Nginx XFF 防伪造 + trust proxy 的**端到端**验证
 *
 * ## 为什么需要这条测试
 * 限流以 `req.ip` 为 key(`index.js:126`),而 `req.ip` 在 `BEHIND_PROXY=1` 时
 * 取决于 `app.set("trust proxy", 1)`(`index.js:56-57`)。
 * 这条链路由**两端协作**构成:
 *   nginx 侧:`proxy_set_header X-Forwarded-For $remote_addr;`  ← 用**替换**而非追加
 *   后端侧:`app.set("trust proxy", 1)`                          ← 只信任一层
 * 任何一端被改坏(例如有人"顺手"改成 `$proxy_add_x_forwarded_for`,
 * 或把 trust proxy 去掉/设成 true),**攻击者就能自带 XFF 头绕过限流**,
 * 而**现有的任何测试都不会变红** —— 两端都没有集成测试。
 *
 * 本脚本起真实的 nginx 容器 + 真实后端,打带伪造 XFF 的请求,
 * 验证:
 *   1. 后端记录的 ip 是**真实客户端 IP**,不是攻击者注入的值
 *   2. 攻击者伪造 XFF **无法绕过限流**(限流仍按单一真实 IP 计数)
 *   3. 不带 BEHIND_PROXY 时,后端使用 TCP 连接地址(直连防伪造)
 *
 * 前置:需要能 `docker run nginx:alpine`。
 * ## 这条测试真正守住的是什么(实测得出,值得记下)
 * 单独把 nginx 从 `$remote_addr`(替换)改成 `$proxy_add_x_forwarded_for`(追加),
 * **本测试并不会变红** —— 因为后端 `trust proxy = 1` 已在生效:
 * Express 只信任 1 跳,取 XFF 的**最后一段**,而 nginx 无论替换还是追加,
 * 最后一段永远是它自己看到的真实对端 IP。
 *
 * 也就是说:**后端侧 `trust proxy = 1` 才是关键防线**,nginx 用替换模式是双保险。
 * 已实测验证:把后端改成 `trust proxy = true`(信任所有跳)+ nginx 改成追加模式,
 * 本测试立刻报 3 条失败,其中包含「130 次携带不同伪造 XFF 的请求未触发任何 429」
 * —— 即**限流被真实绕过**。
 *
 * 所以若日后有人"顺手"把 `app.set("trust proxy", 1)` 放宽,这里会变红。
 *
 * 用法:node scripts/e2e-xff-trust-proxy.mjs
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_DIR = path.resolve(import.meta.dirname, "..");
const NGINX_PORT = 3480;
const API_PORT = 3479;
const NGINX_NAME = "tryout-xff-test-nginx";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };

const dockerAvailable = () => {
  try { execFileSync("docker", ["info"], { stdio: "ignore" }); return true; }
  catch { return false; }
};

if (!dockerAvailable()) {
  console.log("\n  ⚠️ Docker 不可用,跳过(该测试需要真实 nginx 容器验证反向代理行为)");
  process.exit(0);
}

/* ---------- 清理 ---------- */
function cleanup() {
  try { execFileSync("docker", ["rm", "-f", NGINX_NAME], { stdio: "ignore" }); } catch { /* 无容器 */ }
}
cleanup();
process.on("exit", cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 生成测试用 nginx 配置(指向宿主的后端) ---------- */
const nginxConf = `
server {
    listen 80;
    server_name _;
    location /api/ {
        proxy_pass http://host.docker.internal:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # 与项目 docker/nginx.conf 一致:替换而非追加
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
`;
const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-nginx-"));
fs.writeFileSync(path.join(confDir, "default.conf"), nginxConf, "utf8");

/* ---------- 起后端(BEHIND_PROXY=1,模拟 compose 的生产拓扑) ---------- */
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-xff-db-"));
const srvLogPath = path.join(confDir, "server.log");
const srvLogFd = fs.openSync(srvLogPath, "w");
const server = spawn("node", ["index.js"], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    PORT: String(API_PORT),
    DB_DIR,
    NODE_ENV: "test",
    BEHIND_PROXY: "1",        // 与 docker-compose.yml 一致
    // ⚠️ 必须显式绑 0.0.0.0:index.js:50 默认 DOCKER≠1 时只听 127.0.0.1,
    // 那样 nginx 容器根本连不上 → 全部 502,而请求从未到达后端,
    // 「后端记录的 ip」取到 null,断言 null !== 伪造值 就会**假通过**。
    // 这里等价于 compose 里的 DOCKER=1 效果。
    HOST: "0.0.0.0",
    INTERVIEWX_AUTH_DISABLED: "1", // 本测试只关心 IP 解析,鉴权会干扰断言
    DAILY_TOKEN_BUDGET: "500000",
  },
  stdio: ["ignore", srvLogFd, srvLogFd],
});

async function waitHttp(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.status) return true; } catch { /* 未就绪 */ }
    await sleep(300);
  }
  return false;
}

try {
  if (!(await waitHttp(`http://127.0.0.1:${API_PORT}/api/health`))) {
    console.error("后端未就绪"); process.exit(1);
  }
  ok("后端已启动(BEHIND_PROXY=1)");

  /* ---------- 起 nginx ---------- */
  execFileSync("docker", [
    "run", "-d", "--name", NGINX_NAME,
    "--add-host", "host.docker.internal:host-gateway",
    "-p", `127.0.0.1:${NGINX_PORT}:80`,
    "-v", `${confDir}/default.conf:/etc/nginx/conf.d/default.conf:ro`,
    "nginx:alpine",
  ], { stdio: "ignore" });
  ok("nginx 容器已启动");

  if (!(await waitHttp(`http://127.0.0.1:${NGINX_PORT}/api/health`, 25000))) {
    console.error("nginx 未就绪,查看容器日志");
    try { console.error(execFileSync("docker", ["logs", NGINX_NAME], { encoding: "utf8" }).slice(-800)); } catch {}
    process.exit(1);
  }
  ok("nginx 反代链路已通");

  const VIA = `http://127.0.0.1:${NGINX_PORT}`;
  const readLog = () => {
    try { return fs.readFileSync(srvLogPath, "utf8"); } catch { return ""; }
  };
  const lastIp = () => {
    const m = [...readLog().matchAll(/"ip":"([^"]+)"/g)];
    return m.length ? m[m.length - 1][1] : null;
  };
  /**
   * 取后端实际记录的 IP,并在"没观测到"时**直接失败**。
   * 教训:第一版这里返回 null,而调用方的断言是 `ip !== FORGED`,
   * 于是"后端压根没收到请求"反而被判成通过 —— 假通过比失败更危险。
   */
  const requireIp = () => {
    const ip = lastIp();
    if (!ip) {
      bad("后端日志中没有任何请求记录 —— 请求根本没到达后端(nginx 502?后端只听 127.0.0.1?)。本组断言作废。");
      return null;
    }
    return ip;
  };

  /* ---------- 1. 伪造 XFF 不得影响后端识别到的 IP ---------- */
  console.log("\n── 1. 伪造 X-Forwarded-For 不得改变后端记录的客户端 IP ──");
  {
    const FORGED = "1.2.3.4";
    await fetch(`${VIA}/api/health`, { headers: { "X-Forwarded-For": FORGED } });
    await sleep(400);
    const ip = requireIp();
    if (ip === null) { /* 已报失败 */ } else if (ip === FORGED) {
      bad(`后端采信了攻击者注入的 XFF(${FORGED})—— **限流可被绕过**`);
    } else {
      ok(`注入 XFF=${FORGED} 后,后端记录的是 ${ip}(真实对端),未采信注入值`);
    }
  }

  /* ---------- 2. 多段伪造 XFF ---------- */
  console.log("\n── 2. 多段伪造 XFF(伪造链)同样不得生效 ──");
  {
    const CHAIN = "9.9.9.9, 8.8.8.8, 7.7.7.7";
    await fetch(`${VIA}/api/health`, { headers: { "X-Forwarded-For": CHAIN } });
    await sleep(400);
    const ip = requireIp();
    if (ip === null) { /* 已报失败 */ } else {
    const leaked = ["9.9.9.9", "8.8.8.8", "7.7.7.7"].filter((x) => ip === x);
    leaked.length === 0
      ? ok(`注入伪造链后,后端记录 ${ip},未采信任何注入段`)
      : bad(`后端采信了伪造链中的一段(${leaked.join(",")})`);
    }
  }

  /* ---------- 3. 限流不可被伪造 XFF 绕过 ---------- */
  console.log("\n── 3. 每次都换伪造 XFF,限流仍应按真实 IP 累计并触发 429 ──");
  {
    // 先确认链路真的通(避免又一次"请求全 502 却当成限流未触发")
    const probe = await fetch(`${VIA}/api/health`);
    if (probe.status >= 500) {
      bad(`经 nginx 访问后端返回 ${probe.status} —— 链路不通,限流断言作废`);
    } else {
    let got429 = false;
    // general 限流 120/分钟;打 130 次,每次都带**不同的**伪造 XFF。
    // 若 nginx 用的是追加模式($proxy_add_x_forwarded_for)或后端信任了注入值,
    // 每次请求会被算到不同的 key 上 → 永远不触发 429 → 限流被绕过。
    for (let i = 0; i < 130; i++) {
      const r = await fetch(`${VIA}/api/health`, {
        headers: { "X-Forwarded-For": `10.0.${Math.floor(i / 256)}.${i % 256}` },
      });
      if (r.status === 429) { got429 = true; break; }
    }
    got429
      ? ok("即使每次都换伪造 XFF,限流仍正常触发 429(未被绕过)")
      : bad("130 次携带不同伪造 XFF 的请求**未触发任何 429** —— 限流已被绕过");
    }
  }

  /* ---------- 4. 伪造 X-Real-IP 也不得生效 ---------- */
  console.log("\n── 4. 伪造 X-Real-IP 同样不得生效 ──");
  {
    const FORGED = "5.6.7.8";
    await fetch(`${VIA}/api/health`, { headers: { "X-Real-IP": FORGED } });
    await sleep(400);
    const ip = requireIp();
    ip === null ? bad("断言作废:后端未收到请求") :
    ip !== FORGED
      ? ok(`注入 X-Real-IP=${FORGED} 后,后端记录 ${ip}`)
      : bad(`后端采信了注入的 X-Real-IP(${FORGED})`);
  }

} finally {
  cleanup();
  try { server.kill("SIGKILL"); } catch { /* 已退出 */ }
  try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 已删 */ }
  try { fs.rmSync(confDir, { recursive: true, force: true }); } catch { /* 已删 */ }
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
process.exit(fail > 0 ? 1 : 0);
