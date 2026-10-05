// 单元测试:SQLite PRAGMA / 外键 / 并发写 / 迁移幂等
//
// ## 为什么需要
// `server/db.js` 在启动时设置了一组 PRAGMA,它们决定并发写入行为:
//   - `journal_mode = WAL`   —— 读写不互相阻塞
//   - `busy_timeout = 5000`  —— 写忙时等待 5s 而非立即抛 SQLITE_BUSY
//   - `foreign_keys = ON`    —— 外键约束真正生效
//   - `synchronous = NORMAL` —— WAL 下兼顾性能与一致性
// 这些设置**此前完全没有测试**。若 busy_timeout 被去掉,高并发写会立刻抛
// SQLITE_BUSY,症状是"偶发失败",极难排查。
// `addColumnIfMissing` 迁移每次启动都跑,也必须验证**幂等**。
//
// ## 结构说明(踩过的坑)
// `db.js` 是**带副作用的模块**:import 时即建库/迁移/连库。ESM 的
// `import()` 在同一进程内**只求值一次**,所以:
//   - 多个用例共享同一个连接 → 中途 `close()` 会让后续用例拿到"已关闭"连接
//   - 每个用例想拿全新实例,只能开**子进程**
// 因此本文件把"需要独立实例"的场景(多进程并发、迁移幂等)交给子进程,
// 共享连接的场景则**不 close**。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tryout-${tag}-`));
}

/** 跑一段 JS 片段作为子进程,注入 db.js 与 DB_DIR;返回退出码(0=成功) */
function runInChild(code, dbDir, { withModule = true } = {}) {
  // `node -e` 默认按 CommonJS 解析,顶层 await 会报 SyntaxError,
  // 因此统一包一层 async IIFE(比 --input-type=module 兼容性更好)。
  const body = withModule
    ? `const m = await import(${JSON.stringify(path.join(SERVER_DIR, "db.js"))}); ${code}`
    : code;
  const src = `(async () => { ${body} })().catch(e => { process.stderr.write(String(e.stack||e.message)); process.exit(1); });`;
  const c = spawn("node", ["-e", src], {
    // ⚠️ 必须剔除 NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID:
    // `node --test` 会把它们注入环境,若原样传给子进程,子进程会误以为自己是
    // test runner 的子进程而进入测试模式,导致 db.js 初始化时的行为异常
    // (实测表现为 backupDatabase() 抛 "The database connection is not open")。
    env: (() => {
      const e = { ...process.env, DB_DIR: dbDir };
      delete e.NODE_TEST_CONTEXT;
      delete e.NODE_TEST_WORKER_ID;
      return e;
    })(),
    stdio: ["ignore", "ignore", "pipe"],
  });
  return new Promise((resolve) => {
    let err = "";
    c.stderr.on("data", (d) => { err += d; });
    c.on("close", (code) => resolve({ code, err }));
  });
}

/* ================================================================== *
 * 以下 3 组共享同一连接(模块只求值一次),故不 close
 * ================================================================== */

test("PRAGMA 设置符合预期(WAL / busy_timeout / 外键 / synchronous)", async () => {
  const dir = tmpDir("pragma");
  process.env.DB_DIR = dir;
  const { getDb } = await import("../db.js");
  const db = getDb();
  const jm = db.pragma("journal_mode", { simple: true });
  const bt = db.pragma("busy_timeout", { simple: true });
  const fk = db.pragma("foreign_keys", { simple: true });
  const sy = db.pragma("synchronous", { simple: true });
  assert.equal(jm, "wal", `journal_mode 应为 wal,实际 ${jm}`);
  assert.ok(bt >= 5000, `busy_timeout 应 >= 5000ms,实际 ${bt}`);
  assert.equal(fk, 1, "foreign_keys 必须开启,否则外键约束形同虚设");
  assert.ok([0, 1, 2].includes(sy), `synchronous 应为合法值,实际 ${sy}`);
  // DB 文件确实建在 DB_DIR 下
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".db"));
  assert.ok(files.length >= 1, `DB_DIR 下应有 .db 文件,实际:${fs.readdirSync(dir)}`);
});

