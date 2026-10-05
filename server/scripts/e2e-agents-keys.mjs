#!/usr/bin/env node
/*
 * ISSUE-008 端到端回归:agents / api-keys / 供应商切换的业务语义
 *
 * 补齐"47 条零覆盖路由"里剩下的三块用户必经路径:
 *   1. Agent 的 kind 过滤 / 基础信息更新 / **版本管理**(currentVersion 的正确性)
 *   2. API Key 的写入 / 存在性查询 / 删除,且**明文不得回显**
 *   3. provider 的 active 切换与 failover 队列语义
 *
 * 这些路由此前**完全没有测试**,而其中"currentVersion 指向的版本是否存在"
 * "key 是否被回显"都属于一旦出错就静默的类别。
 *
 * 用法:node scripts/e2e-agents-keys.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// R56:诊断信息安全格式化 —— JSON.stringify(undefined) 不是字符串,`.slice` 会崩
import { brief } from "./lib/brief.mjs";

const PORT = 3484;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-ak-"));
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
  env: { ...process.env, PORT: String(PORT), DB_DIR, NODE_ENV: "test" },
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
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text };
};
const D = (j) => j?.data;

/* ================================================================ *
 * 1. Agent CRUD / kind 过滤
 * ================================================================ */
console.log("\n── 1. Agent CRUD 与 kind 过滤 ──");
let interviewerId = null, candidateId = null;
{
  const a = await api("POST", "/api/agents", { name: "技术面试官", role: "tech", promptTemplate: "你是技术面试官。" });
  interviewerId = D(a.json)?.agentId;
  interviewerId ? ok(`创建 interviewer agent:${interviewerId}`) : bad("创建 agent 失败", brief(a.json, 140));

  // ⚠️ kind 过滤走的是 agent_kind 列(默认 interviewer),与 role 无关;
  //   要造 candidate 必须显式传 agentKind,否则会落进 interviewer 列表。
  const c = await api("POST", "/api/agents", { name: "候选人", role: "candidate", agentKind: "candidate", promptTemplate: "你是候选人。" });
  candidateId = D(c.json)?.agentId;
  candidateId ? ok(`创建 candidate agent:${candidateId}`) : bad("创建 candidate 失败");

  if (interviewerId && candidateId) {
    // kind 过滤:两种 role 应各自只出现在对应列表里
    const li = await api("GET", "/api/agents?kind=interviewer");
    const lc = await api("GET", "/api/agents?kind=candidate");
    const liIds = (D(li.json) || []).map((x) => x.agentId);
    const lcIds = (D(lc.json) || []).map((x) => x.agentId);
    liIds.includes(interviewerId) ? ok("interviewer 列表含技术面试官") : bad("interviewer 列表缺少技术面试官");
    lcIds.includes(candidateId) ? ok("candidate 列表含候选人") : bad("candidate 列表缺少候选人");
    liIds.includes(candidateId)
      ? bad("**candidate 出现在 interviewer 列表里** —— kind 过滤失效")
      : ok("kind 过滤正确:两个 kind 互不串");

    // 基础信息更新
    // 只传 name 的**部分更新**(ISSUE-023 回归):路由与前端类型都声明支持部分更新
    const u = await api("PUT", `/api/agents/${interviewerId}/basic`, { name: "技术面试官(改名)" });
    u.status === 200
      ? ok("只传 name 的部分更新被接受(200)")
      : bad(`只传 name 却被拒(${u.status}):${brief(D(u.json), 120)}`);
    const g = await api("GET", `/api/agents/${interviewerId}`);
    D(g.json)?.name === "技术面试官(改名)"
      ? ok("改名生效") : bad(`改名未生效:${D(g.json)?.name}`);
    // 未传的字段必须保持原值(不能被清空)
    D(g.json)?.role === "tech"
      ? ok("未传的 role 保持原值 tech(部分更新未误清空)")
      : bad(`未传的 role 被清空成了 ${D(g.json)?.role}`);
    D(g.json)?.name === "技术面试官(改名)" && D(g.json)?.role === "tech"
      ? ok("部分更新只改目标字段,其余原样保留")
      : bad("部分更新破坏了其他字段");

    // 不存在的 agent → 404
    const nf = await api("GET", "/api/agents/definitely-not-exist");
    nf.status === 404 ? ok("不存在的 agent → 404") : bad(`不存在的 agent 返回 ${nf.status}`);

    // 缺 promptTemplate → 400
    const bad1 = await api("POST", "/api/agents", { name: "缺模板", role: "tech" });
    bad1.status === 400 ? ok("缺 promptTemplate 被拒(400)") : bad(`缺必填返回 ${bad1.status}`);
    // 非法 role → 400
    const bad2 = await api("POST", "/api/agents", { name: "非法角色", role: "不存在的角色", promptTemplate: "x" });
    bad2.status === 400 ? ok("非法 role 被拒(400)") : bad(`非法 role 返回 ${bad2.status}`);
  }
}

