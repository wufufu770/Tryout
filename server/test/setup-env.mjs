// 测试环境引导(由 package.json 的 test 脚本通过 --import 预加载)
// 目的:db.js 在**模块加载时**就 mkdir + 连接数据库,因此 DB_DIR 必须在
// 任何测试文件 import db.js 之前就位。
// 已由外部设置时(CI 的 DB_DIR=/tmp/tryout-test、build.sh 的唯一临时目录)一律尊重,
// 避免覆盖调用方的显式配置;未设置时落到系统临时目录的一次性目录,
// 既跨平台,又不会把测试数据写进 server/data 污染开发库。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.DB_DIR) {
  process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tryout-test-"));
}
