#!/usr/bin/env node
/*
 * 翻译质量闸门:在写入 locale 文件**之前**校验生成的译文。
 *
 * ## 为什么需要它
 * 2026-10-04 补 416 条译文时,机器生成多次出现污染,且**污染形态各异**:
 *   ja: "特定职位btreeの基準値"        ← 中文「职位」+ 随机英文「btree」
 *   ja: "初めてäng环路で向いている方向け" ← 中文「环路」+ 德文变音「äng」+ 残句
 *   fr: "демarquer"                     ← 俄文「дем」混入法文
 *   ar: "{quote يقتنع به}"               ← 英文残片混入阿文
 *   bn: "গতির基准"                      ← 中文「基准」混入孟加拉文
 * 若无闸门,这些会进仓库并被当作"已翻译"长期存在。人工肉眼扫 416 条不现实,故自动化。
 *
 * ## 校验项
 *   1. 脚本归属:**字母**是否属于该语言 —— 不逐个枚举符号/emoji(枚举必漏,
 *      且 emoji 代理对无法安全写入源文件),改为剥离非字母后再判断
 *   2. 非 CJK 语言不得出现汉字(防"中文串味")
 *   3. 占位符保真:{n} / {id} / {fields} 必须与英文原文完全一致
 *      (此项在补译期间真的抓到了一个既有缺陷 —— 见 ISSUE-013)
 *   4. 空值 / 长度异常 / 控制字符
 *   5. 拉丁噪声:非拉丁语言中出现的拉丁词,必须是现有语料里已存在的技术术语
 *
 * 用法:
 *   node scripts/validate-i18n.mjs                 # 校验全部 locale 现状
 *   node scripts/validate-i18n.mjs --draft x.json  # 校验待写入草稿
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = path.join(WEB, "src", "i18n", "locales");

const CJK_IDEOGRAPH = /[一-鿿㐀-䶿]/;   // 统一表意文字(中日共用)
const KANA = /[぀-ゟ゠-ヿ]/;                        // 日文假名
const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;   // 译文里禁止出现的控制字符。刻意放行 TAB/LF/CR(逐行解析要用);ISSUE-032: 原式用裸控制字节写成 /[<NUL>-<BS>...]/,使整个文件被 file(1) 判为二进制、grep/read 工具无法检索,任何"整理空白"的编辑都可能悄悄改坏这道闸门;这里改成 \x 转义,并补上原先漏拦的 DEL(0x7F)。

/** 各语言的字母集合(只用于判断"字母属于哪种文字") */
const LETTER_SETS = {
  "ar-SA": /[؀-ۿݐ-ݿ]/,
  "bn-BD": /[ঀ-৿]/,
  "es-ES": /[A-Za-zÀ-ÿ]/,
  "fr-FR": /[A-Za-zÀ-ÿŒœŸ]/,
  "hi-IN": /[ऀ-ॿ]/,
  "ja-JP": /[぀-ゟ゠-ヿ一-鿿]/,
  "pt-BR": /[A-Za-zÀ-ÿ]/,
  "ru-RU": /[Ѐ-ӿ]/,
};
/** 使用拉丁字母的语言 */
const LATIN_SCRIPT = new Set(["es-ES", "fr-FR", "pt-BR"]);

const BASELINE_FILE = path.join(WEB, "scripts", "i18n-quality-known-issues.json");
const en = JSON.parse(fs.readFileSync(path.join(LOCALES, "en-US.json"), "utf8"));

/**
 * 拉丁技术术语白名单:**从现有译言语料自动提取**。
 * 作者已写的 URL / Agent / GitHub / ByteDance 等是合法的,手写白名单必然漏;
 * 而生成噪声(btree / optimise / wrong)在语料里根本不存在。
 * 以「现有译文里出现过的拉丁词」为白名单 —— 精准且免维护。
 */
function buildLatinWhitelist() {
  const set = new Set([
    "API", "URL", "AI", "PDF", "DOCX", "MD", "ID", "npm", "run", "export",
    "questionbank", "web", "dir", "STAR", "CEO", "HR", "OAuth", "HTTP", "HTTPS",
    "JSON", "SQL", "LLM", "GOP", "XFF", "TTL", "CORS", "E2E", "PII", "SSRF", "XR",
    "IT", "OK", "GitHub", "Agent", "Ctrl", "Key", "Base", "Local", "Error",
    "ByteDance", "Alibaba", "Tencent", "Webhook", "Node", "Docker",
  ]);
  for (const f of fs.readdirSync(LOCALES).filter((x) => x.endsWith(".json"))) {
    const locale = f.replace(/\.json$/, "");
    if (locale === "zh-CN" || locale === "en-US") continue;
    const d = JSON.parse(fs.readFileSync(path.join(LOCALES, f), "utf8"));
    for (const v of Object.values(d)) {
      for (const w of String(v).replace(/\{[^}]*\}/g, "").match(/[A-Za-z]{2,}/g) || []) set.add(w);
    }
  }
  return set;
}
const LATIN_WHITELIST = buildLatinWhitelist();

