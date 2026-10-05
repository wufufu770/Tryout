#!/usr/bin/env node
/*
 * 闸门:前端不得存在**既无处理、又无说明**的 catch 块
 *
 * ## 为什么需要它
 * ISSUE-057(GroupInterviewPage)的 `catch {}` 造成**真实数据丢失**:
 * 消息先乐观更新进 UI、再异步落库,落库失败时 catch 是空的 ——
 * 不回滚、不提示、连 console 都没有。结果:UI 里消息在、DB 里没有,
 * **刷新页面就凭空消失**,而用户从头到尾不知道发生过一次丢失。
 *
 * 这类缺陷能长期潜伏,是因为 9 个前端页面**零测试覆盖**,
 * 而空 catch 不会让任何现有测试变红 —— 功能"正常",只是悄悄丢东西。
 *
 * ## 判定标准
 * catch 块体只有三种状态,前两种放行、第三种判失败:
 *   ✅ 有处理逻辑(回滚 / 提示 / 重试 / 状态变更 ……)
 *   ✅ 只有注释 —— 写明了为什么可以忽略。留一行理由,才能被 grep 到、
 *      能在重构时被质疑。**本闸门自身就依赖这一点**。
 *   ❌ 完全空 —— 没有任何可辩护的用途。
 *
 * 另有一类**只 console.* 而不呈现给用户**的 catch,不判失败但会列出来:
 * 多数是有意的后台同步,是否需要提示属产品判断。
 *
 * ## 这个闸门自己踩过的坑(值得记)
 * 第一版用 `catch (...){ *}` 正则,结果:
 *   - 没剥注释 → 把「catch + 说明性注释」判成违规(假阳性)
 *   - 剥了注释 → 同一处又变回空块,还是判成违规
 * 两版都错。正解是**先取出块体原文,再分别判断"有无逻辑"和"有无注释"**。
 *
 * 用法:node scripts/check-silent-catch.mjs
 */
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");
// R45:支持 `--dir <绝对路径>` 覆盖扫描根。
// 为什么需要:**可测试性**。这个脚本决定门禁红绿,却没有任何自动化测试 ——
// R45 的变异测试发现把 `if (!code)` 改成 `if (false)` 不会被任何东西抓到。
// 要给它写元测试,就必须能把"待检样本"放到**它真的会去看的地方**;
// 原来硬编码 `web/src`,元测试在 /tmp 造文件它根本看不见,于是
// "空 catch 竟然通过了闸门" —— 看着是闸门坏了,其实是**样本没被扫到**。
// 向后兼容:不带 --dir 时行为与原来完全一致。
const _dirIdx = process.argv.indexOf("--dir");
const SRC = _dirIdx >= 0 && process.argv[_dirIdx + 1]
  ? path.resolve(process.argv[_dirIdx + 1])
  : path.join(WEB, "src");

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name) ? [p] : [];
  });

// 匹配 catch 块:{ 到配对的 } 之间(不跨嵌套大括号,够用且不会误吞整个函数)
const CATCH = /catch\s*(?:\(\s*([A-Za-z_$][\w$]*)\s*\))?\s*\{([^{}]*)\}/g;

const violations = [];
const documented = [];
const logOnly = [];
let files = 0;

for (const f of walk(SRC)) {
  files++;
  const rel = path.relative(path.dirname(SRC), f);
  const raw = fs.readFileSync(f, "utf8");
  // ⚠️ 位置保持地剥注释(用等长空格替换)后再匹配。
  //   两版都踩过坑:不剥 → 把「catch + 说明性注释」判成违规;
  //   剥了但拿剥后的文本判断"有无注释" → 说明性 catch 又变回"无注释"。
  //   正确做法:**在剥注释后的文本上匹配**(避开注释里出现的 `catch {}` 字样),
  //   再回到**原文同一区间**判断有没有注释。
  //   第三版才踩到:注释里写「原先是 `catch {}`」被正则当成真的空 catch。
  const src = raw.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  for (const m of src.matchAll(CATCH)) {
    const bodyRaw = raw.slice(m.index, m.index + m[0].length);
    const line = raw.slice(0, m.index).split("\n").length;
    const hasComment = /\/\/[^\n]*|\/\*[\s\S]*?\*\//.test(bodyRaw);
    const code = (m[2] || "").trim();
    if (!code) {
      (hasComment ? documented : violations).push(`${rel}:${line}`);
      // 注意不能加 s 标志:`.*` 会跨行贪婪匹配,把
      // `console.error(...); toastWarning(...)` 两条语句误判成"只有 console"
      } else if (code.startsWith("console.") && code.split(";").filter((x) => x.trim()).every((x) => x.trim().startsWith("console."))) {
      logOnly.push(`${rel}:${line}`);
    }
  }
}

console.log(`\n  扫描 ${files} 个前端源文件`);
console.log(`  ❌ 无处理也无说明的 catch : ${violations.length}`);
console.log(`  ✅ 只有注释(已说明理由)  : ${documented.length}`);
console.log(`  ℹ️  只 console 不呈现用户  : ${logOnly.length}`);

if (logOnly.length) {
  console.log("\n  只记录日志、不呈现给用户的 catch(不判失败,仅供参考):");
  for (const l of logOnly) console.log(`     ${l}`);
}

if (violations.length === 0) {
  console.log("\n  ✅ 每一条 catch 都有处理逻辑或写明了忽略理由\n");
  process.exit(0);
}
console.log("");
for (const v of violations) {
  console.log(`  ❗ ${v}  失败被完全吞掉:既无回滚/提示,也无一行说明`);
  console.log(`     → 要么补处理逻辑,要么写一行注释说明为什么可以忽略`);
}
console.log("");
process.exit(1);
