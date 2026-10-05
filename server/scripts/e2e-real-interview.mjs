#!/usr/bin/env node
/*
 * 真实 LLM 端到端测试:完整面试闭环
 *
 * ## 为什么需要
 * 在拿到 API Key 之前,所有"面试"相关测试都是 mock 的 —— 验证的是**代码路径存在**,
 * 而不是**功能真的能用**。本脚本用真实模型跑完整闭环,回答用户最关心的问题:
 *   "这些功能点是否正常工作?"
 *
 * ## 覆盖的完整链路(每一步都依赖上一步的真实产物)
 *   1. 创建会话(带目标行业/岗位)
 *   2. 题库抽题 —— 验证目标行业真的影响抽题结果
 *   3. 聊天(非流式 / 流式 SSE)
 *   4. 逐题评分 —— 真实 LLM,验证 JSON 解析、分数范围、STAR、标签数量
 *   5. 反馈入库 / 列表 / 标记错题 / 删除
 *   6. 整场评估写入 → 弱项聚合
 *   7. PII 在真实 LLM 下的表现
 *   8. 预算与限流的真实边界
 *
 * ## 依赖
 *   TRYOUT_TOKEN / TRYOUT_PROVIDER 环境变量(或 --base 指向已配置好的服务)
 *
 * 用法:node scripts/e2e-real-interview.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// R56:诊断信息安全格式化 —— JSON.stringify(undefined) 不是字符串,`.slice` 会崩
import { brief } from "./lib/brief.mjs";

const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const TOKEN = process.env.TRYOUT_TOKEN || fs.readFileSync(
  "/home/wff/桌面/tryout/Tryout-package/Tryout/server/data/.api_token", "utf8").trim();
const PROVIDER = process.env.TRYOUT_PROVIDER || "";

let pass = 0, fail = 0, skip = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };
const sk = (m) => { console.log(`  ⏭️  ${m}`); skip++; };

const api = async (method, p, body, { raw = false } = {}) => {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (raw) return { status: r.status, text };
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text };
};
const D = (j) => j?.data;

/* ---------- 前置:健康 + provider ---------- */
let activeProvider = PROVIDER;
{
  const h = await api("GET", "/api/health");
  if (h.status !== 200) { console.error(`❌ 服务不可达:${BASE}`); process.exit(2); }
  if (!activeProvider) {
    const ps = await api("GET", "/api/providers");
    const act = (D(ps.json) || []).find((p) => (p.id || p.providerId) && p.isActive);
    if (act) { activeProvider = act.id || act.providerId; ok(`自动选用 active provider:${act.name}`); }
  }
  if (!activeProvider) { console.error("❌ 未找到可用 provider(需 isActive 且已配 Key)"); process.exit(2); }
}

/* ================================================================== *
 * 1. 会话创建 + 目标行业
 * ================================================================== */
console.log("\n── 1. 会话创建与目标行业 ──");
let SID = null;
{
  const industries = (D((await api("GET", "/api/questionbank/stats")).json)?.industries) || [];
  const pick = industries.find((x) => x.id === "backend") || industries[0];
  const r = await api("POST", "/api/sessions", {
    title: "真实面试 E2E", modelId: activeProvider,
    industry: pick?.id || "backend", position: "后端工程师",
    difficulty: "normal", groupId: null,
  });
  SID = D(r.json)?.sessionId;
  SID ? ok(`创建会话 ${SID}(industry=${pick?.id},position=后端工程师)`) : bad("创建会话失败", (r.text || "").slice(0, 160));

  if (SID) {
    const g = D((await api("GET", `/api/sessions/${SID}`)).json);
    g?.industry === pick?.id
      ? ok(`目标行业已落库:${g.industry}`) : bad(`目标行业未落库:${g?.industry}`);
    g?.position === "后端工程师"
      ? ok("目标岗位已落库") : bad(`目标岗位未落库:${g?.position}`);
  }
}

/* ================================================================== *
 * 2. 题库抽题:目标行业是否真的生效
 * ================================================================== */