/* ================================================================ *
 * 1.5 R32(ISSUE-065):一次性保存的事务性
 * ================================================================ */
console.log("\n── 1.5 一次性保存(事务性)──");
if (interviewerId) {
  // 正常路径:基本信息与版本**同时**生效
  const both = await api("PUT", `/api/agents/${interviewerId}`, {
    basic: { name: "事务面试官", role: "tech" },
    version: {
      promptTemplate: "事务版提示词", tone: "gentle", difficulty: 7,
      focusAreas: ["分布式一致性"], changelog: "首版事务保存",
    },
  });
  const bv = D(both.json);
  if (both.status !== 200) {
    bad("PUT /api/agents/:id 失败", `${both.status} ${brief(both.json, 160)}`);
  } else {
    ok("PUT /api/agents/:id → 200(基本信息 + 版本一次完成)");
    const g0 = await api("GET", `/api/agents/${interviewerId}`);
    D(g0.json)?.name === "事务面试官" ? ok("基本信息已生效") : bad(`基本信息未生效:${D(g0.json)?.name}`);
    bv?.versionId === D(g0.json)?.currentVersionId
      ? ok("currentVersion 指向刚建的版本")
      : bad(`currentVersion 不符:版本=${bv?.versionId} agent=${D(g0.json)?.currentVersionId}`);
    if (bv?.tone === "gentle" && bv?.difficulty === 7) ok("版本元数据随事务一起落库");
    else bad(`版本元数据异常 tone=${bv?.tone} difficulty=${bv?.difficulty}`);
  }

  // ⚠️ 核心断言:version 侧失败时,basic 侧必须**完全没有生效**。
  // 这正是旧的两步写法做不到的 —— 旧路径下 basic 已经落库了。
  // ⚠️ 这几条断言**不是**在验证事务回滚,别误读。
  // 路由里两个 `s.object(...).parse()` 都跑在 `updateAgentWithVersion` 之前,
  // 所以 version 非法时 db 函数压根没被调用 —— 哪怕没有事务,basic 也不会变。
  // (R27 教训:我第一版就是把它当成事务证据的,复核发现是假绿。)
  // 它真正锁住的是「请求被拒时不留下任何写入」。
  // 事务回滚本身由 server/test/agent-update-transaction.test.js 覆盖 ——
  // 那里用 schema 挡不住的坏数据(对象绑定)触发**事务内**失败,才真正区分得开。
  const before = D((await api("GET", `/api/agents/${interviewerId}`)).json);
  const nameBefore = before?.name;
  const verBefore = before?.currentVersionId;

  // 造一个必然失败的 version:promptTemplate 缺失
  const partialFail = await api("PUT", `/api/agents/${interviewerId}`, {
    basic: { name: "不该被改的名字" },
    version: { tone: "aggressive" },   // 缺 promptTemplate
  });
  partialFail.status === 400
    ? ok("version 侧非法 → 400")
    : bad(`version 侧非法未报错,返回 ${partialFail.status}`);

  const after = D((await api("GET", `/api/agents/${interviewerId}`)).json);
  after?.name === nameBefore
    ? ok("请求被拒后基本信息未被改动")
    : bad(`请求被拒却改了基本信息:${nameBefore} → ${after?.name}`);
  after?.currentVersionId === verBefore
    ? ok("请求被拒后 currentVersion 未变(无半截版本链)")
    : bad(`请求被拒后 currentVersion 由 ${verBefore} 变成了 ${after?.currentVersionId}`);

  // 不存在的 agent → 404,且不得留下任何写入
  const nf = await api("PUT", "/api/agents/definitely-not-exist", {
    basic: { name: "x" }, version: { promptTemplate: "y" },
  });
  nf.status === 404 ? ok("对不存在的 agent 保存 → 404") : bad(`不存在的 agent 返回 ${nf.status}`);

  // basic 单独缺 version → 400(而不是悄悄只改基本信息)
  const noVer = await api("PUT", `/api/agents/${interviewerId}`, { basic: { name: "也该被拒" } });
  noVer.status === 400 ? ok("缺 version → 400") : bad(`缺 version 返回 ${noVer.status}`);
  const after2 = D((await api("GET", `/api/agents/${interviewerId}`)).json);
  after2?.name === nameBefore ? ok("缺 version 时基本信息也未变") : bad(`缺 version 时基本信息仍被改成 ${after2?.name}`);

  // basic 侧不再接受 tone/focusAreas/difficulty:
  // 它们只存在于 agent_versions 表,此前 basic 的 pick 列表却列着这三个,
  // 属于"声明了但 db 层从不读"的骗人契约。
  // 传了会被静默丢弃(stripUnknown),所以这里只断言不影响正常保存,不假装能拒绝。
  const stale = await api("PUT", `/api/agents/${interviewerId}`, {
    basic: { name: "带遗留字段", tone: "gentle", focusAreas: ["x"], difficulty: 3 },
    version: { promptTemplate: "遗留字段不应改变语气" },
  });
  const sv = D(stale.json);
  sv?.tone === "neutral"
    ? ok("basic 侧遗留的 tone/focusAreas/difficulty 不再被误认为可改(语气仍取 version 侧)")
    : bad(`basic 侧遗留字段竟改动了语气:tone=${sv?.tone}`);
}

