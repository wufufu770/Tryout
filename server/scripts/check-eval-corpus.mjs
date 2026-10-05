#!/usr/bin/env node
/*
 * 评测语料结构校验(闸门)
 *
 * ## 为什么必须有这个
 * `web/scripts/eval-ground-truth.json` 是**人工标注**的 ground truth:
 * 它的每一题都自带 A~E 五档 rubric、五个对应档位的答案,
 * 以及 `expectedLetter` / `expectedScore`。
 * 一旦标注出错(档位错配、答案缺失、题库里没有这道题),
 * 评测会**照常跑完并打印一张漂亮的准确性表格** ——
 * 数字只是衡量"标注与评分器是否一致",标注错了就把错的东西当基准。
 *
 * R17/R18 的结论都建立在这份语料上,所以它出错 = 结论作废。
 *
 * ## 校验项
 *   1. case 结构:字段齐全、id 唯一、questionId 存在于题库
 *   2. rubric 恰好 A~E 五档
 *   3. answers 恰好 5 个,level 覆盖 A~E 且不重复
 *   4. expectedLetter 与 level 恒等,expectedScore 与 level 恒定映射
 *   5. 答案文本非空、且**五档文本互不相同**(复制粘贴同一段是最隐蔽的错误)
 *   6. 题型分布(输出统计,提醒结论的适用范围)
 *
 * 用法:node scripts/check-eval-corpus.mjs
 * 退出码:0 = 通过,1 = 有违规
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const GT_FILE = path.join(ROOT, "web", "scripts", "eval-ground-truth.json");
const BANK_FILE = path.join(ROOT, "server", "data", "questionbank.json");

let pass = 0;
const fail = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };

console.log("▶ 评测语料结构校验");

if (!fs.existsSync(GT_FILE)) fail(`缺少语料文件:${GT_FILE}`);
if (!fs.existsSync(BANK_FILE)) {
  fail(`缺少题库:${BANK_FILE}(先跑 npm run export:questionbank)`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(GT_FILE, "utf8"));
const cases = data.cases || [];
const bank = new Map(
  JSON.parse(fs.readFileSync(BANK_FILE, "utf8")).questions.map((q) => [q.id, q])
);

console.log(`  语料 ${cases.length} 题 / 题库 ${bank.size} 题`);

if (!Array.isArray(cases) || cases.length === 0) {
  fail("cases 为空");
  process.exit(1);
}

const SCORE_OF = { A: 5, B: 4, C: 3, D: 2, E: 1 };
const LETTERS = ["A", "B", "C", "D", "E"];
const seenIds = new Set();
const byType = new Map();
let bad = 0;

for (const c of cases) {
  const at = c?.id || "(无 id)";
  const err = (m) => { fail(`${at}: ${m}`); bad++; };

  if (!c || typeof c !== "object") { err("不是对象"); continue; }

  // 1. 基本结构
  for (const f of ["id", "questionId", "question", "rubric", "answers"]) {
    if (c[f] === undefined || c[f] === null) err(`缺字段 ${f}`);
  }
  if (seenIds.has(c.id)) err(`id 重复(${c.id})`);
  seenIds.add(c.id);

  const q = bank.get(c.questionId);
  if (!q) {
    err(`questionId "${c.questionId}" 不在题库里`);
  } else {
    // question 必须与题库一致 —— 语料里的题干若是手抄的,很快会和题库漂移
    if (typeof c.question === "string" && c.question.trim() !== q.content.trim()) {
      err("question 与题库题干不一致(可能是手抄后漂移)");
    }
    byType.set(q.type, (byType.get(q.type) || 0) + 1);
  }

  // 2. rubric 五档
  if (!c.rubric || typeof c.rubric !== "object") err("rubric 非对象");
  else {
    const rk = Object.keys(c.rubric).sort().join("");
    if (rk !== "ABCDE") err(`rubric 档位不是恰好 A~E(实得:${rk})`);
    for (const L of LETTERS) {
      if (typeof c.rubric[L] !== "string" || c.rubric[L].trim().length < 4) {
        err(`rubric.${L} 缺失或过短`);
      }
    }
  }

  // 3-5. answers
  if (!Array.isArray(c.answers)) { err("answers 非数组"); continue; }
  if (c.answers.length !== 5) err(`answers 应为 5 个,实得 ${c.answers.length}`);

  const levels = [];
  const texts = [];
  for (const a of c.answers) {
    if (!a || typeof a !== "object") { err("answer 非对象"); continue; }
    for (const f of ["level", "expectedLetter", "expectedScore", "text"]) {
      if (a[f] === undefined) err(`answer 缺字段 ${f}`);
    }
    // 4. level 与 expectedLetter 恒等;expectedScore 与 level 恒定映射
    if (a.level !== a.expectedLetter) {
      err(`level(${a.level}) 与 expectedLetter(${a.expectedLetter}) 不一致`);
    }
    if (SCORE_OF[a.level] !== a.expectedScore) {
      err(`expectedScore(${a.expectedScore}) 与 level(${a.level}) 的映射不符(应为 ${SCORE_OF[a.level]})`);
    }
    if (typeof a.text !== "string" || a.text.trim().length < 12) {
      // 阈值 12 而非 20:R33 首跑时用 20,结果把「我们公司比较低调,没有遇到过公关危机。」
      // (19 字符,完全正常的 E 档)判成"标注没写完"。中文 12 字已足够表达一个完整意思,
      // 真正的空答案是 0 字符或只有标点。阈值太严会让校验器变成噪声源,那它就没人看了。
      err(`${a.level} 档答案过短(<12 字符),标注可能没写完`);
    }
    levels.push(a.level);
    texts.push(String(a.text).trim());
  }
  const ls = [...levels].sort().join("");
  if (ls !== "ABCDE") err(`level 未恰好覆盖 A~E(实得:${ls || "空"})`);

  // 5. 五档文本必须互不相同 —— 复制粘贴同一段是人工标注最隐蔽的错误
  const dup = texts.filter((t, i) => texts.indexOf(t) !== i);
  if (dup.length) err(`有 ${dup.length} 档答案文本完全相同(疑似复制粘贴)`);
}

if (bad === 0) {
  ok(`结构校验通过:${cases.length} 题,每题 rubric A~E + 五个对应档位答案`);
}

// 6. 题型分布 —— 决定结论能推广到哪些题
console.log("\n  题型分布(决定评测结论的适用范围):");
const total = cases.length;
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = ((n / total) * 100).toFixed(0);
  console.log(`    ${t.padEnd(12)} ${String(n).padStart(3)} (${pct}%)`);
}
const types = [...byType.keys()];
if (types.length === 1) {
  console.log(
    `\n  ⚠️ 语料**只覆盖 ${types[0]} 一种题型**。` +
    `\n     评测结论不能推广到其他题型 —— R17/R18 的结论曾长期建立在这个盲区上。`
  );
} else if (types.length < 3) {
  console.log(`\n  ⚠️ 语料只覆盖 ${types.length} 种题型,结论的适用范围仍偏窄。`);
}

console.log(`\n通过 ${pass} 项${process.exitCode ? " / 有违规" : ""}`);
