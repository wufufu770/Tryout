#!/usr/bin/env node
/*
 * i18n key 一致性校验(ISSUE-007)
 *
 * ## 背景
 * 项目有 10 个 locale 文件,但:
 *   1. `README.md:135` 宣称"16 种语言",实现只有 10 种 → 文档与实现不符
 *   2. **无任何自动化校验**,各语言 key 集合会随开发漂移而无人察觉
 *   3. 2026-10-04 实测发现:`zh-CN`/`en-US` 有 1301 个叶子 key,
 *      其余 8 种语言各只有 1249 个 —— **各缺 52 个 key**。
 *      运行时回退逻辑是 `dict[key] ?? zhCN[key] ?? key`(`src/i18n/index.tsx:165`),
 *      所以不会崩,但日/俄/阿/西/法/印/孟/葡 8 种语言的用户会看到 52 处**中文文案**。
 *
 * ## 设计:基线 + 防漂移
 * 这 52 个 key 是既有内容债,不是本脚本造成的。翻译工作需要母语者,
 * 不该由脚本或 agent 凭空生成(阿拉伯语/孟加拉语尤其如此)。
 * 因此本脚本采用「已知缺口基线 + 新增漂移即失败」:
 *   - 缺口缩小 → 打印改进,可选收紧基线
 *   - 缺口不变 → 通过
 *   - **出现基线之外的新缺口,或 key 集合发生其他意外变化 → 退出码 1**
 * 这样既能防止未来继续漂移,又不会让既有内容债把构建永久堵死。
 *
 * 用法:
 *   node scripts/check-i18n.mjs           # CI/门禁模式
 *   node scripts/check-i18n.mjs --report  # 只打印报告,永远退出 0
 *   node scripts/check-i18n.mjs --update-baseline   # 收紧基线为当前缺口
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = path.join(WEB, "src", "i18n", "locales");
const BASELINE_FILE = path.join(WEB, "scripts", "i18n-known-gaps.json");
const REFERENCE = "zh-CN";

const REPORT_ONLY = process.argv.includes("--report");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

/** 把嵌套字典摊平成点号路径的叶子 key 集合 */
function flatten(obj, prefix = "") {
  const out = new Set();
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.add(...flatten(v, key));
    else out.add(key);
  }
  return out;
}

const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json")).sort();
if (!files.includes(`${REFERENCE}.json`)) {
  console.error(`❌ 缺少基准语言文件 ${REFERENCE}.json`);
  process.exit(1);
}

const refSet = flatten(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${REFERENCE}.json`), "utf8")));
const expectedLocales = 10;

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m) => { console.log(`  ❗ ${m}`); fail++; };

console.log(`\n── i18n 一致性校验(基准 ${REFERENCE},${refSet.size} 个叶子 key)──`);

/* ---------- 1. locale 数量与声明一致 ---------- */
{
  files.length === expectedLocales
    ? ok(`locale 文件数 ${files.length} 与实现一致`)
    : bad(`locale 文件数 ${files.length},实现声明 ${expectedLocales}`);
}

/* ---------- 2. 逐语言 key 集合比对 ---------- */
const currentGaps = {};
for (const f of files) {
  const code = f.replace(/\.json$/, "");
  if (code === REFERENCE) continue;
  const s = flatten(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, f), "utf8")));
  const missing = [...refSet].filter((k) => !s.has(k)).sort();
  const extra = [...s].filter((k) => !refSet.has(k)).sort();
  if (missing.length) currentGaps[code] = missing;
  if (extra.length) bad(`${code} 存在基准中不存在的 key(多余 ${extra.length} 个): ${extra.slice(0, 5).join(", ")}`);
}

/* ---------- 3. 与已知缺口基线比对 ---------- */
const baseline = fs.existsSync(BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"))
  : null;

if (UPDATE_BASELINE) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(currentGaps, null, 2) + "\n", "utf8");
  console.log(`\n  📝 已更新基线:${path.relative(WEB, BASELINE_FILE)}`);
  const total = Object.values(currentGaps).reduce((s, a) => s + a.length, 0);
  console.log(`     当前记录缺口:${Object.keys(currentGaps).length} 个语言,合计 ${total} 条`);
  process.exit(0);
}

if (!baseline) {
  console.log(`\n  ⚠️  未找到基线文件 ${path.relative(WEB, BASELINE_FILE)}`);
  console.log(`     执行 node scripts/check-i18n.mjs --update-baseline 生成`);
  process.exit(REPORT_ONLY ? 0 : 1);
}

const baseLangs = Object.keys(baseline).sort();
const curLangs = Object.keys(currentGaps).sort();

/* 缺口缩小 = 改进 */
const improved = baseLangs.filter((l) => !currentGaps[l]);
if (improved.length) {
  ok(`${improved.length} 种语言的缺口已补齐:${improved.join(", ")}(建议执行 --update-baseline 收紧基线)`);
}

/* 新增缺口语言 = 回归 */
const regressed = curLangs.filter((l) => !baseline[l]);
if (regressed.length) {
  bad(`以下语言出现基线中不存在的新缺口:${regressed.join(", ")}`);
}

/* 逐语言比对具体 key */
for (const l of curLangs) {
  if (!baseline[l]) continue;
  const baseSet = new Set(baseline[l]);
  const curSet = new Set(currentGaps[l]);
  const newMissing = currentGaps[l].filter((k) => !baseSet.has(k));
  const resolved = baseline[l].filter((k) => !curSet.has(k));
  if (newMissing.length) {
    bad(`${l} 新增 ${newMissing.length} 个未翻译 key: ${newMissing.slice(0, 6).join(", ")}${newMissing.length > 6 ? " ..." : ""}`);
  } else if (resolved.length) {
    ok(`${l} 缺口减少 ${resolved.length} 条(${baseline[l].length} → ${curSet.size})`);
  }
}

if (fail === 0) {
  const total = Object.values(currentGaps).reduce((s, a) => s + a.length, 0);
  ok(`无新增漂移。已知内容债:${Object.keys(currentGaps).length} 种语言各缺 ${curLangs[0] ? currentGaps[curLangs[0]].length : 0} 条(合计 ${total} 条),需母语者补译`);
}

console.log(`\n  已知缺口明细:`);
for (const l of curLangs) console.log(`    ${l}: ${currentGaps[l].length} 条`);

console.log(`\n  结果:${pass} 通过 / ${fail} 失败${REPORT_ONLY ? "(report 模式,忽略失败)" : ""}`);
console.log(
  `\n  另:README.md:135 宣称 16 种语言,实现为 ${files.length} 种 —— 需对齐(ISSUE-007)`,
);
process.exit(fail > 0 && !REPORT_ONLY ? 1 : 0);