console.log("\n── 2. Agent 版本管理 ──");
if (interviewerId) {
  const v1 = await api("POST", `/api/agents/${interviewerId}/versions`, { promptTemplate: "版本一的提示词" });
  const v1id = D(v1.json)?.versionId;
  v1id ? ok(`创建版本 1:${v1id}`) : bad("创建版本失败", brief(v1.json, 140));

  const v2 = await api("POST", `/api/agents/${interviewerId}/versions`, { promptTemplate: "版本二的提示词" });
  const v2id = D(v2.json)?.versionId;
  v2id && v2id !== v1id ? ok("创建版本 2,且与版本 1 不同") : bad("版本 2 异常");

  // R32(ISSUE-064):前端 AgentPage 保存时,version 侧传的是
  //   { tone, difficulty, focusAreas, promptTemplate, changelog }
  // 而 POST /api/agents/:id/versions 的 schema 只声明了 { name, promptTemplate }。
  // 本项目自研的 s.object() 默认 _stripUnknown = true —— 未知字段**静默丢弃**。
  // 于是 createAgentVersion 读到的 tone/focusAreas/difficulty/changelog 全是 undefined,
  // 落库时被填成默认值 neutral / [] / 5 / null。
  // 后果:用户在页面上改的语气、难度、关注领域、变更说明,**保存后全部消失**,
  // 而且没有任何报错 —— 用户以为存上了。
  // 这与 R24 的 ISSUE-013(stage-agents 静默剥字段)是同一反模式的不同落点。
  const vMeta = await api("POST", `/api/agents/${interviewerId}/versions`, {
    promptTemplate: "带元数据的提示词",
    tone: "aggressive",
    difficulty: 8,
    focusAreas: ["缓存一致性", "消息队列"],
    changelog: "调高难度并锁定缓存方向",
  });
  const mv = D(vMeta.json);
  if (vMeta.status !== 200) {
    bad("带元数据创建版本失败", `${vMeta.status} ${brief(vMeta.json, 140)}`);
  } else {
    const lost = [];
    if (mv?.tone !== "aggressive") lost.push(`tone 期望 aggressive,实得 ${JSON.stringify(mv?.tone)}`);
    if (mv?.difficulty !== 8) lost.push(`difficulty 期望 8,实得 ${JSON.stringify(mv?.difficulty)}`);
    const fa = Array.isArray(mv?.focusAreas) ? mv.focusAreas : [];
    if (!fa.includes("缓存一致性")) lost.push(`focusAreas 期望含「缓存一致性」,实得 ${JSON.stringify(mv?.focusAreas)}`);
    if (!String(mv?.changelog || "").includes("缓存方向")) lost.push(`changelog 实得 ${JSON.stringify(mv?.changelog)}`);
    lost.length === 0
      ? ok("版本元数据(tone/difficulty/focusAreas/changelog)如实落库")
      : bad(`版本元数据被静默丢弃 ${lost.length}/4 项`, lost.join("; "));
  }

  if (v1id && v2id) {
    // 切到版本 2
    const sw = await api("PUT", `/api/agents/${interviewerId}/current-version`, { versionId: v2id });
    sw.status === 200 ? ok("切换 currentVersion 到版本 2") : bad(`切换失败(${sw.status})`, brief(sw.json, 140));

    const g = await api("GET", `/api/agents/${interviewerId}`);
    const cur = D(g.json)?.currentVersionId;
    cur === v2id
      ? ok("currentVersion 读回为版本 2")
      : bad(`currentVersion 不符:期望 ${v2id},实际 ${cur}`);

    // 切回版本 1
    await api("PUT", `/api/agents/${interviewerId}/current-version`, { versionId: v1id });
    const g2 = await api("GET", `/api/agents/${interviewerId}`);
    D(g2.json)?.currentVersionId === v1id
      ? ok("可切回版本 1")
      : bad("切回版本 1 失败");

    // 切到**不存在**的版本 → 应被拒
    const bogus = await api("PUT", `/api/agents/${interviewerId}/current-version`, { versionId: "no-such-version" });
    if (bogus.status === 200) {
      const g3 = await api("GET", `/api/agents/${interviewerId}`);
      D(g3.json)?.currentVersionId === "no-such-version"
        ? bad("**可把 currentVersion 指向不存在的版本** —— 悬空引用,后续取提示词会失败")
        : ok("接受请求但 currentVersion 未被改成不存在的值(安全)");
    } else {
      ok(`切到不存在的版本被拒(${bogus.status})`);
    }
  }
}

