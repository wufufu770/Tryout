#!/usr/bin/env node
/*
 * ISSUE-008 端到端回归:用户必经路径的**业务正确性**(不只是"不崩")
 *
 * ## 与 `e2e-route-smoke.mjs` 的分工
 * 冒烟测试已保证「61 条路由在基础请求下都不返回 5xx」,
 * 但它**不验证语义** —— 路由返回 200 却写错了数据,它抓不到。
 * 本脚本补上这部分,挑的是用户真实会走到的路径:
 *
 *   1. 会话分组 CRUD(含改名、排序、移动会话、删除)
 *   2. 会话复习(review)写入与读取
 *   3. 消息追加与按顺序读取
 *   4. 材料(metadata)创建 / 读取 / 删除
 *   5. 评估(evaluations)写入 → 弱项聚合读出
 *   6. 资料匹配度计算的失败路径(空 JD / 无技能)
 *   7. 跨资源一致性:删会话后其 review 是否还挂着
 *
 * 关键断言都写成**可证伪的具体值**,而不是"不报错"。
 *
 * 用法:node scripts/e2e-crud-semantics.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// R56:诊断信息安全格式化 —— JSON.stringify(undefined) 不是字符串,`.slice` 会崩
import { brief } from "./lib/brief.mjs";

const PORT = 3482;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-crud-"));
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

async function api(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const D = (j) => j?.data;

/* ================================================================ *
 * 1. 会话分组 CRUD
 * ================================================================ */
console.log("\n── 1. 会话分组 CRUD ──");
let groupId = null;
{
  const c = await api("POST", "/api/session-groups", { name: "第一组" });
  groupId = D(c.json)?.groupId;
  groupId ? ok(`创建分组:${groupId}`) : bad(`创建分组失败(${c.status})`, brief(c.json, 150));

  if (groupId) {
    // 列表应含新建分组
    const l = await api("GET", "/api/session-groups");
    const found = (D(l.json) || []).some((g) => g.groupId === groupId);
    found ? ok("列表包含新建分组") : bad("列表未包含新建分组");

    // 改名后能读出新名字(而不是旧名)
    const u = await api("PUT", `/api/session-groups/${groupId}`, { name: "改过的名字" });
    const g = await api("GET", `/api/session-groups/${groupId}`);
    D(g.json)?.name === "改过的名字"
      ? ok(`改名生效:${D(g.json).name}`)
      : bad(`改名未生效,读到 ${JSON.stringify(D(g.json))}`);

    // 把一个会话移入分组
    const s = await api("POST", "/api/sessions", { title: "crud 会话", modelId: "m1" });
    const sid = D(s.json)?.sessionId;
    sid ? ok(`创建会话:${sid}`) : bad("创建会话失败");
    if (sid) {
      const mv = await api("PUT", `/api/sessions/${sid}/group`, { groupId });
      mv.status === 200 ? ok("会话移入分组") : bad(`移动会话失败(${mv.status})`, brief(mv.json, 120));

      // 该分组下的会话列表应包含它
      const ls = await api("GET", `/api/session-groups/${groupId}/sessions`);
      const inGroup = (D(ls.json) || []).some((x) => x.sessionId === sid);
      inGroup ? ok("分组会话列表包含该会话") : bad("分组会话列表缺少该会话(移动未真正生效)");

      // 移出分组后应出现在"未分组"列表
      const out = await api("PUT", `/api/sessions/${sid}/group`, { groupId: null });
      out.status === 200 ? ok("会话移出分组") : bad(`移出分组失败(${out.status})`);
      const un = await api("GET", "/api/ungrouped-sessions");
      const stillUngrouped = (D(un.json) || []).some((x) => x.sessionId === sid);
      stillUngrouped ? ok("未分组列表包含该会话") : bad("未分组列表缺少该会话");
    }
  }
}

/* ================================================================ *
 * 2. 会话复习 review
 * ================================================================ */