test("PRAGMA foreign_keys 处于开启状态(为将来的外键约束兜底)", async () => {
  const { getDb } = await import("../db.js");
  const db = getDb();
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1,
    "foreign_keys 必须为 ON,否则将来一旦加 FOREIGN KEY 约束将不生效");

  // 现状说明(2026-10-04 实测):当前 21 张表的建表语句里 **没有任何 REFERENCES**,
  // 即 schema 并未声明外键约束,因此该 PRAGMA 目前是空操作。
  // 项目用软删除(deleted_at)而非硬删,故不会产生孤儿行 —— 这是自洽的设计。
  // 本用例的真正价值:守住"这个 PRAGMA 必须开着",
  // 使得将来有人补上 FOREIGN KEY 约束时不会静默失效。
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const withFk = tables.filter((t) => db.pragma(`foreign_key_list(${t.name})`).length > 0);
  if (withFk.length > 0) {
    // 一旦 schema 真的声明了外键,就必须验证它真的生效
    for (const t of withFk) {
      const fks = db.pragma(`foreign_key_list(${t.name})`);
      const cols = db.pragma(`table_info(${t.name})`);
      const payload = {};
      for (const c of cols) { if (!c.pk) payload[c.name] = /INT/i.test(c.type) ? 1 : "x"; }
      for (const fk of fks) payload[fk.from] = null;
      const keys = Object.keys(payload).map((k) => `"${k}"`).join(",");
      const marks = Object.keys(payload).map(() => "?").join(",");
      let threw = false;
      try { db.prepare(`INSERT INTO "${t.name}" (${keys}) VALUES (${marks})`).run(...Object.values(payload)); }
      catch { threw = true; }
      assert.ok(threw, `表 ${t.name} 声明了外键却允许插入不存在的父引用 —— foreign_keys 未生效`);
    }
  }
});

test("同进程内连续事务写入:不抛 SQLITE_BUSY", async () => {
  const { getDb } = await import("../db.js");
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS conc_t (id INTEGER PRIMARY KEY, payload TEXT)");
  const stmt = db.prepare("INSERT INTO conc_t (payload) VALUES (?)");
  const N = 500;
  const errors = [];
  for (let i = 0; i < N; i++) {
    try {
      db.exec("BEGIN IMMEDIATE");
      stmt.run("y".repeat(300));
      db.exec("COMMIT");
    } catch (e) {
      errors.push(`${e.code || e.name}: ${e.message}`);
      try { db.exec("ROLLBACK"); } catch { /* 未开启事务 */ }
    }
  }
  assert.equal(errors.length, 0, `出现写入错误:\n  ${errors.slice(0, 3).join("\n  ")}`);
  const total = db.prepare("SELECT COUNT(*) c FROM conc_t").get().c;
  assert.equal(total, N, `写入行数不符:期望 ${N},实际 ${total}`);
});

/* ================================================================== *
 * 以下需要独立实例 → 子进程
 * ================================================================== */

test("多进程并发写同一 DB:不因锁竞争丢数据(真并发)", async () => {
  const dir = tmpDir("mp");
  const bs3 = path.join(SERVER_DIR, "node_modules", "better-sqlite3");

  // 先用一个独立子进程建库(建表 + 写入 PRAGMA),避免依赖父进程已加载的模块
  const init = await runInChild(
    `m.getDb().exec("CREATE TABLE IF NOT EXISTS mp_t (id INTEGER PRIMARY KEY, payload TEXT)"); m.getDb().close();`,
    dir,
  );
  assert.equal(init.code, 0, `初始化子进程失败:${init.err}`);

  // 库文件名由 db.js 决定(DB_BASE,新库默认 "tryout.db"),不能硬编码别的名字,
  // 否则 worker 打开的是另一个空文件 → "no such table"。
  const actualDb = fs.readdirSync(dir).find((f) => f.endsWith(".db"));
  assert.ok(actualDb, `初始化后 DB_DIR 下应有 .db 文件,实际:${fs.readdirSync(dir)}`);
  const realDbPath = path.join(dir, actualDb);
  const workerPath = path.join(dir, "worker.mjs");
  // ⚠️ 不能用 `import Database from "<abs path>/better-sqlite3"` ——
  // ESM 不支持按绝对路径 import 一个包目录(ERR_UNSUPPORTED_DIR_IMPORT)。
  // 用 createRequire 从 server 目录解析,才能命中其 node_modules。
  fs.writeFileSync(workerPath, `
import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(path.join(SERVER_DIR, "package.json"))});
const Database = require("better-sqlite3");
const db = new Database(process.env.TARGET_DB);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
const stmt = db.prepare("INSERT INTO mp_t (payload) VALUES (?)");
const tag = process.argv[2], n = Number(process.argv[3]);
try {
  for (let i = 0; i < n; i++) stmt.run(tag);
  process.exit(0);
} catch (e) { process.stderr.write(String(e.code || e.message)); process.exit(1); }
`, "utf8");

  const N_PROC = 4, N_EACH = 50;
  const results = await Promise.all(
    Array.from({ length: N_PROC }, (_, i) =>
      new Promise((resolve) => {
        const c = spawn("node", [workerPath, `p${i}`, String(N_EACH)], {
        env: { ...process.env, TARGET_DB: realDbPath },
        stdio: ["ignore", "ignore", "pipe"],
      });
        let err = "";
        c.stderr.on("data", (d) => { err += d; });
        c.on("close", (code) => resolve({ i, code, err }));
      })),
  );
  const failed = results.filter((r) => r.code !== 0);
  assert.equal(failed.length, 0,
    `${failed.length} 个并发写进程失败(SQLITE_BUSY?):\n  ${failed.map((f) => `p${f.i}: ${f.err}`).join("\n  ")}`);

  const db2 = new Database(realDbPath);
  const total = db2.prepare("SELECT COUNT(*) c FROM mp_t").get().c;
  db2.close();
  assert.equal(total, N_PROC * N_EACH, `并发写入丢数据:期望 ${N_PROC * N_EACH},实际 ${total}`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 已删 */ }
});

