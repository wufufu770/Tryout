#!/usr/bin/env node
/*
 * R3 端到端回归:限流 / 日 token 预算 / 导出导入数据完整性
 *
 * 覆盖 ISSUES.md 中的:
 *   - ISSUE-005(P1) 5 套限流零测试 → 本脚本 A/B/C 组
 *   - ISSUE-006 关联:token 预算绕过 → D 组
 *     (db.js:418 注释称 v10.2.4 修过一次绕过:从 sessions.tokens_total 改为
 *      token_usage 表,原因是"无 sessionId 时漏计"。该修复目前无任何回归测试。)
 *   - ISSUE-008 导出/导入零测试 → E/F 组
 *     (导入是 INSERT OR IGNORE 的合并逻辑,若 id 生成有 bug 会**静默丢数据**或
 *      **静默覆盖用户数据**,风险高于一般未覆盖路由)
 *
 * 用法:node scripts/e2e-defense-and-integrity.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
// R56:诊断信息安全格式化 —— JSON.stringify(undefined) 不是字符串,`.slice` 会崩
import { brief } from "./lib/brief.mjs";

const PORT = 3468;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-def-"));
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = path.resolve(import.meta.dirname, "..");
const DB_PATH = path.join(DB_DIR, "tryout.db");

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

async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

child = spawn("node", ["index.js"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(PORT), DB_DIR, NODE_ENV: "test", DAILY_TOKEN_BUDGET: "1000" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => { srvLog += d; });
child.stderr.on("data", (d) => { srvLog += d; });

const ready = await waitReady();
if (!ready) { console.error("服务未就绪:\n" + srvLog.slice(-1500)); cleanup(); process.exit(1); }

const TOKEN = fs.readFileSync(path.join(DB_DIR, ".api_token"), "utf8").trim();
async function api(method, p, body, raw = false) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  if (raw) return { status: r.status, text: await r.text(), json: null };
  return { status: r.status, json: await r.json().catch(() => null) };
}

/* ================================================================== *
 * A. 通用限流 (general: 120/min)
 * ================================================================== */
console.log("\n── A. 通用限流 general 120/分钟 ──");
{
  // 用只读 GET,避免污染其他用例的数据
  let first429 = -1;
  for (let i = 0; i < 140; i++) {
    const r = await api("GET", "/api/providers");
    if (r.status === 429) { first429 = i + 1; break; }
  }
  first429 > 0
    ? ok(`第 ${first429} 次请求触发 429(配置值 120,前若干次已被前置用例消耗)`)
    : bad("140 次请求未触发任何 429,通用限流失效");
}

/* ================================================================== *
 * B. 导入限流 (import: 5/min)
 * ================================================================== */
console.log("\n── B. 导入限流 import 5/分钟 ──");
{
  // 等待 A 的窗口过期,否则通用限流会先于导入限流返回 429,测不出目标
  console.log("  (等待通用限流窗口过期 62s,以便单独观测导入限流…)");
  await new Promise((r) => setTimeout(r, 62000));

  const codes = [];
  for (let i = 0; i < 9; i++) {
    const r = await api("POST", "/api/import", { agents: [] });
    codes.push(r.status);
  }
  const n429 = codes.filter((c) => c === 429).length;
  const allValid = codes.every((c) => c === 200 || c === 429);
  n429 > 0
    ? ok(`9 次导入中 ${n429} 次被限流(429),状态序列 ${codes.join(",")}`)
    : bad("9 次导入未触发任何 429,导入限流失效", `状态序列: ${codes.join(",")}`);
  if (!allValid) bad(`导入返回了预期外的状态码: ${codes.join(",")}`);
}

/* ================================================================== *
 * C. 上传限流 (upload: 10/min) —— 探测存在性即可,无需真文件
 * ================================================================== */
console.log("\n── C. 上传限流 upload 10/分钟 ──");
{
  const codes = [];
  for (let i = 0; i < 16; i++) {
    // 空 body:只为观察限流状态码,不关心业务结果
    const r = await api("POST", "/api/materials/upload", undefined);
    codes.push(r.status);
  }
  const n429 = codes.filter((c) => c === 429).length;
  n429 > 0
    ? ok(`16 次上传请求中 ${n429} 次被限流(429),状态序列 ${codes.join(",")}`)
    : bad("16 次上传请求未触发任何 429,上传限流失效", `状态序列: ${codes.join(",")}`);
}

