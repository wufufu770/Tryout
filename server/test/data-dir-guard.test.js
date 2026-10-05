// 单元测试:数据目录解析必须只有一个来源(守卫 ISSUE-051)
//
// ## 缺陷
// `crypto.js` 与 `db.js` 各自独立解析数据目录,且**默认值不一致**:
//
//   crypto.js :  process.env.DB_DIR || process.cwd()          → <cwd>/.master_key
//   db.js      :  DB_DIR || (DOCKER==="1" ? "/data" : cwd+"/data")
//                                                            → <cwd>/data/tryout.db
//
// 而 `npm start` 就是 `node index.js`,**不设 DB_DIR** —— 也就是说默认启动下
// 数据库在 `data/` 里、主密钥在 `data/` **外面**。三个真实后果:
//
//   1. 备份 `data/` 目录时**不含主密钥**,恢复后所有密文不可解密
//   2. 日后有人设了 `DB_DIR=<...>/data`,就切换到**另一个**密钥文件,
//      此前存入的 API Key 全部静默失效 —— `decryptSecret` 返回 null,
//      调用方看起来就像"用户从没配过 key"
//   3. 同一台机器上凭空多出两个内容不同的主密钥文件
//      (R21 在本机实测到 `server/data/.master_key` 与 `server/.master_key` 不一致)
//
// 这不是理论推演:R17~R21 我反复以不同环境变量组合重启服务,亲手制造了这两个文件。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("主密钥文件必须与数据库同目录", async () => {
  const { DB_DIR, MASTER_KEY_FILE } = await import("../paths.js");
  assert.equal(
    path.dirname(MASTER_KEY_FILE), DB_DIR,
    "主密钥必须落在 DB_DIR 内,否则备份不含密钥、迁移会丢密文",
  );
  assert.equal(path.basename(MASTER_KEY_FILE), ".master_key");
});

test("crypto.js 与 db.js 必须共用同一个 DB_DIR 定义", async () => {
  const paths = await import("../paths.js");
  const { DB_DIR_EXPORT } = await import("../db.js");
  assert.equal(
    DB_DIR_EXPORT, paths.DB_DIR,
    "db.js 导出的 DB_DIR 与 paths.js 不一致 —— 又出现了第二个数据目录定义",
  );
  // crypto.js 的 KEY_FILE 是模块内私有常量,这里通过"同目录"间接验证:
  // 它的值就是 paths.MASTER_KEY_FILE(构造方式相同,已在实现处对齐)
  assert.equal(path.dirname(paths.MASTER_KEY_FILE), paths.DB_DIR);
});

test("paths.js 不得被绕过 —— 源码里不允许再出现独立的 DB_DIR 解析", () => {
  // ⚠️ R23(ISSUE-052):第一版只扫 crypto.js 与 db.js 两个文件,
  //   结果漏掉了 auth.js 里的**同构第三例**(token 文件同样解析到 cwd 而非 cwd/data)。
  //   窄守卫给了虚假的安全感 —— 现在扫**整个服务端**。
  const serverDir = path.resolve(import.meta.dirname, "..");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : walk(p);
    return d.isFile() && d.name.endsWith(".js") ? [p] : [];
  });
  const offenders = [];
  for (const file of walk(serverDir)) {
    const rel = path.relative(serverDir, file);
    if (rel === "paths.js") continue;          // 唯一允许出现独立解析的地方
    const code = fs.readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");   // 去注释,避免匹配说明性示例
    if (/process\.env\.DB_DIR\s*\|\|/.test(code)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [],
    `这些文件仍在独立解析数据目录,必须改用 paths.js:${offenders.join(", ")}`);
});

test("token / 主密钥 / 数据库三者必须同处一个目录", () => {
  const serverDir = path.resolve(import.meta.dirname, "..");
  const strip = (f) => fs.readFileSync(path.join(serverDir, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert.match(strip("auth.js"), /TOKEN_FILE\s*=\s*path\.join\(DB_DIR,/,
    "auth.js 的 token 文件必须由 DB_DIR 拼出");
  assert.match(strip("crypto.js"), /KEY_FILE\s*=\s*MASTER_KEY_FILE/,
    "crypto.js 的主密钥必须取 paths.MASTER_KEY_FILE");
});

test("默认(不设 DB_DIR)时解析到 cwd/data 而不是 cwd", async () => {
  const { DB_DIR } = await import("../paths.js");
  // 本测试进程未设 DB_DIR,因此必须落在 cwd/data 下
  if (!process.env.DB_DIR) {
    assert.equal(DB_DIR, path.join(process.cwd(), "data"));
    assert.notEqual(DB_DIR, process.cwd(), "绝不能把数据目录解析成 cwd 本身");
  }
});
