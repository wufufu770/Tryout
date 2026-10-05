// 元测试:静默 catch 闸门(check-silent-catch.mjs)自己的判据是否有效
//
// ## 为什么放在 src/lib 而不是 scripts/
// `web/vite.config.ts` 的 `test.include` 是 `["src/**/*.{test,spec}.{ts,tsx}"]`,
// **不收 `scripts/` 下的文件**。第一版把这个测试写在自己脚本旁边,
// 结果 vitest 根本没收集它 —— 一条"看起来加了测试"的测试,实际一次都没跑过。
// (与 R45 里 mutation-test-gates 的验证命令选错是同一类错误:**写了 ≠ 会被执行**。)
//
// ## 为什么需要
// R45 变异测试:G01(把 `if (!code)` 改成 `if (false)`)存活,
// 而 `npm test` 抓不到它 —— 这个脚本**没有任何自动化测试**。
// 它守护的是 ISSUE-057:面试页 `addMessage` 的 `catch {}` 把数据丢了却只 console.warn。
// 闸门一坏,ISSUE-057 就能静默复发,而门禁照样全绿。
//
// ## 做法
// 造几个最小源码样本,断言闸门**必须拒���**该拒的、**必须放过**该放行的。
// 直接杀掉 G01 这个变异。
import { test, expect } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const WEB = path.resolve(import.meta.dirname, "..", "..");
const SRC = path.join(WEB, "scripts", "check-silent-catch.mjs");

/** 把一段源码写成临时文件,跑闸门,返回退出码与输出 */
function runGate(sourceText) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-silentcatch-meta-"));
  try {
    fs.writeFileSync(path.join(tmp, "Probe.tsx"), sourceText, "utf8");
    // ⚠️ 必须用 `--dir` 指到临时目录:闸门默认只扫 `web/src`。
    //    第一版没传这个参数,样本在 /tmp 被完全无视,
    //    于是"空 catch 竟然通过了闸门" —— 看着像闸门坏了,其实是**样本没被扫到**。
    const r = spawnSync(process.execPath, [SRC, "--dir", tmp], { encoding: "utf8" });
    return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 已删 */ }
  }
}

const HANDLED = `export function f() {
  try { doIt(); } catch (e) { toastWarning("失败"); }
}`;

const EMPTY = `export function f() {
  try { doIt(); } catch {}
}`;

const DOCUMENTED = `export function f() {
  try { doIt(); } catch { /* 幂等清理,失败无所谓 */ }
}`;

const LOG_ONLY = `export function f() {
  try { doIt(); } catch (e) { console.warn("x", e); }
}`;

test("元测试:有处理的 catch 必须通过(对照组,否则下面都是假阳性)", () => {
  assert.equal(runGate(HANDLED).code, 0, "有 toastWarning 的 catch 不该被判违规");
});

test("元测试:有说明的 catch 必须通过(ISSUE-058 的'已说明'放行)", () => {
  assert.equal(runGate(DOCUMENTED).code, 0, "写了理由的 catch 不该被判违规");
});

test("元测试:完全空的 catch 必须失败(杀掉 G01 变异)", () => {
  const r = runGate(EMPTY);
  assert.notEqual(r.code, 0, "空 catch 竟然通过了 —— 静默 catch 闸门已失效(ISSUE-057 会静默复发)");
  assert.match(r.out, /无处理也无说明|违规|❌/);
});

test("元测试:只有 console 的 catch 记为 logOnly 但**不判失败**(R28 定的口径)", () => {
  // 这条锁的是"别为了让闸门更严而误伤 logOnly 分类" ——
  // R28 明确记过:8 处幂等清理补说明、1 处补日志,这些是**有意放行**的。
  const r = runGate(LOG_ONLY);
  assert.equal(r.code, 0, "仅 console 的 catch 按设计不该让门禁变红");
});
