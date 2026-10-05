#!/usr/bin/env node
/*
 * 闸门:组件里不得出现**绕过 i18n** 的用户可见中文
 *
 * ## 为什么需要它
 * 本项目支持 10 种语言。任何一处写死的中文都会让另外 9 种语言在该处显示中文,
 * 而这类问题**不会让任何现有测试变红**:功能是通的、渲染是正常的、点击也是好的,
 * 只是语言错了。`check-i18n.mjs` 校验的是**词典之间**的 key 对齐,
 * `validate-i18n.mjs` 校验的是**译文质量** —— 两者都管不到
 * 「源码压根没用 t()」这一类。
 *
 * ## 扫描范围与刻意排除
 * 扫 src 下所有 .tsx(排除测试文件),只看两类**用户可见**位置:
 *   1. JSX 文本节点:>中文<
 *   2. 用户可见属性:title / placeholder / aria-label / label / desc …
 *
 * **不扫**下列含中文的地方,它们是正确的中文,本地化反而是错的:
 *   - `promptTemplate`(LLM 提示词模板)、`scoringEngine` / `starEvaluator` 的 prompt
 *   - `src/data/**`(题库、市场模板、经验库)—— 这些是**数据**,不是界面文案
 *   - `console.*`、import、注释
 *   - `.ts` 文件(非 JSX,绝大多数是数据与纯逻辑)
 *
 * ## 精度说明
 * 朴素的 `>中文<` 会把 LLM prompt 里的 `</user_speech>` 之类标签误判成 JSX 文本
 * (第一版就是这么误报的)。现在先检查匹配位置之前的引号是否配平,
 * 落在字符串字面量内部的一律排除。
 * 2026-10-04 首跑结果:**全项目 0 处违规**(否定结果,同样值得记录 ——
 * 说明 i18n 纪律是好的,这条闸门的作用是**防回归**)。
 *
 * 用法:node scripts/check-hardcoded-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");
const SRC = path.join(WEB, "src");

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return e.isFile() && /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });

const CJK = /[一-龥]/;
const DECL_LINE = new RegExp("^\\s*(const|let|var)\\b");
// 这些是「中文是正确的」的位置:LLM 提示词与领域数据
const EXEMPT = /promptTemplate|sy[sS]?temPrompt|userPrompt|sysPrompt|buildDimensionPrompt/;

const hits = [];
let scanned = 0;

for (const f of walk(SRC)) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    scanned++;
    const code = l.replace(/\/\/.*$/, "");
    if (!CJK.test(code)) return;
    if (/^\s*import\b/.test(code)) return;
    if (/console\./.test(code)) return;
    if (EXEMPT.test(code)) return;
    if (DECL_LINE.test(code)) return;
    if (/^\s*(\*|\/\*)/.test(code)) return;

    const jsxText = />\s*([^<>{}\n]*[一-龥][^<>{}\n]*)\s*</.exec(code);
    if (jsxText) {
      // 排除落在字符串字面量内部的匹配(prompt 里的 </tag> 会造成误报)
      const quotes = (code.slice(0, jsxText.index).match(/["'`]/g) || []).length;
      if (quotes % 2 === 0) {
        hits.push({ f: path.relative(WEB, f), l: i + 1, kind: "JSX 文本", text: jsxText[1].trim() });
      }
    }
    const attr = /\b(title|placeholder|aria-label|label|desc|description|emptyText|confirmText)\s*=\s*"([^"]*[一-龥][^"]*)"/.exec(code);
    if (attr) hits.push({ f: path.relative(WEB, f), l: i + 1, kind: `属性 ${attr[1]}`, text: attr[2] });
  });
}

console.log(`\n  扫描 ${scanned} 行 .tsx,疑似绕过 i18n 的用户可见中文:${hits.length} 处`);
if (hits.length === 0) {
  console.log("  ✅ 组件里的界面文案都走了 t(),没有写死的中文\n");
  process.exit(0);
}
for (const h of hits) {
  console.log(`  ❗ ${h.f}:${h.l}  [${h.kind}]  ${JSON.stringify(h.text.slice(0, 50))}`);
  console.log(`     → 补一个 i18n key,在 ${"src/i18n/locales/*.json"} 里加译文,并用 t(\"...\") 替换`);
}
console.log(`\n  注:若确认是 LLM prompt / 领域数据而非界面文案,加进本脚本的 EXEMPT 白名单并写明理由。\n`);
process.exit(1);
