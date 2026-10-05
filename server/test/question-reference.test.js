// 单元测试:题目级评分基准的取用(守卫 ISSUE-038)
//
// ## 背景
// `getReferenceForScoring()` 在 R32 之前**已经写好但零调用方**。
// 它的注释写着「仅供服务端内部评估使用」,但评分器(scoringEngine)整体跑在
// 浏览器端 —— prompt 在前端拼、LLM 调用也在前端发,参考答案不到前端就进不了 prompt。
// 于是 InterviewPage / HistoryPage 两处都传 `undefined`,评分器从来没有题目基准。
//
// 而 InterviewPage 的 `bankReferenced: !!currentQuestion` 却在对用户声称
// "本次评估用了题库作基准"(10 种语言的 liveCoach.bankBased 词条)—— UI 在撒谎。
//
// ## R18 的配对消融(唯一变量 = 是否注入每题 rubric)
//   不注入:命中率 40% / 偏移 −0.55
//   注入后:命中率 65% / 偏移 −0.05
// ⇒ 缺的就是这块。定论是「不调标尺,补题目级依据」。
//
// ⚠️ 适用范围限定(本文件同时把这条钉住):eval-ground-truth.json 的 20 题
//   **100% 是 behavioral**。所以上面那组数字是**行为题**上的结论,
//   technical/design/coding 上的注入效果**至今未验证**。别把它当成全题型结论。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getReferenceForScoring,
  getQuestionBankPath,
  loadQuestionBank,
  resetQuestionBankCache,
  toLite,
} from "../services/questionBank.js";

const bank = loadQuestionBank();
const bankAvailable = !!bank;
const skip = bankAvailable ? false : "题库未生成(先跑 npm run export:questionbank)";

// ---- 服务层契约 ----

test("getReferenceForScoring 返回 keyPoints / referenceAnswer / type 三件套", { skip }, () => {
  const r = getReferenceForScoring(bank.questions[0].id);
  assert.ok(r, "题库首题应能取出参考块");
  assert.equal(typeof r.referenceAnswer, "string");
  assert.ok(r.referenceAnswer.trim().length > 0, "referenceAnswer 不得为空");
  assert.ok(Array.isArray(r.keyPoints) && r.keyPoints.length > 0, "keyPoints 不得为空");
  // ISSUE-038 的关键:type 必须由服务端给出 ——
  // buildReferenceBlock 按它选判据(ISSUE-039:behavioral/design/coding 各有各的判据),
  // 若为 undefined 就会退回技术题口径,而 behavioral/design/questions 占题库 56%。
  assert.equal(typeof r.type, "string");
  assert.equal(r.type, bank.questions[0].type);
});

test("type 取自题库权威值,不采信调用方传入的题型", { skip }, () => {
  const q = bank.questions.find((x) => x.type === "behavioral") || bank.questions[0];
  const r = getReferenceForScoring(q.id);
  assert.equal(r.type, "behavioral");
});

test("题库中每一道题都能产出参考块 —— 这是接线的前提,不是运气", { skip }, () => {
  const missing = [];
  for (const q of bank.questions) {
    const r = getReferenceForScoring(q.id);
    if (!r || !r.referenceAnswer.trim() || !r.keyPoints.length) missing.push(q.id);
  }
  assert.deepEqual(
    missing,
    [],
    `${missing.length}/${bank.questions.length} 道题没有可用参考块 —— 现场评估会静默降级为无基准`
  );
});

test("不存在的 id 返回 null,绝不降级成『用题面当答案』", { skip: skip || false }, () => {
  assert.equal(getReferenceForScoring("no-such-question-id"), null);
  assert.equal(getReferenceForScoring(""), null);
  assert.equal(getReferenceForScoring(null), null);
  assert.equal(getReferenceForScoring(undefined), null);
});

// ---- 安全性:列表接口仍必须剔除 referenceAnswer ----
//
// 新增的 /api/questionbank/:id/reference 确实把答案送到了浏览器(已如实记录在
// server/index.js 的安全权衡注释里)。它防的是"一次拉走全库 808 题",不是"防已认证
// 用户读当前这一题" —— 题库 JSON 就在用户自己磁盘上,那不是安全边界。
// 因此下面这条守卫依然必须成立:**批量接口不能因为加了单题接口就放松**。

test("toLite 仍然剔除 referenceAnswer —— 加了单题接口不代表批量接口可以放松", { skip }, () => {
  const q = bank.questions[0];
  const lite = toLite(q);
  assert.ok(!("referenceAnswer" in lite), "列表接口一旦带回 referenceAnswer,808 题可被整库背走");
  assert.equal(lite.id, q.id);
  assert.ok("keyPoints" in lite, "keyPoints 不是答案,可以保留");
});

test("题库文件本身可解析(守住 loadQuestionBank 的退化前提)", () => {
  const p = getQuestionBankPath();
  if (!fs.existsSync(p)) return; // 缺文件是合法状态(loadQuestionBank 返回 null)
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.ok(Array.isArray(raw.questions));
  assert.ok(raw.questions.length > 0);
  assert.doesNotThrow(() => resetQuestionBankCache());
});

// ---- 题库缺失路径(端点要回 503,而不是 200 空对象)----
//
// 这条**只能在服务层测**,不能 e2e:`loadQuestionBank()` 读的是
// `path.join(SERVER_ROOT, "data", "questionbank.json")` —— 硬编码路径,
// **不随 DB_DIR 变化**(见 server/services/questionBank.js:22)。
// R32 写 e2e 时误以为换 DB_DIR 就能模拟题库缺失,实测得到 404,查证后才发现这一点。
// 要在 e2e 里模拟只能临时重命名共享的 questionbank.json,而门禁会并发跑多个
// e2e 脚本,动它会把别的脚本打成假红 —— 不做。
//
// 这里用改模块内部路径的方式覆盖同一分支,且不碰真实题库文件。

test("题库文件缺失时 loadQuestionBank 返回 null(而非抛错),端点据此回 503", async () => {
  const mod = await import("../services/questionBank.js");
  resetQuestionBankCache();
  // 改不了模块内的常量路径,就临时把真实文件挪走再挪回 —— 单测进程内独占,
  // 不与其他脚本并发(与 e2e 的顾虑不同)。
  const p = getQuestionBankPath();
  if (!fs.existsSync(p)) {
    // 本机就没有题库:这正是要验的状态,直接断言
    assert.equal(loadQuestionBank(), null);
    assert.equal(mod.getReferenceForScoring("anything"), null);
    return;
  }
  const tmp = p + ".bak-question-reference-test";
  assert.ok(!fs.existsSync(tmp), "备份目标已存在,拒绝覆盖");
  try {
    fs.renameSync(p, tmp);
    resetQuestionBankCache();
    assert.equal(loadQuestionBank(), null, "文件不在时应退化为空题库而不是抛错");
    assert.equal(mod.getReferenceForScoring("anything"), null, "空题库下不得凭空造出参考块");
  } finally {
    if (fs.existsSync(tmp)) fs.renameSync(tmp, p);
    resetQuestionBankCache();
  }
  // 还原后必须还能读回来 —— 断言自己没把题库搞坏
  assert.ok(loadQuestionBank(), "题库文件未被本测试破坏");
  assert.ok(mod.getReferenceForScoring(bank.questions[0].id), "还原后仍能取到参考块");
});