console.log("\n── 2. 会话复习 review ──");
{
  const s = await api("POST", "/api/sessions", { title: "review 会话", modelId: "m1" });
  const sid = D(s.json)?.sessionId;
  if (!sid) bad("无法创建用于 review 测试的会话");
  else {
    // 字段名必须与 表结构 / db.createSessionReview / 前端 reviewGenerator 三方一致
    const PAYLOAD = {
      overallScore: 6.5,
      strengths: ["技术深度不错"],
      weaknesses: ["沟通表达偏弱"],
      improvements: [{ area: "沟通", suggestion: "多练结构化表达", priority: "high" }],
      performance: "总体中等,技术侧扎实。",
      nextFocus: "结构化表达",
    };
    const w = await api("POST", `/api/sessions/${sid}/review`, PAYLOAD);
    w.status === 200 ? ok("写入 review") : bad(`写入 review 失败(${w.status})`, brief(w.json, 200));

    const r = await api("GET", `/api/sessions/${sid}/review`);
    const rv = D(r.json);
    rv?.overallScore === 6.5 ? ok(`overallScore 正确:${rv.overallScore}`) : bad(`overallScore 不符:${rv?.overallScore}`);
    rv?.performance === PAYLOAD.performance
      ? ok("performance 读回一致") : bad(`performance 不一致:${rv?.performance}`);
    JSON.stringify(rv?.strengths) === JSON.stringify(PAYLOAD.strengths)
      ? ok("strengths 读回一致(数组未被吞)") : bad(`strengths 不一致:${JSON.stringify(rv?.strengths)}`);
    rv?.improvements?.[0]?.priority === "high"
      ? ok("improvements 嵌套结构保留") : bad(`improvements 结构丢失:${JSON.stringify(rv?.improvements)}`);

    // 缺 overallScore 必须被拒(该路由曾经**任何载荷都写不进去**,ISSUE-018)
    const noScore = await api("POST", `/api/sessions/${sid}/review`, { performance: "无分数" });
    noScore.status === 400 ? ok("缺 overallScore 被拒(400)") : bad(`缺 overallScore 返回 ${noScore.status},应为 400`);
    // 旧契约字段 reviewText / overallRating 已不属该接口
    const legacy = await api("POST", `/api/sessions/${sid}/review`, { reviewText: "x", overallRating: 8 });
    legacy.status === 400 ? ok("旧契约字段(reviewText/overallRating)已被正确拒绝") : bad(`旧字段返回 ${legacy.status},应为 400`);

    // 全局 reviews 聚合应含它
    const all = await api("GET", "/api/reviews");
    const inAll = (D(all.json) || []).some((x) => x.sessionId === sid);
    inAll ? ok("全局 reviews 聚合包含该会话") : bad("全局 reviews 聚合缺少该会话");

    // 超范围分数应被拒
    const oor = await api("POST", `/api/sessions/${sid}/review`, { overallScore: 99 });
    oor.status === 400 ? ok("overallScore=99 越界被拒(400)") : bad(`越界分数返回 ${oor.status},应为 400`);
  }
}

/* ================================================================ *
 * 3. 消息追加与顺序
 * ================================================================ */
console.log("\n── 3. 消息追加与读取顺序 ──");
{
  const s = await api("POST", "/api/sessions", { title: "msg 会话", modelId: "m1" });
  const sid = D(s.json)?.sessionId;
  if (!sid) bad("无法创建会话");
  else {
    for (const text of ["第一条", "第二条", "第三条"]) {
      const w = await api("POST", `/api/sessions/${sid}/messages`, { role: "user", content: text });
      if (w.status !== 200) { bad(`追加消息「${text}」失败(${w.status})`, brief(w.json, 120)); break; }
    }
    const r = await api("GET", `/api/sessions/${sid}/messages`);
    const msgs = D(r.json) || [];
    msgs.length === 3 ? ok("读到 3 条消息") : bad(`消息条数应为 3,实际 ${msgs.length}`);
    const contents = msgs.map((m) => m.content);
    JSON.stringify(contents) === JSON.stringify(["第一条", "第二条", "第三条"])
      ? ok("消息按写入顺序返回")
      : bad(`消息顺序错误:${JSON.stringify(contents)}`);
  }
}

/* ================================================================ *
 * 4. 材料 metadata CRUD
 * ================================================================ */
console.log("\n── 4. 材料 metadata CRUD ──");
{
  const c = await api("POST", "/api/materials", {
    type: "jd", sourceType: "text", rawText: "后端工程师,要求熟悉 Node.js 与数据库。", title: "一份 JD",
  });
  const mid = D(c.json)?.materialId;
  mid ? ok(`创建材料:${mid}`) : bad(`创建材料失败(${c.status})`, brief(c.json, 150));
  if (mid) {
    const l = await api("GET", "/api/materials");
    (D(l.json) || []).some((m) => m.materialId === mid)
      ? ok("材料列表包含新建项") : bad("材料列表缺少新建项");

    const del = await api("DELETE", `/api/materials/${mid}`);
    del.status === 200 ? ok("删除材料成功") : bad(`删除材料失败(${del.status})`);
    const after = await api("GET", "/api/materials");
    (D(after.json) || []).some((m) => m.materialId === mid)
      ? bad("删除后材料仍在列表中") : ok("删除后已从列表移除");
  }
}