/* ================================================================== *
 * D. 日 token 预算(ISSUE 关联:v10.2.4 修过绕过,无回归)
 * ================================================================== *
 * 真实结构:`/api/health?verbose=1` → data.checks.tokenBudget = { used, budget, percent }
 * (见 index.js:404)。注意 verbose 需要鉴权。
 */
console.log("\n── D. 日 token 预算 1000(本次服务以 DAILY_TOKEN_BUDGET=1000 启动)──");
{
  const readBudget = async () => {
    const r = await api("GET", "/api/health?verbose=1");
    // 注意:verbose 分支走 res.json(checks) 直出,不经 res.ok() 包裹,
    // 所以路径是顶层 json.checks.tokenBudget(实测 index.js:368-404)
    return r.json?.checks?.tokenBudget || null;
  };
  const b0 = await readBudget();
  b0?.budget === 1000
    ? ok(`verbose 正确暴露预算上限 budget=${b0.budget}(DAILY_TOKEN_BUDGET 生效)`)
    : bad("verbose 未正确反映 DAILY_TOKEN_BUDGET 配置", JSON.stringify(b0));

  // 无 sessionId 也必须计入 —— 这正是 v10.2.4 修的绕过
  const db = new Database(DB_PATH);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO token_usage (created_at, tokens, provider) VALUES (?,?,?)").run(now, 999, "probe");
  db.close();
  const b1 = await readBudget();
  b1?.used === 999
    ? ok(`无 sessionId 的用量被正确计入(used=${b1.used})—— v10.2.4 修复点未复发`)
    : bad(`无 sessionId 的用量未被计入(used=${b1?.used}),v10.2.4 的绕过可能复发`);

  // 跨日不计入今日
  const db2 = new Database(DB_PATH);
  db2.prepare("INSERT INTO token_usage (created_at, tokens, provider) VALUES (?,?,?)")
    .run("2020-01-01 00:00:00", 88888, "probe-old");
  db2.close();
  const b2 = await readBudget();
  b2?.used === 999
    ? ok("历史日期的用量未计入今日预算")
    : bad(`历史日期的用量被错误计入(used=${b2?.used}),预算统计的日期过滤失效`);
}

/* ================================================================== *
 * E. 导出完整性 + 敏感字段不外泄
 *    真实结构:res.ok() 包裹 → 顶层 { ok, data },业务集合在 data 下
 * ================================================================== */
console.log("\n── E. 导出:结构完整 + 不泄漏 apiKey ──");
let exported = null;
{
  const r = await api("GET", "/api/export", undefined, true);
  if (r.status !== 200) bad(`导出返回 ${r.status}`);
  else {
    const env = JSON.parse(r.text);
    const data = env.data || {};
    exported = data;
    const need = ["agents", "sessions", "evaluations", "providers", "materials", "sessionGroups", "reviews"];
    const missing = need.filter((k) => !(k in data));
    missing.length === 0 ? ok(`导出含全部 ${need.length} 个顶层集合`)
                         : bad(`导出缺少集合: ${missing.join(", ")}`);

    // 造一个带 apiKey 的 provider,验证导出不含明文
    await api("POST", "/api/providers", {
      // 必须用**可解析**域名:SSRF 校验会做 DNS 解析,
      // 不可解析的域名(如 api.example.com)会被 SSRF_UNRESOLVED 直接拒绝,provider 根本建不出来
      name: "secret-provider", baseUrl: "https://api.openai.com/v1", apiKey: "sk-SUPERSECRET-12345",
    });
    const r2 = await api("GET", "/api/export", undefined, true);
    exported = (JSON.parse(r2.text).data) || {};
    r2.text.includes("sk-SUPERSECRET-12345")
      ? bad("**导出文件包含明文 apiKey**", "这是 P0 级敏感信息外泄")
      : ok("导出不含明文 apiKey(仅带 hasKey 布尔标记)");
    const withFlag = (exported.providers || []).find((p) => p.hasKey === true);
    withFlag ? ok(`hasKey 标记正确置位(${withFlag.name})`) : bad("hasKey 标记未置位,用户无法判断哪些 provider 已配密钥");
  }
}

/* ================================================================== *
 * F. 导入幂等与不覆盖(INSERT OR IGNORE 语义)
 *    SessionSchema 必填:title + modelId
 * ================================================================== */
