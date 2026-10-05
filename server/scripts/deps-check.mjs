// 依赖健康检查:目录存在 **不等于** 依赖可用
//
// 为什么要它:`build.sh` 的「安装依赖」门禁原先只看
// `[ -d server/node_modules ] && [ -d web/node_modules ]`,
// 于是「目录在、但包损坏 / 版本不对 / 原生模块没 rebuild」这种情况照样放行。
// 本项目正好吃过这个亏:R1 发现 better-sqlite3 11.10.0 在 Node 24 上约 50% 原生崩溃,
// 必须升到 12.11.1 并 `npm rebuild` —— 而 node_modules 目录**一直是存在的**,
// 旧门禁对此完全无感。
//
// 做两件事:
//   1. **从 package.json 实际读取** dependencies 逐个 require
//      (不硬编码清单 —— 我第一版凭印象写了 `zod`,而本项目根本没有 zod:
//       validate.js 是自研的「零依赖仿 Zod」,硬编码清单当场就被自己打脸)
//   2. 对**原生模块**做冒烟:require 通过 ≠ 能用。
//      真的开一个内存库、查一次、关掉 —— ISSUE-009 就是"require 成功但调用即崩"。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "package.json"), "utf-8"));

// 明确不 require 的:`@xenova/transformers` 有可选原生后端,
// 缺失时按设计降级(见 services/whisper.js),不该因此判失败。
const SKIP = new Set(["@xenova/transformers"]);

// ⚠️ 有些包**包根在 Node 下本来就 require 不了**,但项目实际用的是它的某个子路径。
//   pdfjs-dist 就是这样:主入口依赖 DOM(DOMMatrix),而 `services/pdf.js:37`
//   明确用的是 `pdfjs-dist/legacy/build/pdf.mjs`(注释:「legacy build:无 DOM 依赖」)。
//   所以要单独验**实际使用的那个子路径**,而不是包根 ——
//   否则会把"设计如此"误报成"依赖损坏"。
const SUBPATH = {
  "pdfjs-dist": "pdfjs-dist/legacy/build/pdf.mjs",
};

let bad = 0;
const names = Object.keys(pkg.dependencies || {}).filter((n) => !SKIP.has(n));
for (const name of names) {
  try {
    const target = SUBPATH[name] || name;
    const mod = require(target);
    const v = mod?.version || mod?.default?.version || "";
    console.log(`  ✅ ${target}${v ? " " + v : ""}${SUBPATH[name] ? "  (项目使用的子路径)" : ""}`);
  } catch (e) {
    console.log(`  ❌ ${name} 无法加载:${e.message.split("\n")[0]}`);
    bad++;
  }
}

try {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  const r = db.prepare("SELECT 1 AS x").get();
  db.close();
  if (r && r.x === 1) console.log("  ✅ better-sqlite3 原生冒烟通过(开库→查询→关闭)");
  else { console.log("  ❌ 原生查询返回异常"); bad++; }
} catch (e) {
  console.log(`  ❌ better-sqlite3 原生冒烟失败(模块已装但不可用,通常需 npm rebuild):${e.message.split("\n")[0]}`);
  bad++;
}

if (bad > 0) {
  console.error(`\n  依赖健康检查未通过(${bad} 项)。`);
  console.error(`  修复:cd server && npm install --registry=https://registry.npmmirror.com`);
  console.error(`       && npm approve-scripts better-sqlite3 sharp && npm rebuild better-sqlite3 sharp\n`);
  process.exit(1);
}
console.log(`\n  依赖健康检查通过(${names.length + 1} 项)\n`);