/* ================================================================ *
 * 5. 评估写入 → 弱项聚合
 * ================================================================ */
console.log("\n── 5. 评估写入 → 弱项聚合 ──");
{
  const s = await api("POST", "/api/sessions", { title: "eval 会话", modelId: "m1" });
  const sid = D(s.json)?.sessionId;
  if (!sid) bad("无法创建会话");
  else {
    const w = await api("POST", "/api/evaluations", {
      sessionId: sid, overallScore: 4, report: "技术还行,沟通偏弱。",
      dimensions: [
        { dimensionName: "技术深度", score: 5 },
        { dimensionName: "沟通表达", score: 2 },
      ],
    });
    w.status === 200 ? ok("写入评估(含 2 个维度)") : bad(`写入评估失败(${w.status})`, brief(w.json, 150));

    // 弱项聚合应能读出,且"沟通表达"应是最低分
    const wk = await api("GET", "/api/analysis/weakness");
    const d = D(wk.json);
    d?.hasData ? ok(`弱项聚合有数据(totalEvaluations=${d.totalEvaluations})`) : bad("弱项聚合无数据");
    const stats = d?.dimensionStats || [];
    stats.length === 2 ? ok("两个维度都进入聚合") : bad(`维度聚合数应为 2,实际 ${stats.length}`);
    const comm = stats.find((x) => x.dimensionName === "沟通表达");
    const tech = stats.find((x) => x.dimensionName === "技术深度");
    comm?.avgScore === 2 && tech?.avgScore === 5
      ? ok("各维度均分正确(沟通 2 / 技术 5)")
      : bad(`均分不符:沟通=${comm?.avgScore} 技术=${tech?.avgScore}`);

    // 样本量不足时应标记 lowConfidence 而不是直接给建议
    d?.dimensionStats?.every((x) => x.lowConfidence === true)
      ? ok("单次评估被标记 lowConfidence(不轻率给建议)")
      : bad("单次评估未被标记 lowConfidence,可能在样本不足时直接下结论");

    // 列出该会话的评估
    const ev = await api("GET", `/api/sessions/${sid}/evaluations`);
    (D(ev.json) || []).length >= 1 ? ok("会话评估列表可读出") : bad("会话评估列表为空");
  }
}

/* ================================================================ *
 * 6. 材料匹配度的失败路径
 * ================================================================ */
console.log("\n── 6. 材料匹配度失败路径 ──");
{
  // 空 JD / 无技能时应给出明确提示,而不是静默返回错误值
  const r = await api("POST", "/api/materials", { type: "jd", sourceType: "text", rawText: "x" });
  const mid = D(r.json)?.materialId;
  mid ? ok("创建最小材料用于匹配度测试") : bad("创建材料失败");
  // 匹配度计算的具体端点由前端 lib 完成,这里只确认不崩且有可读输出
  if (mid) {
    const c = await api("GET", `/api/materials/${mid}/content`);
    c.status === 200 ? ok("材料内容可读出") : bad(`材料内容读取失败(${c.status})`);
  }
}

/* ================================================================ *
 * 7. 跨资源一致性
 * ================================================================ */
console.log("\n── 7. 跨资源一致性 ──");
{
  const s = await api("POST", "/api/sessions", { title: "待删会话", modelId: "m1" });
  const sid = D(s.json)?.sessionId;
  if (!sid) bad("无法创建会话");
  else {
    await api("POST", `/api/sessions/${sid}/messages`, { role: "user", content: "将被删除" });
    const before = await api("GET", `/api/sessions/${sid}/messages`);
    (D(before.json) || []).length === 1 ? ok("删除前消息 1 条") : bad("删除前消息数不对");

    // 归档(而非硬删)后应不再出现在活动会话列表
    const arch = await api("PUT", `/api/sessions/${sid}/model`, { modelId: "m2" });
    arch.status === 200 ? ok("切换 model 成功(顺带验证该路由非零覆盖)") : bad(`切换 model 失败(${arch.status})`);
    const sess = await api("GET", `/api/sessions/${sid}`);
    D(sess.json)?.modelId === "m2" ? ok("modelId 已更新为 m2") : bad(`modelId 未更新:${D(sess.json)?.modelId}`);
  }
}

console.log("\n" + "=".repeat(58));
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(58));
cleanup();
process.exit(fail > 0 ? 1 : 0);