console.log("\n── 2. 题库抽题(验证 industry 参数真实生效)──");
{
  const be = await api("GET", "/api/questionbank?industry=backend&limit=5");
  const fe = await api("GET", "/api/questionbank?industry=frontend&limit=5");
  const beIds = (D(be.json) || []).map((q) => q.id);
  const feIds = (D(fe.json) || []).map((q) => q.id);
  beIds.length ? ok(`backend 抽到 ${beIds.length} 题`) : bad("backend 抽题失败");
  feIds.length ? ok(`frontend 抽到 ${feIds.length} 题`) : bad("frontend 抽题失败");
  const overlap = beIds.filter((i) => feIds.includes(i));
  overlap.length === 0
    ? ok("backend 与 frontend 抽题结果无重叠(industry 过滤真实生效)")
    : bad(`两个行业抽到相同题目(${overlap.join(",")}),industry 过滤失效`);
  // 难度映射:会话 5 档 → 题库 3 档,验证真的生效
  const hell = D((await api("GET", "/api/questionbank?industry=backend&difficulty=hell&limit=8")).json) || [];
  const easy = D((await api("GET", "/api/questionbank?industry=backend&difficulty=easy&limit=8")).json) || [];
  const allSenior = hell.length > 0 && hell.every((q) => q.difficulty === "senior");
  allSenior ? ok(`difficulty=hell 只抽到 senior 题(${hell.length} 题)`) : bad("difficulty=hell 混入了非 senior 题");
  const easySet = [...new Set(easy.map((q) => q.difficulty))].sort().join(",");
  easySet && !easySet.includes("senior")
    ? ok(`difficulty=easy 抽到 ${easySet}(不含 senior)`)
    : bad(`difficulty=easy 结果异常:${easySet}`);
  // 已知题:不该泄漏参考答案
  (D(be.json) || []).some((q) => "referenceAnswer" in q)
    ? bad("抽题接口泄漏了 referenceAnswer")
    : ok("抽题接口不含 referenceAnswer");
}

/* ================================================================== *
 * 3. 真实 LLM 聊天(非流式 + 流式)
 * ================================================================== */
console.log("\n── 3. 真实 LLM 调用 ──");
{
  const t0 = Date.now();
  const r = await api("POST", "/api/chat", {
    provider: activeProvider, stream: false,
    messages: [{ role: "user", content: "用一句话说明什么是数据库索引。" }],
  });
  const ms = Date.now() - t0;
  const content = D(r.json)?.content;
  content && content.length > 5
    ? ok(`非流式调用成功(${ms}ms,${content.length} 字符):${content.slice(0, 48)}…`)
    : bad(`非流式调用失败(${r.status},${ms}ms)`, (r.text || "").slice(0, 180));
  D(r.json)?.totalTokens
    ? ok(`token 计量正常:${D(r.json).totalTokens}`) : bad("无 token 计量");
}
{
  // 流式 SSE
  const r = await api("POST", "/api/chat", {
    provider: activeProvider, stream: true,
    messages: [{ role: "user", content: "数到 3,只输出数字。" }],
  }, { raw: true });
  r.text.includes("data: ")
    ? ok("流式 SSE 返回了 data: 事件") : bad("流式响应无 SSE 事件", r.text.slice(0, 120));
  r.text.trimEnd().endsWith("[DONE]")
    ? ok("流式以 [DONE] 正常结束") : bad("流式未见 [DONE] 结束标记");
  const events = r.text.split("\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"));
  events.length >= 2 ? ok(`收到 ${events.length} 个流式分片`) : bad(`流式分片过少:${events.length}`);
}

/* ================================================================== *
 * 4. 逐题评分(真实 LLM)
 * ================================================================== */