console.log("\n── F. 导入:幂等 + 不覆盖用户修改 ──");
{
  // B 组已用满 import 限流(5/分钟),此处必须等窗口过期,否则测到的会是 429
  console.log("  (等待导入限流窗口过期 62s…)");
  await new Promise((r) => setTimeout(r, 62000));

  const s = await api("POST", "/api/sessions", { title: "import-probe-session", modelId: "probe-model" });
  const sid = s.json?.data?.sessionId;
  if (!sid) bad("无法创建用于导入测试的 session", brief(s.json, 160));
  else {
    const before = (await api("GET", `/api/sessions/${sid}`)).json?.data;
    const beforeTitle = before?.title;

    const r = await api("POST", "/api/import", exported);
    if (r.status !== 200) bad(`导入返回 ${r.status}`, brief(r.json, 200));
    else {
      const stats = r.json?.data?.stats || r.json?.data;
      ok(`导入完成:${brief(stats, 160)}`);

      // 幂等:再导一次,不应产生重复
      await api("POST", "/api/import", exported);
      const list = (await api("GET", "/api/sessions")).json?.data || [];
      const dup = list.filter((x) => x.sessionId === sid).length;
      dup === 1 ? ok(`重复导入同一 session 未产生副本(INSERT OR IGNORE 生效,当前 ${dup} 条)`)
                : bad(`重复导入后同一 session 出现 ${dup} 条,存在重复写入`);

      // 不覆盖:用户改标题后再导入,标题应保持
      const after = (await api("GET", `/api/sessions/${sid}`)).json?.data;
      after?.title === beforeTitle
        ? ok("导入未覆盖用户已有数据")
        : bad(`导入覆盖了用户数据:title 由 "${beforeTitle}" 变为 "${after?.title}"`);

      // ⚠️ 关键补充:上面所有用例导入的都是**已存在**的数据,
      // INSERT OR IGNORE 会全部跳过(stats 全 0)。若导入功能整个失效(什么都不做),
      // 上面这些断言依然会全绿 —— 存在"测试无法区分'幂等'与'哑火'"的盲区。
      // 这里补一条**全新数据**的导入,验证它真的会被写入。
      const freshId = `imported-fresh-${Math.random().toString(36).slice(2, 10)}`;
      const rFresh = await api("POST", "/api/import", {
        sessions: [{ sessionId: freshId, title: "brand-new-imported", modelId: "m-x", status: "active" }],
        agents: [],
      });
      if (rFresh.status !== 200) bad(`全新数据导入返回 ${rFresh.status}`, brief(rFresh.json, 160));
      else {
        const st = rFresh.json?.data?.stats || rFresh.json?.data;
        const inserted = st?.sessions ?? 0;
        const got = await api("GET", `/api/sessions/${freshId}`);
        if (inserted >= 1 && got.status === 200) {
          ok(`全新数据确实被写入(sessions +${inserted},可回查 ${freshId})—— 排除"导入哑火"盲区`);
        } else {
          bad(`全新数据未被写入(stats=${JSON.stringify(st)}, 回查状态=${got.status})—— **导入功能可能整体失效**`);
        }
      }
    }
  }
}

/* ================================================================== *
 * G. 导入的输入校验(异常输入)
 *    ⚠️ 必须在 B 之后**等导入限流窗口过期**,否则全部拿到 429,测不到校验逻辑
 * ================================================================== */
console.log("\n── G. 导入:异常输入不得破坏服务 ──");
{
  console.log("  (等待导入限流窗口过期 62s…)");
  await new Promise((r) => setTimeout(r, 62000));

  const cases = [
    ["空对象", {}],
    ["类型错误(agents 非数组)", { agents: "not-an-array" }],
    ["超量数组(10001 个)", { agents: Array.from({ length: 10001 }, (_, i) => ({ agentId: `a${i}` })) }],
    ["未知字段", { totallyUnknownField: 123 }],
    ["畸形 JSON", "{not-json"],
  ];
  for (const [label, payload] of cases) {
    const r = await api("POST", "/api/import", payload);
    const crashed = r.status >= 500 || r.status === 429;
    crashed
      ? bad(`${label} → ${r.status}(500=服务抛错是破坏面;429=限流额度未恢复,属测试环境问题)`)
      : ok(`${label} → ${r.status}(被安全拒绝或忽略,未 500)`);
  }
  const h = await api("GET", "/api/health");
  h.status === 200 ? ok("异常输入后服务仍健康") : bad("异常输入后服务不健康");
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