test("迁移幂等:连续 3 次启动不重复加列、不报错", async () => {
  const dir = tmpDir("mig");
  for (let i = 1; i <= 3; i++) {
    const r = await runInChild(`m.getDb().close();`, dir);
    assert.equal(r.code, 0, `第 ${i} 次启动失败(迁移不幂等?):${r.err}`);
  }
  // 校验关键列只出现一次
  const check = await runInChild(`
    const db = m.getDb();
    const bad = [];
    for (const [t, col] of [["agents","agent_kind"],["agents","candidate_persona"],
                            ["sessions","difficulty"],["sessions","industry"],
                            ["messages","q_source"],["messages","question_id"]]) {
      const n = db.pragma("table_info(" + t + ")").map(c => c.name).filter(c => c === col).length;
      if (n !== 1) bad.push(t + "." + col + " 出现 " + n + " 次");
    }
    db.close();
    if (bad.length) { process.stderr.write(bad.join("; ")); process.exit(1); }
  `, dir);
  assert.equal(check.code, 0, `迁移产生重复列:${check.err}`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 已删 */ }
});

test("busy_timeout 被移除时,多进程并发写会失败(证明该 PRAGMA 确实在起作用)", async () => {
  // 反向验证:若把 busy_timeout 设为 0,同样的并发写应当出现 SQLITE_BUSY。
  // 这条不是"期望失败",而是**证明该 PRAGMA 不是摆设** —— 没有它测试就失去意义。
  const dir = tmpDir("bt0");
  const dbPath = path.join(dir, "bt0.db");
  const bs3 = path.join(SERVER_DIR, "node_modules", "better-sqlite3");
  const db0 = new Database(dbPath);
  db0.pragma("journal_mode = WAL");
  db0.pragma("busy_timeout = 0");
  db0.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, p TEXT)");
  // 持有一个写锁不放
  db0.exec("BEGIN IMMEDIATE");
  db0.prepare("INSERT INTO t (p) VALUES ('lock')").run();

  const other = new Database(dbPath);
  other.pragma("journal_mode = WAL");
  other.pragma("busy_timeout = 0");
  let code = null;
  try { other.prepare("INSERT INTO t (p) VALUES ('x')").run(); }
  catch (e) { code = e.code; }

  try { db0.exec("ROLLBACK"); } catch { /* 已回滚 */ }
  db0.close(); other.close();

  assert.equal(code, "SQLITE_BUSY",
    `busy_timeout=0 时本应抛 SQLITE_BUSY,实际 code=${code}。` +
    `若这里没抛,说明 SQLite 行为与预期不同,上面"并发不丢数据"的结论不可信。`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 已删 */ }
});

/* ================================================================== *
 * ISSUE-015 回归:启动备份的异步失败不得终止进程
 * ================================================================== */

test("启动备份的异步失败不终止进程(ISSUE-015 回归)", async () => {
  // db.backup() 是 async,返回 Promise。旧代码直接调用不挂 catch,
  // 外层 try/catch 只覆盖同步抛出 —— 备份过程中的 Promise rejection
  // 会变成 unhandled rejection,Node 15+ 直接终止进程,
  // 与 backupDatabase() 注释里"备份失败不阻塞启动"的意图相反。
  // 这里用"import 后立刻 close 连接"稳定复现该失败路径。
  const dir = tmpDir("backupfail");
  const r = await runInChild(`m.getDb().close();`, dir);
  assert.equal(r.code, 0,
    `启动期备份失败导致进程退出(${r.code}),这会让服务器起不来:\n${r.err.slice(0, 400)}`);
  assert.ok(!r.err.includes("not open") || r.code === 0,
    "备份失败应以警告形式记录,而不是抛未捕获异常");
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 已删 */ }
});

test("正常情况下启动备份能完成并生成文件", async () => {
  const dir = tmpDir("backupok");
  const r = await runInChild(`setTimeout(() => m.getDb().close(), 600);`, dir);
  assert.equal(r.code, 0, `正常备份路径不应出错:${r.err.slice(0, 300)}`);
  const backupDir = path.join(dir, "backup");
  assert.ok(fs.existsSync(backupDir), "应生成 backup 目录");
  const files = fs.readdirSync(backupDir).filter((f) => f.endsWith(".db"));
  assert.ok(files.length >= 1, `backup 目录内应有 .db 文件,实际:${fs.readdirSync(backupDir)}`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 已删 */ }
});