/* ================================================================ *
 * 3. API Key:写入 / 存在性 / **明文不回显** / 删除
 * ================================================================ */
console.log("\n── 3. API Key 安全性 ──");
{
  const SECRET = "sk-TEST-SECRET-9d3f2a";
  const w = await api("POST", "/api/keys", { provider: "openai", key: SECRET });
  w.status === 200 ? ok("写入 API Key") : bad(`写入失败(${w.status})`, brief(w.json, 140));

  // 列表不得含明文
  const l = await api("GET", "/api/keys");
  l.text.includes(SECRET)
    ? bad("**列表接口回显了明文 API Key** —— P0 级泄露")
    : ok("列表接口不回显明文 Key");

  // 单个查询只应返回存在性
  const one = await api("GET", "/api/keys/openai");
  one.text.includes(SECRET)
    ? bad("**存在性查询回显了明文 Key**")
    : ok("存在性查询不回显明文");
  const o = D(one.json);
  typeof o?.hasKey === "boolean"
    ? ok(`hasKey 正确置位:${o.hasKey}`)
    : bad(`hasKey 缺失或类型不对:${JSON.stringify(o)}`);

  // 不存在的 provider → hasKey false
  const none = await api("GET", "/api/keys/never-configured-provider");
  D(none.json)?.hasKey === false ? ok("未配置的 provider 返回 hasKey=false") : bad(`未配置 provider 的 hasKey 不对:${JSON.stringify(D(none.json))}`);

  // 空 key → 400
  const bad1 = await api("POST", "/api/keys", { provider: "openai", key: "" });
  bad1.status === 400 ? ok("空 key 被拒(400)") : bad(`空 key 返回 ${bad1.status}`);

  // 删除后 hasKey 变 false
  const del = await api("DELETE", "/api/keys/openai");
  if (del.status === 200) {
    const after = await api("GET", "/api/keys/openai");
    D(after.json)?.hasKey === false
      ? ok("删除后 hasKey 变 false")
      : bad(`删除后 hasKey 仍为 ${D(after.json)?.hasKey}`);
  } else {
    bad(`删除 Key 失败(${del.status})`);
  }
}

/* ================================================================ *
 * 4. provider 激活与 failover 队列
 * ================================================================ */
console.log("\n── 4. provider 激活与 failover 队列 ──");
{
  const mk = async (name, url) => {
    const r = await api("POST", "/api/providers", { name, baseUrl: url });
    return D(r.json)?.providerId;
  };
  const pa = await mk("语义-甲", "https://api.deepseek.com/v1");
  const pb = await mk("语义-乙", "https://api.moonshot.cn/v1");
  if (!pa || !pb) bad("创建 provider 失败");
  else {
    // 激活 A
    const act = await api("PUT", `/api/providers/${pa}/activate`);
    act.status === 200 ? ok("激活 provider 甲") : bad(`激活失败(${act.status})`);
    const l1 = await api("GET", "/api/providers");
    const act1 = (D(l1.json) || []).filter((p) => p.isActive);
    act1.length === 1 && (act1[0].id || act1[0].providerId) === pa
      ? ok("激活后唯一 active 是甲")
      : bad(`激活态异常:${act1.map((p) => p.name).join(",")}`);

    // 激活 B,应自动把 A 取消
    await api("PUT", `/api/providers/${pb}/activate`);
    const l2 = await api("GET", "/api/providers");
    const act2 = (D(l2.json) || []).filter((p) => p.isActive);
    act2.length === 1 && (act2[0].id || act2[0].providerId) === pb
      ? ok("切到乙后,甲自动取消激活(单例约束)")
      : bad(`切换后激活态异常:${act2.map((p) => p.name).join(",")}`);

    // 取消当前激活
    const off = await api("PUT", `/api/providers/${pb}/activate`, { isActive: false });
    off.status === 200 ? ok("可取消激活") : bad(`取消激活失败(${off.status})`);

    // 删除后不应残留在列表
    await api("DELETE", `/api/providers/${pa}`);
    await api("DELETE", `/api/providers/${pb}`);
    const l3 = await api("GET", "/api/providers");
    const left = (D(l3.json) || []).filter((p) => (p.id || p.providerId) === pa || (p.id || p.providerId) === pb);
    left.length === 0 ? ok("删除后不再出现在列表中") : bad(`删除后仍残留 ${left.length} 个`);
  }
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
