// 数据目录解析 —— `db.js` 与 `crypto.js` 的**唯一**来源
//
// ## 为什么需要这个文件
// 原本 `crypto.js` 用 `process.env.DB_DIR || process.cwd()` 取主密钥文件路径,
// 而 `db.js` 用 `DB_DIR || (DOCKER === "1" ? "/data" : cwd + "/data")`。
// **两者的默认值不一致**,于是不设 `DB_DIR` 启动时(也就是 `npm start` 的默认):
//
//   数据库   →  <cwd>/data/tryout.db      (db.js)
//   主密钥   →  <cwd>/.master_key          (crypto.js)  ← 落在 data/ 外面
//
// 造成三个真实后果:
//   1. 备份 `data/` 目录时**不含主密钥**,恢复后所有密文不可解密
//   2. 日后有人设了 `DB_DIR=<...>/data`,就会切换到**另一个**密钥文件,
//      此前存进去的 API Key 全部静默失效(`decryptSecret` 返回 null,
//      调用方看起来像"用户从没配过 key")
//   3. 同一台机器上凭空多出两个不同的主密钥文件 —— 本机 R21 时实测到
//      `server/data/.master_key` 与 `server/.master_key` 内容不同
//
// 抽成这一个模块是为了让「数据目录」有且只有一个定义,杜绝再次漂移。
// 单独成文件而不是从 `db.js` 导出,是因为依赖方向:
// `db.js` → `crypto.js`(db 调加密),若 `crypto.js` 反向 import `db.js` 会成环。
import fs from "fs";
import path from "path";

// Docker 判定沿用既有惯例(DOCKER=1 由 Dockerfile/compose 注入),
// 不能用 platform 判断:非 Windows 的本地 Linux/macOS 会误落到根目录 /data,
// 非 root 运行时 mkdir '/data' 直接 EACCES。
export const DB_DIR =
  process.env.DB_DIR
  || (process.env.DOCKER === "1" ? "/data" : path.join(process.cwd(), "data"));

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

/** 主密钥文件路径 —— 与数据库同目录,保证一起备份、一起迁移 */
export const MASTER_KEY_FILE = path.join(DB_DIR, ".master_key");
