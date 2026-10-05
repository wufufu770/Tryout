// 单元测试:/api/log 的鉴权与日志注入防护
//
// ## 背景
// R2 曾误判「`/api/log` 无鉴权」——实打请求后确认**有**鉴权(index.js:415 在 index.js:359 之后,
// `app.use` 中间件对之后注册的所有路由生效)。但:
//
//   1. 那次结论只存在于对话里,**没有任何测试锁定**;
//      一旦有人把该路由移到鉴权中间件之前,不会有任何测试变红。
//   2. 该路由的**日志注入防护**(字段白名单、长度截断)同样零测试。
//
// 本文件把两者都锁死。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function withServer(fn) {
  const PORT = 3700 + Math.floor(Math.random() * 200);
  const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-log-"));
  const child = spawn("node", ["index.js"], {
    cwd: SERVER_DIR,
    // ⚠️ R29(ISSUE-059):必须**显式**清掉调用方可能设的认证开关,不能靠 `...process.env` 继承。
    //   1) INTERVIEWX_AUTH_DISABLED=1 时子服务完全跳过认证(auth.js:56),
    //      既不生成 .api_token,所有受保护路由又一律 200 ——
    //      于是本文件里"错误 token 必须被拒 401""有效 token 能上报"这类断言**全部反向**;
    //   2) INTERVIEWX_API_TOKEN 一旦被继承,auth.js:76 的 `else if (tokens.size === 0)` 不成立,
    //      同样不会写 .api_token,后面 readFileSync 直接 ENOENT。
    //   build.sh:282 给整个测试进程设了 INTERVIEWX_AUTH_DISABLED=1,
    //   本文件因此在门禁里稳定产出 10 条**假失败**,而单独 `npm test` 是全绿的。
    //   → 子服务的认证配置属于本测试的**前提**,不该由外部环境决定。

    env: {
      ...process.env,
      PORT: String(PORT), DB_DIR, NODE_ENV: "test",
      INTERVIEWX_AUTH_DISABLED: "",   // 强制开启认证
      INTERVIEWX_API_TOKEN: "",      // 强制走"生成 .api_token"分支
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const BASE = `http://127.0.0.1:${PORT}`;
  try {
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 15000) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) { up = true; break; } } catch { /* 未就绪 */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!up) throw new Error(`服务未就绪:\n${log.slice(-800)}`);
    const TOKEN = fs.readFileSync(path.join(DB_DIR, ".api_token"), "utf8").trim();
    return await fn({ BASE, TOKEN, getLog: () => log });
  } finally {
    try { child.kill("SIGKILL"); } catch { /* 已删 */ }
    try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 已删 */ }
  }
}

const post = (BASE, TOKEN, body) =>
  fetch(`${BASE}/api/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });

test("R-001 回归锁定:无 token 上报日志必须被拒 401", async () => {
  await withServer(async ({ BASE, getLog }) => {
    const r = await post(BASE, null, { level: "info", msg: "unauth-probe-should-not-appear" });
    assert.equal(r.status, 401, `无 token 上报日志返回 ${r.status},应为 401`);
    await new Promise((res) => setTimeout(res, 200));
    assert.ok(
      !getLog().includes("unauth-probe-should-not-appear"),
      "未鉴权的日志内容竟被写入了 —— 存在日志注入/污染面",
    );
  });
});

test("错误 token 上报日志必须被拒 401", async () => {
  await withServer(async ({ BASE }) => {
    const r = await post(BASE, "wrong-token-000", { level: "info", msg: "x" });
    assert.equal(r.status, 401);
  });
});

test("有效 token 可正常上报", async () => {
  await withServer(async ({ BASE, TOKEN, getLog }) => {
    const r = await post(BASE, TOKEN, { level: "info", msg: "authorized-probe-ok" });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 200));
    assert.ok(getLog().includes("authorized-probe-ok"), "有效 token 的日志未落盘");
  });
});

test("日志注入防护:非白名单字段被丢弃", async () => {
  await withServer(async ({ BASE, TOKEN, getLog }) => {
    await post(BASE, TOKEN, {
      level: "info",
      msg: "whitelist-probe",
      fields: {
        url: "https://example.com/a",           // 白名单内 → 应保留
        __proto__: { polluted: true },           // 攻击:原型污染
        constructor: "evil",                     // 攻击
        evilField: "SHOULD-BE-DROPPED-MARKER",  // 非白名单 → 应丢弃
      },
    });
    await new Promise((res) => setTimeout(res, 200));
    const log = getLog();
    assert.ok(!log.includes("SHOULD-BE-DROPPED-MARKER"),
      `非白名单字段被写入了日志:\n${log.slice(-400)}`);
    assert.equal(({}).polluted, undefined, "原型污染成功");
  });
});

test("日志注入防护:msg 被截断到 500 字符", async () => {
  await withServer(async ({ BASE, TOKEN, getLog }) => {
    const huge = "A".repeat(5000) + "TAIL-MARKER";
    await post(BASE, TOKEN, { level: "info", msg: huge });
    await new Promise((res) => setTimeout(res, 200));
    const log = getLog();
    assert.ok(!log.includes("TAIL-MARKER"), "超长 msg 未被截断(日志膨胀/注入面)");
  });
});

test("日志注入防护:非法 level 归一为 info", async () => {
  await withServer(async ({ BASE, TOKEN, getLog }) => {
    // 非法 level 若被原样接受,可伪造日志级别干扰排查
    await post(BASE, TOKEN, { level: "fatal\n伪造级别", msg: "level-probe-ok" });
    await new Promise((res) => setTimeout(res, 200));
    const log = getLog();
    assert.ok(log.includes("level-probe-ok"), "请求未生效");
    // 换行注入会让伪造行看起来像独立的 error 日志
    assert.ok(!/fatal\n伪造级别/.test(log), "非法 level 被原样写入,可伪造换行注入");
  });
});
