// 元测试:题库注入路径 + `getReferenceForScoring` 的"空 keyPoints"分支
//
// ## 为什么需要
// R45 的变异测试 V07(去掉"清洗后 keyPoints 为空 ⇒ 返回 null"的判据)杀不死,
// 因为**该分支在现有数据下不可达**:题库 808 题没有一道 keyPoints 清洗后为空。
// 我当时的结论是"无法覆盖,已如实标注"。
//
// 但那个理由站不住 —— 真正的问题是"**题库路径写死**",不是"必须有这种题"。
// R46 给 `questionBank.js` 加了 `INTERVIEWX_QUESTIONBANK_PATH` 覆盖,
// 于是元测试可以在**临时题库**里造那道题,真题库一个字节都不动。
//
// ⚠️ 顺带说明为什么必须**注入路径**而不是往真题库塞假题:
// 题库是 `npm run export:questionbank` 的产物,生产运行时会读它。
// 往里塞一道为测试服务的假题,等于让测试数据进入运行时数据源。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const QUESTION_BANK_PATH = path.resolve(
  process.env.INTERVIEWX_QUESTIONBANK_PATH ||
    path.resolve(import.meta.dirname, "..", "data", "questionbank.json")
);

/**
 * 造一个只含"边界题"的临时题库,并在**独立子进程**里跑断言。
 * 必须在子进程里做:`questionBank.js` 在 import 时就固化了路径并缓存,
 * 同进程内换文件不会生效。
 */
function withBank(bank, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-qbank-"));
  const file = path.join(tmp, "questionbank.json");
  try {
    fs.writeFileSync(file, JSON.stringify(bank), "utf8");
    return fn(file);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 已删 */ }
  }
}

/** 在子进程里用指定题库跑一小段断言代码,返回 {ok, msg} */
function runProbe(file, code) {
  const script = `
    process.env.INTERVIEWX_QUESTIONBANK_PATH = ${JSON.stringify(file)};
    const mod = await import(${JSON.stringify(
      path.resolve(import.meta.dirname, "..", "services", "questionBank.js")
    )});
    const out = await (async () => { ${code} })();
    process.stdout.write("__OK__" + JSON.stringify(out ?? null));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  const m = (r.stdout || "").indexOf("__OK__");
  return { ok: m >= 0, data: m >= 0 ? JSON.parse(r.stdout.slice(m + 6)) : null, err: r.stderr || "" };
}

const base = (over = {}) => ({
  id: "probe-q",
  industry: "backend",
  type: "technical",
  difficulty: "mid",
  title: "t",
  content: "c",
  keyPoints: ["k"],
  referenceAnswer: "ra",
  ...over,
});

test("元测试:keyPoints 清洗后为空 ⇒ 必须返回 null(杀掉 V07 变异)", () => {
  const bank = {
    version: "probe",
    questions: [
      base({ id: "empty-arr", keyPoints: [] }),
      base({ id: "blank-str", keyPoints: ["", "  ", "\t"] }),
      base({ id: "has-null", keyPoints: [null, "  "], referenceAnswer: "ra2" }),
    ],
  };
  withBank(bank, (file) => {
    const r = runProbe(
      file,
      `return {
         emptyArr: mod.getReferenceForScoring("empty-arr"),
         blankStr: mod.getReferenceForScoring("blank-str"),
         hasNull: mod.getReferenceForScoring("has-null"),
       };`
    );
    assert.ok(r.ok, `探针执行失败:\n${r.err.slice(0, 400)}`);
    assert.equal(r.data.emptyArr, null, "keyPoints=[] 却返回了参考块");
    assert.equal(r.data.blankStr, null, "keyPoints 全是空白却返回了参考块");
    // 有 null + 空白 ⇒ 清洗后为空 ⇒ 同样必须 null
    assert.equal(r.data.hasNull, null, "keyPoints=[null,'  '] 清洗后为空却返回了参考块");
  });
});

test("元测试:keyPoints 合法时必须正常返回(对照组,别让上一条变成'永远失败')", () => {
  const bank = { version: "probe", questions: [base({ id: "ok", keyPoints: ["a", " b ", ""] })] };
  withBank(bank, (file) => {
    const r = runProbe(file, `return mod.getReferenceForScoring("ok");`);
    assert.ok(r.ok, `探针执行失败:\n${r.err.slice(0, 400)}`);
    assert.ok(r.data, "合法 keyPoints 却返回 null");
    // 清洗应当生效:去掉空串、去空白
    assert.deepEqual(r.data.keyPoints, ["a", "b"], `keyPoints 未被正确清洗:${JSON.stringify(r.data.keyPoints)}`);
    assert.equal(r.data.type, "technical");
  });
});

test("元测试:真实题库路径下必须有内容(正向对照)", () => {
  const bank = JSON.parse(fs.readFileSync(QUESTION_BANK_PATH, "utf8"));
  assert.ok(Array.isArray(bank.questions) && bank.questions.length > 0, "真实题库为空");
});