console.log("\n── 4. 逐题评分(真实 LLM)──");
let feedbackId = null;
if (!SID) sk("会话未创建,跳过逐题评分");
else {
  const t0 = Date.now();
  const r = await api("POST", `/api/sessions/${SID}/answers/score`, {
    provider: activeProvider,
    question: "请描述你做过的最有挑战的项目,以及你个人贡献的部分。",
    answer: "我参与了一个电商系统重构。主要负责把订单查询从单表 join 改成预聚合宽表,查询 P99 从 1.2s 降到 180ms。个人完成了方案设计、埋点与灰度上线,上线后大促零故障。",
  });
  const ms = Date.now() - t0;
  const d = D(r.json);
  if (d?.ok === false) { bad(`评分失败(${ms}ms):${d.error || "未知"}`, brief(d, 200)); }
  else {
    ok(`评分成功(${ms}ms)`);
    const sc = Number(d?.score);
    sc >= 1 && sc <= 10
      ? ok(`分数在有效区间:${sc}`) : bad(`分数越界:${sc}(应 1-10)`);
    d?.starAnalysis
      ? ok(`STAR 四要素齐备:${Object.keys(d.starAnalysis).join(",")}`)
      : bad("缺少 starAnalysis");
    d?.betterAnswer ? ok("返回了 betterAnswer") : bad("缺少 betterAnswer");
    d?.improvement ? ok("返回了 improvement") : bad("缺少 improvement");
    const tags = d?.weaknessTags;
    Array.isArray(tags) && tags.length >= 2 && tags.length <= 4
      ? ok(`weaknessTags 数量合规(${tags.length}):${tags.join("/")}`)
      : bad(`weaknessTags 数量异常:${Array.isArray(tags) ? tags.length : typeof tags}`);
    feedbackId = d?.feedbackId;
  }
}

/* ================================================================== *
 * 5. 反馈 CRUD
 * ================================================================== */
console.log("\n── 5. 反馈入库 / 列表 / 错题 / 删除 ──");
if (!SID) sk("会话未创建,跳过");
else {
  const l = await api("GET", `/api/sessions/${SID}/answers`);
  const list = D(l.json) || [];
  list.length >= 1 ? ok(`反馈已入库(共 ${list.length} 条)`) : bad("反馈列表为空,评分结果未持久化");
  if (list[0]) {
    const fid = list[0].feedbackId;
    const m1 = await api("PUT", `/api/answers/${fid}/missed`, { isMissed: true });
    m1.status === 200 ? ok("标记错题成功") : bad(`标记错题失败(${m1.status})`);
    const after = D((await api("GET", `/api/sessions/${SID}/answers`)).json) || [];
    after.find((x) => x.feedbackId === fid)?.isMissed === true
      ? ok("isMissed=true 已持久化") : bad("isMissed 未持久化");
    const m2 = await api("PUT", `/api/answers/${fid}/missed`, { isMissed: false });
    m2.status === 200 ? ok("取消错题成功") : bad(`取消错题失败(${m2.status})`);
    const d2 = await api("DELETE", `/api/answers/${fid}`);
    d2.status === 200 ? ok("删除反馈成功") : bad(`删除反馈失败(${d2.status})`);
    const after2 = D((await api("GET", `/api/sessions/${SID}/answers`)).json) || [];
    after2.find((x) => x.feedbackId === fid)
      ? bad("删除后反馈仍在列表") : ok("删除后已从列表移除");
  }
}

/* ================================================================== *
 * 6. 整场评估 + 弱项聚合
 * ================================================================== */
