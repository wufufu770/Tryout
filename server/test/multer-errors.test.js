// 单元测试:multer 上传错误必须映射为客户端错误码(ISSUE-012)
//
// ## 背景(2026-10-04 R4 实测发现)
// 全局错误处理器 `index.js` 原本处理了 ValidationErrors / SsrfBlockedError /
// ValidationError / NotFoundError 四类,**唯独没有 `MulterError`**。
// multer 的 `LIMIT_FILE_SIZE` 错误不带 `err.status`,于是落到兜底的
// `const status = err.status || 500` → **500 服务器内部错误**。
//
// 实测:上传 25MB 文件(限 20MB),NODE_ENV=production 下返回
//   {"ok":false,"code":"INTERNAL_ERROR","message":"服务器内部错误"}  HTTP 500
// 并在日志里记成 `request.error` —— 客户端的一次误操作被误报成服务故障。
//
// 修复:错误处理器新增 multer.MulterError 分支,LIMIT_FILE_SIZE → 413,其余 → 400。
// 本文件锁死"客户端上传错误不得返回 5xx"这一不变量。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 起一个隔离的服务实例 */
async function withServer(fn) {
  const PORT = 3400 + Math.floor(Math.random() * 300);
  const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-multer-"));
  const child = spawn("node", ["index.js"], {
    cwd: SERVER_DIR,
    // 用 production 才能验证"生产模式下用户看到什么"
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
      PORT: String(PORT), DB_DIR, NODE_ENV: "production",
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
    if (!up) throw new Error(`服务未就绪:\n${log.slice(-1000)}`);
    const TOKEN = fs.readFileSync(path.join(DB_DIR, ".api_token"), "utf8").trim();
    return await fn({ BASE, TOKEN, getLog: () => log });
  } finally {
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
    try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 已删 */ }
  }
}

test("上传超限文件返回 413 而非 500(ISSUE-012 回归)", async () => {
  await withServer(async ({ BASE, TOKEN }) => {
    const fd = new FormData();
    // 25MB > 20MB 限制
    fd.append("file", new Blob([Buffer.alloc(25 * 1024 * 1024, 0x41)], { type: "text/plain" }), "big.txt");
    const r = await fetch(`${BASE}/api/materials/upload`, {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: fd,
    });
    const j = await r.json().catch(() => null);
    assert.notEqual(r.status, 500, `超限上传返回了 500:${JSON.stringify(j)}`);
    assert.equal(r.status, 413, `期望 413(Payload Too Large),实际 ${r.status}:${JSON.stringify(j)}`);
    assert.equal(j?.code, "VALIDATION_ERROR");
    assert.equal(j?.multerCode, "LIMIT_FILE_SIZE");
    // 生产模式下也必须给出可操作的原因,而不是"服务器内部错误"
    assert.notEqual(j?.message, "服务器内部错误", "生产模式下未给出可操作提示");
    assert.match(j?.message || "", /体积|上限|压缩/, `提示不可操作:${j?.message}`);
  });
});

test("上传超限文件不得被记为 request.error(避免监控误报警)", async () => {
  await withServer(async ({ BASE, TOKEN, getLog }) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.alloc(25 * 1024 * 1024, 0x41)], { type: "text/plain" }), "big.txt");
    await fetch(`${BASE}/api/materials/upload`, {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: fd,
    });
    // 给日志一点落盘时间
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(
      !getLog().includes("request.error"),
      `客户端上传错误被记为 request.error,会触发监控误报警:\n${getLog().slice(-500)}`,
    );
  });
});

test("非预期的文件字段名返回 400 而非 500", async () => {
  await withServer(async ({ BASE, TOKEN }) => {
    const fd = new FormData();
    // 路由期望字段名是 "file",这里故意用别的
    fd.append("wrongField", new Blob([Buffer.from("x".repeat(2048))], { type: "text/plain" }), "a.txt");
    const r = await fetch(`${BASE}/api/materials/upload`, {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: fd,
    });
    const j = await r.json().catch(() => null);
    assert.ok(r.status < 500, `字段名错误返回了 ${r.status}:${JSON.stringify(j)}`);
    assert.equal(j?.multerCode, "LIMIT_UNEXPECTED_FILE");
  });
});

test("正常大小文件仍应成功(确认修复未误伤正常路径)", async () => {
  await withServer(async ({ BASE, TOKEN }) => {
    const fd = new FormData();
    const text = "这是一份用于测试上传链路的简历内容,长度足够。".repeat(20);
    fd.append("file", new Blob([Buffer.from(text)], { type: "text/markdown" }), "resume.md");
    fd.append("type", "resume");
    const r = await fetch(`${BASE}/api/materials/upload`, {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: fd,
    });
    const j = await r.json().catch(() => null);
    assert.equal(r.status, 200, `正常上传被误伤:${r.status}:${JSON.stringify(j)}`);
    assert.ok(j?.data?.rawText?.length > 10);
  });
});