const placeholdersOf = (s) =>
  [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/** 校验一条译文;返回问题列表(空数组 = 通过) */
export function validateOne(locale, key, value, refEn) {
  const problems = [];
  if (typeof value !== "string" || !value.trim()) return ["空值或非字符串"];
  if (CTRL.test(value)) problems.push("含控制字符");
  if (value.length > 600) problems.push(`长度异常(${value.length})`);

  // 占位符必须先剥离,否则 {id} 里的字母会被误当成噪声
  const stripped = value.replace(/\{[^}]*\}/g, "");

  // 1. 脚本归属
  const letterSet = LETTER_SETS[locale];
  if (letterSet && LATIN_SCRIPT.has(locale)) {
    // 拉丁系语言:逐字母判断是否混入他种文字(它们自身就是拉丁字母,词级白名单无意义)
    const bad = [...stripped].filter((ch) => /\p{L}/u.test(ch) && !letterSet.test(ch));
    if (bad.length) {
      problems.push(`混入非本语言字母「${[...new Set(bad)].join("")}」`);
    }
  }
  // 非拉丁语言(ar/bn/hi/ja/ru)自身不含拉丁字母,故拉丁词必须来自语料白名单,
  // 否则多半是生成噪声 —— 见下方第 3 项。这里只查中文串味。
  if (locale !== "ja-JP" && CJK_IDEOGRAPH.test(value)) {
    const hit = value.match(new RegExp(CJK_IDEOGRAPH.source, "g")) || [];
    problems.push(`含中文字符「${[...new Set(hit)].join("")}」(${locale} 不应出现汉字)`);
  }
  if (locale === "ja-JP" && !KANA.test(value) && !CJK_IDEOGRAPH.test(value)) {
    problems.push("ja-JP 译文不含任何假名/汉字,疑为未翻译");
  }

  // 2. 占位符保真(与英文原文比对)
  const ref = refEn ?? en[key];
  if (ref !== undefined && placeholdersOf(value) !== placeholdersOf(ref)) {
    problems.push(
      `占位符不一致:译文「${placeholdersOf(value)}」vs 英文「${placeholdersOf(ref)}」`,
    );
  }

  // 3. 拉丁噪声(仅非拉丁语言)
  if (letterSet && !LATIN_SCRIPT.has(locale)) {
    const suspicious = (stripped.match(/[A-Za-z]{2,}/g) || [])
      .filter((w) => !LATIN_WHITELIST.has(w));
    if (suspicious.length) {
      problems.push(`含语料中不存在的拉丁词「${suspicious.join(",")}」,疑为生成噪声`);
    }
  }
  return problems;
}

/* ---------------- CLI ---------------- */
if (process.argv.includes("--update-baseline")) {
  const out = [];
  for (const f of fs.readdirSync(LOCALES).filter((x) => x.endsWith(".json"))) {
    const locale = f.replace(/\.json$/, "");
    if (locale === "zh-CN" || locale === "en-US") continue;
    const d = JSON.parse(fs.readFileSync(path.join(LOCALES, f), "utf8"));
    for (const [k, v] of Object.entries(d)) {
      if (validateOne(locale, k, v, en[k]).length) out.push(`${locale}/${k}`);
    }
  }
  out.sort();
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`  📝 已更新质量豁免基线:${out.length} 条`);
  process.exit(0);
}

const draftIdx = process.argv.indexOf("--draft");
if (draftIdx !== -1) {
  const draft = JSON.parse(fs.readFileSync(process.argv[draftIdx + 1], "utf8"));
  let bad = 0, okc = 0;
  for (const [locale, entries] of Object.entries(draft)) {
    for (const [key, value] of Object.entries(entries)) {
      const problems = validateOne(locale, key, value, en[key]);
      if (problems.length) {
        bad++;
        console.log(`  ❌ ${locale} / ${key}`);
        console.log(`     值: ${String(value).slice(0, 90)}`);
        for (const p of problems) console.log(`     · ${p}`);
      } else okc++;
    }
  }
  console.log(`\n  结果:${okc} 条通过 / ${bad} 条有问题`);
  process.exit(bad > 0 ? 1 : 0);
} else {
  const baseline = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) : [];
  const known = new Set(baseline);
  let total = 0, bad = 0, knownCount = 0;
  for (const f of fs.readdirSync(LOCALES).filter((x) => x.endsWith(".json"))) {
    const locale = f.replace(/\.json$/, "");
    if (locale === "zh-CN" || locale === "en-US") continue;
    const d = JSON.parse(fs.readFileSync(path.join(LOCALES, f), "utf8"));
    for (const [k, v] of Object.entries(d)) {
      total++;
      const p = validateOne(locale, k, v, en[k]);
      if (p.length) {
        if (known.has(`${locale}/${k}`)) { knownCount++; continue; }
        bad++;
        if (bad <= 20) console.log(`  ❌ ${locale}/${k}: ${p.join("; ")}`);
      }
    }
  }
  console.log(`\n  校验 ${total} 条现有译文:新问题 ${bad} 条,已知豁免 ${knownCount} 条`);
  if (knownCount) {
    console.log(`  (已知豁免清单:scripts/i18n-quality-known-issues.json,共 ${baseline.length} 条)`);
  }
  process.exit(bad > 0 ? 1 : 0);
}