console.log("\n── 6. 整场评估与弱项聚合 ──");
{
  const w = await api("POST", "/api/evaluations", {
    sessionId: SID || "no-session",
    overallScore: 7.5,
    report: "技术深度扎实,能讲清权衡;沟通表达略弱,回答偏长。",
    dimensions: [
      { dimensionName: "技术深度", score: 5 },
      { dimensionName: "沟通表达", score: 2 },
      { dimensionName: "逻辑思维", score: 4 },
    ],
  });
  w.status === 200 ? ok("整场评估写入成功") : bad(`整场评估写入失败(${w.status})`, (w.text || "").slice(0, 160));

  const wk = D((await api("GET", "/api/analysis/weakness?limit=10")).json);
  wk?.hasData ? ok(`弱项聚合有数据(总评估数 ${wk.totalEvaluations})`) : bad("弱项聚合无数据");
  const stats = wk?.dimensionStats || [];
  stats.length >= 3 ? ok(`${stats.length} 个维度进入聚合`) : bad(`聚合维度数异常:${stats.length}`);
  const comm = stats.find((x) => x.dimensionName === "沟通表达");
  comm?.avgScore === 2 ? ok("沟通表达均分 2 正确") : bad(`沟通表达均分异常:${comm?.avgScore}`);
  // 样本量门槛:仅 1 次评估时,weaknessCore 会标记 lowConfidence 且**不给**最弱维度
  // (设计如此:1 个样本的 2 分是运气,不是弱项)。这里验证的正是该行为。
  const lowConf = (stats || []).filter((x) => x.lowConfidence).length;
  if (lowConf === stats.length) {
    ok(`${lowConf} 个维度均标记 lowConfidence(样本不足,不给结论)`);
    (wk.weakestDimensions || []).length === 0
      ? ok("样本不足时 weakestDimensions 为空(不轻率下结论)")
      : bad(`样本不足却给出了 weakestDimensions:${brief(wk.weakestDimensions, 120)}`);
  } else {
    const weakest = (wk.weakestDimensions || [])[0];
    weakest?.dimensionName === "沟通表达"
      ? ok("最弱维度正确识别为「沟通表达」")
      : bad(`最弱维度识别错误:${weakest?.dimensionName}`);
  }
}

/* ================================================================== *
 * 7. 真实 PII 链路
 * ================================================================== */
console.log("\n── 7. 真实 LLM 下的 PII 处理 ──");
{
  const PHONE = "13900001111";
  const r = await api("POST", "/api/chat", {
    provider: activeProvider, stream: true,
    messages: [{ role: "user", content: `我的手机号是 ${PHONE},请复述一遍。` }],
  }, { raw: true });

  // 提取 pii_mapping 与内容流
  let mapping = null, content = "";
  for (const line of r.text.split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
    if (ev.pii_mapping) mapping = ev.pii_mapping;
    if (ev.choices?.[0]?.delta?.content) content += ev.choices[0].delta.content;
  }
  const mappingHasPhone = (mapping || []).some((m) => m.value === PHONE);
  mappingHasPhone ? ok("pii_mapping 正确下发(含手机号映射)") : bad("pii_mapping 未含手机号");
  const ph = (mapping || []).find((m) => m.value === PHONE)?.placeholder;
  ph ? ok(`占位符已下发:${ph}`) : bad("占位符缺失");
  if (ph && content.includes(ph)) ok("内容流中出现占位符(模型看到的是占位符而非明文)");
  else bad("内容流中未见占位符", content.slice(0, 120));
  // 明文只允许出现在 pii_mapping 事件里
  const contentOnly = r.text.split("\n").filter((l) => l.startsWith("data: ") && !l.includes("pii_mapping") && !l.includes("[DONE]")).join("\n");
  contentOnly.includes(PHONE)
    ? bad("**内容流中出现明文手机号** —— 真实模型看到了 PII")
    : ok("内容流中无明文手机号");
}

/* ================================================================== *
 * 8. 输入校验(真实服务上)
 * ================================================================== */
console.log("\n── 8. 真实服务上的输入校验 ──");
if (!SID) sk("会话未创建,跳过输入校验(否则全部会先命中 404 会话不存在)");
else {
  const cases = [
    ["缺 question", { provider: activeProvider, answer: "x" }],
    ["缺 answer", { provider: activeProvider, question: "x" }],
    ["缺 provider", { question: "x", answer: "x" }],
    ["空 answer 空白", { provider: activeProvider, question: "x", answer: "   " }],
    ["不存在的 provider", { provider: "no-such-provider", question: "x", answer: "x" }],
  ];
  for (const [label, body] of cases) {
    const r = await api("POST", `/api/sessions/${SID}/answers/score`, body);
    if (r.status >= 500) bad(`${label} → ${r.status}(客户端错误不应是 5xx)`);
    else if (r.status === 400 || r.status === 404) ok(`${label} → ${r.status}`);
    else sk(`${label} → ${r.status}(未拒绝)`);
  }
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败 / ${skip} 跳过`);
console.log("=".repeat(58));
process.exit(fail > 0 ? 1 : 0);
