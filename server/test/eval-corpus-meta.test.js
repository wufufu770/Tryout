// 元测试:评测语料校验闸门(check-eval-corpus.mjs)自己的判据是否有效
//
// ## 为什么需要
// R45 的变异测试发现:把
//   - `if (rk !== "ABCDE") err(...)`          → `if (false) err(...)`
//   - `if (a.level !== a.expectedLetter)`     → `if (false) {`
// 两处判据失效后,**没有任何东西会变红**。
// 而这个闸门守护的是 R33~R43 一整轮评测结论的基准 ——
// 语料一旦档位错配,评测会照常打印一张漂亮的准确性表格,只是把错的当基准。
//
// ## 做法
// 在临时目录里搭一套"语料 + 题库 + 闸门脚本",故意造出**违规语料**,
// 断言闸门**必须拒绝**。这直接杀掉那两个变异。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SERVER = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(SERVER, "..");
const SRC = path.join(SERVER, "scripts", "check-eval-corpus.mjs");
const REAL_BANK = path.join(SERVER, "data", "questionbank.json");

/**
 * 搭一套临时语料环境并跑闸门。
 * 闸门用 `path.resolve(import.meta.dirname, "..", "..")` 找根,
 * 所以目录结构必须复刻:<tmp>/server/scripts + <tmp>/web/scripts + <tmp>/server/data
 */
function runGateWith(cases) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-corpus-meta-"));
  try {
    fs.mkdirSync(path.join(tmp, "server", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "server", "data"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "web", "scripts"), { recursive: true });
    fs.copyFileSync(SRC, path.join(tmp, "server", "scripts", "check-eval-corpus.mjs"));
    fs.copyFileSync(REAL_BANK, path.join(tmp, "server", "data", "questionbank.json"));
    fs.writeFileSync(
      path.join(tmp, "web", "scripts", "eval-ground-truth.json"),
      JSON.stringify({ cases }, null, 2)
    );
    const r = spawnSync(process.execPath, [path.join(tmp, "server", "scripts", "check-eval-corpus.mjs")], {
      encoding: "utf8",
    });
    return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 已删 */ }
  }
}

// 题库里真实存在的题(从题库文件读,不写死)
const REAL_Q = JSON.parse(fs.readFileSync(REAL_BANK, "utf8")).questions[0];
const REAL_ID = REAL_Q.id;

/** 造一道"结构完全正确"的题作为基线,再按需破坏某一处 */
function goodCase(id, qid) {
  return {
    id,
    questionId: qid,
    // ⚠️ 必须是**题库原文**:闸门会比对题干(这是 R33 修的"手抄漂移"缺陷)。
    //   这里最初写占位符,基线被正确拒绝 —— 闸门在工作,是我的样本不对。
    question: REAL_Q.content,
    rubric: { A: "甲档要求一二三", B: "乙档要求一二", C: "丙档要求一", D: "丁档有错", E: "戊档无关" },
    answers: ["A", "B", "C", "D", "E"].map((L) => ({
      level: L,
      expectedLetter: L,
      expectedScore: { A: 5, B: 4, C: 3, D: 2, E: 1 }[L],
      text: `${L} 档答案,内容足够长以通过最小长度检查,不重复。`,
    })),
  };
}

test("元测试:合法语料必须通过(否则下面几条会变成'永远失败'的假阳性)", () => {
  const r = runGateWith([goodCase("meta-ok", REAL_ID)]);
  assert.equal(r.code, 0, `合法语料被拒:\n${r.out.slice(0, 400)}`);
});

test("元测试:rubric 缺档(杀掉 G02 变异)", () => {
  const c = goodCase("meta-badrubric", REAL_ID);
  delete c.rubric.D;                       // 少一档
  const r = runGateWith([c]);
  assert.notEqual(r.code, 0, "rubric 缺 D 档却判通过 —— 语料闸门已失效");
  assert.match(r.out, /rubric|档位/);
});

test("元测试:level 与 expectedLetter 不一致(杀掉 G03 变异)", () => {
  const c = goodCase("meta-mismatch", REAL_ID);
  c.answers[1].expectedLetter = "D";        // level=B 但 expectedLetter=D
  const r = runGateWith([c]);
  assert.notEqual(r.code, 0, "level 与 expectedLetter 不一致却判通过 —— 语料闸门已失效");
  assert.match(r.out, /expectedLetter/);
});

test("元测试:expectedScore 与 level 不符", () => {
  const c = goodCase("meta-badscore", REAL_ID);
  c.answers[0].expectedScore = 1;           // level=A 却是 1 分
  const r = runGateWith([c]);
  assert.notEqual(r.code, 0, "expectedScore 与 level 不符却判通过");
});

test("元测试:两档答案文本完全相同(复制粘贴)", () => {
  const c = goodCase("meta-dup", REAL_ID);
  c.answers[2].text = c.answers[3].text;
  const r = runGateWith([c]);
  assert.notEqual(r.code, 0, "两档答案相同却判通过");
  assert.match(r.out, /相同|复制/);
});

test("元测试:questionId 不在题库里", () => {
  const r = runGateWith([goodCase("meta-noq", "no-such-question-id-xyz")]);
  assert.notEqual(r.code, 0, "题库外的 questionId 却判通过");
  assert.match(r.out, /不在题库/);
});

test("元测试:真实项目的语料必须通过(正向对照)", () => {
  const r = spawnSync("npm", ["--prefix", SERVER, "run", "--silent", "check:corpus"], { encoding: "utf8" });
  assert.equal(r.status, 0, `真实语料校验失败:\n${(r.stdout || "").slice(-500)}`);
});
