#!/usr/bin/env node
/*
 * e2e:PII 是否会经由**上游报错**路径落进服务端日志(守卫 ISSUE-043)
 *
 * ## 为什么需要这条测试
 * ISSUE-026 修过一次"明文 PII 被写入服务端日志",做法是在 `sendRequest` 入口
 * 把 `piiMatches` 从 ctx 剥出来、生成只含 `piiMatchCount` 的 `logCtx`,
 * 并把该函数内的 logger 逐个改成展开 `logCtx`。
 *
 * `e2e-pii-attack.mjs` 也确实会 grep 服务端日志、断言"无明文手机号"。
 * 但它用的是**正常返回 200 的 mock 上游** ——
 * `llm.js:377` 那处 `logger.warn("llm.upstream.error", { ...ctx })`
 * 只在 `!resp.ok` 分支里才执行,而 mock 从不返回非 2xx,
 * **那处 logger 一次都没被跑到**。于是 ISSUE-026 的修复漏网整整 6 轮。
 *
 * 这与 ISSUE-042(`logCtx` 未定义)、ISSUE-040/041 是**同一个失败路径盲区**:
 * 一切只在"上游出错"时才执行的代码,都没有被测试覆盖。
 *
 * ## 本脚本怎么做到
 * 起一个**恒返 500** 的本地 mock 上游,发一条含手机号+邮箱的消息,
 * 然后 grep 服务端日志。本地 mock ⇒ 零 token 成本,100% 真实路径。
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// R56:诊断信息安全格式化 —— JSON.stringify(undefined) 不是字符串,`.slice` 会崩
import { brief } from "./lib/brief.mjs";

const PORT = 3465;
const DB = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-pii-upstream-err-"));
const BASE = `http://127.0.0.1:${PORT}`;
const PHONE = "13800008888";
const EMAIL = "pii-upstream-err-probe@example.com";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };

// 上游恒返 500:目的就是走 llm.js 的 !resp.ok 分支
const upstream = http.createServer((req, res) => {
  req.resume();
  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "upstream boom" } }));
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const UP_PORT = upstream.address().port;

let log = "";
let child = null;
function cleanup() {
  try { child?.kill("SIGKILL"); } catch { /* 已退出 */ }
  try { upstream.close(); } catch { /* 已关闭 */ }
  try { fs.rmSync(DB, { recursive: true, force: true }); } catch { /* 临时目录 */ }
}
process.on("exit", cleanup);

child = spawn("node", ["index.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DB_DIR: DB, NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => { log += d; });
child.stderr.on("data", (d) => { log += d; });

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { /* 未就绪 */ }
  if (!up) await new Promise((r) => setTimeout(r, 300));
}
if (!up) { console.error("服务未能启动"); cleanup(); process.exit(1); }

const TOKEN = fs.readFileSync(path.join(DB, ".api_token"), "utf8").trim();
const H = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
console.log(`\n  上游(mock 恒 500):127.0.0.1:${UP_PORT}`);

// 造一个指向该 mock 的本地供应商
const p = await (await fetch(`${BASE}/api/providers`, {
  method: "POST", headers: H,
  body: JSON.stringify({ name: "PII-Probe-500", category: "local", baseUrl: `http://127.0.0.1:${UP_PORT}/v1`, apiFormat: "openai_chat" }),
})).json();
const pid = p?.data?.providerId;
if (!pid) { console.error("建供应商失败:", brief(p, 200)); cleanup(); process.exit(1); }

// 发一条含明文 PII 的消息
const r = await fetch(`${BASE}/api/chat`, {
  method: "POST", headers: H,
  body: JSON.stringify({ provider: pid, messages: [{ role: "user", content: `我的手机号是 ${PHONE},邮箱 ${EMAIL}` }], stream: false }),
});
const st = r.status;
await new Promise((x) => setTimeout(x, 800));

console.log(`  /api/chat 返回 HTTP ${st}(预期非 2xx,证明确实打到了 !resp.ok 分支)`);
console.log("\n── 服务端日志判定 ──");
log.includes(PHONE)
  ? bad(`**服务端日志中出现明文手机号 ${PHONE}** —— 违反 llm.js 的不写日志声明`)
  : ok("服务端日志中无明文手机号");
log.includes(EMAIL)
  ? bad(`**服务端日志中出现明文邮箱 ${EMAIL}**`)
  : ok("服务端日志中无明文邮箱");

// 确认这条断言**不是**因为压根没走到那处 logger
const hit = log.split("\n").filter((l) => l.includes("upstream.error"));
hit.length
  ? ok(`已实际触发 llm.upstream.error(共 ${hit.length} 行)—— 断言覆盖到了真实路径`)
  : bad("日志里没有 llm.upstream.error —— 本测试没覆盖到目标分支,绿得没有意义");
if (hit.length) {
  try {
    const fields = Object.keys(JSON.parse(hit[0]));
    fields.includes("piiMatches")
      ? bad("llm.upstream.error 仍展开了 piiMatches(明文映射整包进日志)", fields.join(","))
      : ok(`llm.upstream.error 字段无 piiMatches(${fields.slice(0, 6).join(",")}…)`);
    fields.includes("piiMatchCount")
      ? ok("保留了 piiMatchCount(条数可观测,不含明文)")
      : console.log(`     ℹ 该分支无 piiMatchCount(${fields.join(",")})`);
  } catch { /* 日志行非 JSON */ }
}

cleanup();
console.log(`\n${"=".repeat(58)}`);
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log(`${"=".repeat(58)}\n`);
process.exit(fail > 0 ? 1 : 0);
