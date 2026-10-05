// 元测试:依赖门禁(deps-check.mjs)自己的判据是否有效
//
// ## 为什么需要"测试测试"
// R45 的变异测试发现:`deps-check.mjs` 判据坏掉后(把 `process.exit(1)` 改成
// `process.exit(0)`),**整条门禁没有任何东西会变红**。
// 而它守护的是 ISSUE-061 ——「依赖门禁只看 node_modules 目录是否存在」,
// 本项目真吃过这个亏(better-sqlite3 11.10.0 在 Node 24 上约 50% 崩溃,
// 目录却一直存在,旧门禁完全无感)。
//
// 一个永远不会被发现的闸门,等于没有闸门。
//
// ## 做法
// 把 deps-check 复制到临时目录,并在临时 `package.json` 里放一个**根本不存在的依赖**,
// 然后断言它**必须失败**。
// 这条断言直接杀掉 G04 那个变异。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SERVER = path.resolve(import.meta.dirname, "..");
const SRC = path.join(SERVER, "scripts", "deps-check.mjs");

/** 在临时目录里搭一个"项目",把 deps-check 复制进去,返回运行结果 */
function runGateWith(dependencies) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-depcheck-meta-"));
  try {
    // deps-check 用 `path.resolve(import.meta.dirname, "..", "package.json")` 找清单,
    // 所以复制到 <tmp>/scripts/ 下,它就会读 <tmp>/package.json
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    fs.copyFileSync(SRC, path.join(tmp, "scripts", "deps-check.mjs"));
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "meta-fixture", version: "0.0.0", dependencies }, null, 2)
    );
    const r = spawnSync(process.execPath, [path.join(tmp, "scripts", "deps-check.mjs")], {
      encoding: "utf8",
      // ⚠️ cwd 要指到别处,否则 createRequire 仍会从真实项目解析 node_modules
      cwd: tmp,
    });
    return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 已删 */ }
  }
}

test("元测试:依赖缺失时 deps-check 必须失败(否则 ISSUE-061 会静默复发)", () => {
  const r = runGateWith({ "this-package-really-does-not-exist-9f3a2b": "^1.0.0" });
  assert.notEqual(r.code, 0, "依赖不存在却判通过 —— 这个门禁已经失效了");
  assert.match(r.out, /无法加载|this-package-really-does-not-exist-9f3a2b/);
});

// ⚠️ 这里**故意不放**"空依赖清单应通过"的对照组。
//   `deps-check.mjs` 末尾有一段**固定的** better-sqlite3 原生冒烟
//   (开内存库→查询→关闭),它不来自 package.json 的依赖清单 ——
//   正是 R1 发现 better-sqlite3 11.10.0 在 Node 24 上约 50% 崩溃才加的。
//   所以在临时目录里跑时它必然失败(找不到模块),空清单也不例外。
//   "第一条不是永远失败"这件事由下面那条**真实项目通过**的正向对照保证。

test("元测试:真实项目的依赖清单必须能被 deps-check 加载(正向对照)", () => {
  // 直接跑真实脚本:它必须返回 0,否则门禁平时就该红。
  const r = spawnSync("npm", ["--prefix", SERVER, "run", "--silent", "deps:check"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `真实项目的依赖门禁失败:\n${(r.stdout || "").slice(-600)}`);
});
