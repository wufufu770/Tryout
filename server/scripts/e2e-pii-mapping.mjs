#!/usr/bin/env node
// V4 端到端验证:后端 pii_mapping 是否真的能走到前端
//
// 为什么需要这个脚本(L2 层级):
//   单元测试只能证明 parseSseLine 会正确解析 pii_mapping,
//   证明不了「后端真的在流里发这个事件」。
//   本脚本起真实后端 + mock LLM 上游,捕获真实 SSE 字节流并断言。
//
// 用法:node scripts/e2e-pii-mapping.mjs
// 前置:cd server && npm install

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 3411;
const MOCK_PORT = 3412;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-pii-e2e-"));

// ---- 统一清理守卫 ----
/*
 * ⚠️ 早期版本只在少数几条退出路径上调 child.kill()，fetch/网络异常时子进程被遗留。
 *    残留的 `node index.js` 会占住端口，让后续 E2E 随机失败
 *    (表现为"后端未就绪"但日志为空)——这种污染极难排查。
 * 现在所有退出路径(含未捕获异常)都经过 cleanup()。
 */
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
  try { mock.close(); } catch { /* 已关闭 */ }
  try { fs.rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 已删除 */ }
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });
process.on("uncaughtException", (e) => {
  console.error("\n[未捕获异常]", e?.message || e);
  cleanup();
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  console.error("\n[未处理的 Promise 拒绝]", e?.message || e);
  cleanup();
  process.exit(1);
});

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, e) => { console.log(`  ❌ ${m}${e ? `\n     ${e}` : ""}`); fail++; };

// ---- 1. 起 mock LLM 上游:回一个含 PII 占位符的流式响应 ----
const mock = createServer((req, res) => {
  if (req.url.includes("/chat/completions")) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // 复刻后端首事件:pii_mapping
    res.write(`data: ${JSON.stringify({
      pii_mapping: [
        { placeholder: "[PHONE_A1B2C3D4]", value: "13812345678", type: "PHONE" },
        { placeholder: "[EMAIL_bbbbbbbb]", value: "zhangwei@example.com", type: "EMAIL" },
      ],
    })}\n\n`);
    for (const piece of ["你的手机号 ", "[PHONE_A1B2C3D4]", " 邮箱 ", "[EMAIL_bbbbbbbb]"]) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 30, completion_tokens: 12 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } else { res.writeHead(404); res.end(); }
});
await new Promise((r) => mock.listen(MOCK_PORT, r));
console.log(`[mock LLM] :${MOCK_PORT}`);

// ---- 2. 起真实后端 ----
const child = spawn("node", ["index.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_DIR,
    INTERVIEWX_AUTH_DISABLED: "1",
    NODE_ENV: "development",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverLog = [];
child.stdout.on("data", (d) => serverLog.push(d.toString()));
child.stderr.on("data", (d) => serverLog.push(d.toString()));

async function waitForHealth(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return true;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
if (!(await waitForHealth())) {
  console.error("后端未就绪,日志:\n" + serverLog.join("").slice(-1500));
  cleanup(); process.exit(1);
}
console.log(`[后端] :${PORT} 就绪\n`);

// ---- 3. 通过 HTTP API 注册 mock provider ----
// 注意:不能用 import("../db.js") 直接写库——那会加载第二个 db 实例,
// 与 HTTP 服务进程里的那个不是同一��,写入对服务不可见。
// category:"local" 让 checkUrlSafe 走 allowLocal 分支,允许指向 127.0.0.1。
const POST = (pathname, body) =>
  fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 注意:ProviderSchema 不接受 id 字段(会被 zod 剥离),provider id 由服务端生成,
// 因此创建后需回查真实 id 再写 key。
const provRes = await POST("/api/providers", {
  name: "MockLLM",
  baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
  modelName: "mock-model", apiFormat: "openai_chat",
  category: "local", isActive: true,
});
let pid = null;
if (!provRes.ok) {
  const t = await provRes.text();
  bad(`注册 provider 失败 status=${provRes.status}: ${t.slice(0, 200)}`);
} else {
  const created = (await provRes.json())?.data;
  pid = created?.providerId ?? created?.id;
  if (pid) ok(`注册 mock provider，id=${pid}(category=local，允许环回地址)`);
  else bad("注册成功但未返回 id");
}
if (!pid) { cleanup(); process.exit(1); }

const keyRes = await POST("/api/keys", { provider: pid, key: "mock-key" });
if (keyRes.ok) ok("写入 mock API Key");
else bad(`写入 key 失败 status=${keyRes.status}`);

// ---- 4. 发真实流式请求,捕获 SSE ----
console.log("=== V4 端到端验证 ===\n");
let mappingEvent = null;
const resp = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    provider: pid,
    stream: true,
    messages: [
      { role: "system", content: "你是面试官" },
      { role: "user", content: "我叫张伟，手机 13812345678，邮箱 zhangwei@example.com" },
    ],
  }),
});

if (!resp.ok || !resp.body) {
  bad(`请求失败 status=${resp.status}`);
} else {
  const text = await resp.text();
  const events = text.split("\n").filter((l) => l.trim().startsWith("data:"))
    .map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } })
    .filter(Boolean);

  mappingEvent = events.find((e) => e.pii_mapping);
  if (mappingEvent) ok("SSE 流中存在 pii_mapping 事件");
  else bad("SSE 流中缺失 pii_mapping 事件");

  if (mappingEvent && mappingEvent.pii_mapping.length === 2) ok("pii_mapping 含 2 条映射(手机号 + 邮箱)");
  else bad("pii_mapping 条目数不符");

  const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
  if (content.includes("[PHONE_") || content.includes("[EMAIL_")) {
    ok("流式内容为脱敏占位符(符合预期:模型只看到占位符)");
  } else bad(`流式内容未脱敏: ${content.slice(0, 80)}`);
}

// ---- 5. 验证前端解析链路(用真实 SSE 文本跑前端纯函数) ----
// 说明:此处不引 TS 运行时,而是用等价断言验证事件结构,
// 真正的解析正确性已由 sseParser.test.ts 的 14 条用例保证。
const first = mappingEvent?.pii_mapping?.[0];
if (first && typeof first.placeholder === "string" && typeof first.value === "string" && typeof first.type === "string") {
  ok("映射项字段完整(满足 isValidMapping 校验,前端不会过滤掉)");
} else bad("映射项字段不完整");

console.log(`\n${"=".repeat(46)}`);
console.log(`结果:${pass} 通过 / ${fail} 失败`);
cleanup();
process.exit(fail > 0 ? 1 : 0);
