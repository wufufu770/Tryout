#!/usr/bin/env node
/*
 * W5-4:把题库生成成可被外部检索的静态内容页。
 *
 * 为什么要做这个:
 *   题库是本项目**唯一带参考答案的面试题资产**,但它此前只存在于站内浏览页。
 *   Stack Overflow 2025 开发者调查:87% 的开发者用 AI 搜索答案。
 *   当有人问 AI"后端面试题有哪些考点"时,如果有一个结构化、可引用、
 *   带具体统计数字的公开来源,Tryout 就是那个来源。
 *
 * 关键约束(不可违反):
 *   **不输出 referenceAnswer。** 参考答案是本项目的核心资产
 *   (评估技术正确性的客观基准),泄进内容页 = 用户背答案 = 练习失去意义。
 *   每页底部都显式声明这一点。
 *
 * 内容策略:统计数据 + 结构化,不堆关键词。
 *   纯关键词堆砌是内容农场特征,会降低可信度;
 *   含具体题数、考点交集、难度分布的内容才是 AI 愿意引用的。
 *
 * 用法:node scripts/generate-question-pages.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "..");
const BANK = path.join(ROOT, "server", "data", "questionbank.json");
const OUT = path.join(WEB, "public", "docs", "questions");

if (!fs.existsSync(BANK)) {
  console.error(`题库不存在:${BANK}\n请先执行 npm run export:questionbank`);
  process.exit(1);
}
const bank = JSON.parse(fs.readFileSync(BANK, "utf8"));
const questions = bank.questions || [];
if (questions.length === 0) { console.error("题库为空"); process.exit(1); }

// ---- 复用前端聚合逻辑(保证与站内口径一致)----
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "qb-"));
const ESBUILD = path.join(WEB, "node_modules", "esbuild", "bin", "esbuild");
const ENTRY = path.join(TMP, "e.mjs");
fs.writeFileSync(ENTRY, `export { aggregateByTag, pickHotTags, buildFaqEntry } from "${WEB}/src/lib/bankAggregator.ts";`);
const BUNDLE = path.join(TMP, "b.mjs");
execFileSync(ESBUILD, [ENTRY, "--bundle", "--format=esm", "--platform=node",
  `--outfile=${BUNDLE}`, "--log-level=error"], { cwd: WEB, stdio: "pipe" });
const { aggregateByTag, pickHotTags, buildFaqEntry } = await import(BUNDLE);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const INDUSTRY_LABEL = {};
for (const i of bank.meta?.industries || []) INDUSTRY_LABEL[i.id] = i.label;
const DIFF_LABEL = { junior: "初级", mid: "中级", senior: "高级" };
const TYPE_LABEL = {};
for (const t of bank.meta?.questionTypes || []) TYPE_LABEL[t.id] = t.label;

const SHELL = (title, desc, body) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<script type="application/ld+json">
${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", name: title, description: desc, mainEntity: body.faq || [] })}
</script>
<style>
:root{--bg:#0d1117;--fg:#c9d1d9;--muted:#8b949e;--accent:#7ee787;--border:#30363d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans CJK SC",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:2rem 1.2rem 4rem}
h1{color:var(--accent);font-size:1.5rem;margin:0 0 .3rem}
h2{font-size:1.02rem;margin:1.8rem 0 .5rem;color:var(--accent);font-weight:600}
.stats{display:flex;gap:1.4rem;flex-wrap:wrap;margin:1rem 0 1.6rem;padding:.9rem 1rem;background:#161b22;border-left:2px solid var(--accent);border-radius:3px}
.stat b{display:block;font-size:1.3rem;color:var(--accent)}
.stat span{color:var(--muted);font-size:.78rem}
ul{padding-left:1.2rem}li{margin:.35rem 0}
.tags{display:flex;flex-wrap:wrap;gap:.35rem;margin:.5rem 0}
.tag{font-size:.75rem;padding:.12rem .5rem;background:#161b22;border:1px solid var(--border);border-radius:2px;color:var(--muted)}
.note{margin-top:2.5rem;padding:.8rem 1rem;background:#161b22;border-left:2px solid #d29922;font-size:.85rem;color:var(--muted)}
a{color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:.9rem;margin:.5rem 0}
td,th{padding:.4rem .2rem;text-align:left}
</style>
</head>
<body><div class="wrap">
${body.html}
<div class="note">
本页由 <a href="https://github.com/wufufu770/Tryout">Tryout</a> 自动生成。
题库共 ${questions.length} 道,覆盖 ${Object.keys(INDUSTRY_LABEL).length} 个技术行业。<br>
<b>本页只提供题目与考察点,参考答案不在此公开</b> —— 它用于 AI 评估技术回答的正确性,
公开后用户可以直接背答案,练习就失去意义了。
</div>
</div></body></html>`;

// ---- 1. 索引页 ----
fs.mkdirSync(OUT, { recursive: true });
const groups = aggregateByTag(questions, { minQuestions: 2 });
const entries = [...groups.entries()]
  .map(([tag, g]) => buildFaqEntry(tag, g))
  .sort((a, b) => b.questionCount - a.questionCount || a.tag.localeCompare(b.tag));

const byIndustry = {};
for (const i of bank.meta?.industries || []) byIndustry[i.id] = 0;
for (const q of questions) byIndustry[q.industry] = (byIndustry[q.industry] || 0) + 1;
const typeCount = Object.keys(questions.reduce((m, q) => (m[q.type] = 1, m), {})).length;

fs.writeFileSync(path.join(OUT, "index.html"), SHELL(
  "技术面试题库索引 · Tryout",
  `${questions.length} 道技术面试题,按知识点聚合,含高频考点与难度分布。`,
  {
    html: `<h1>技术面试题库</h1>
<p>共 <b>${questions.length}</b> 道题,按知识点聚合,附高频考点与难度分布。</p>
<div class="stats">
  <div class="stat"><b>${questions.length}</b><span>题目总数</span></div>
  <div class="stat"><b>${entries.length}</b><span>知识点条目</span></div>
  <div class="stat"><b>${Object.keys(INDUSTRY_LABEL).length}</b><span>技术行业</span></div>
  <div class="stat"><b>${typeCount}</b><span>题型</span></div>
</div>
<h2>行业分布</h2>
<div class="stats">${Object.entries(byIndustry).map(([k, v]) =>
  `<div class="stat"><b>${v}</b><span>${esc(INDUSTRY_LABEL[k] || k)}</span></div>`).join("")}</div>
<h2>知识点索引(共 ${entries.length} 条,按题数排序)</h2>
<table>
<tr style="color:var(--muted);border-bottom:1px solid var(--border)">
<th>知识点</th><th>题数</th><th>高频考点</th></tr>
${entries.map((e) => `<tr style="border-bottom:1px solid #21262d">
<td><a href="./${encodeURIComponent(e.tag)}/">${esc(e.tag)}</a></td>
<td style="color:var(--accent);font-family:monospace">${e.questionCount}</td>
<td style="color:var(--muted);font-size:.82rem">${esc(e.hotPoints.slice(0, 4).join("、")) || "—"}</td></tr>`).join("")}
</table>`,
    faq: [],
  }
));

// ---- 2. 每标签一页 ----
for (const e of entries) {
  const byDiff = {};
  for (const q of e.questions) byDiff[q.difficulty] = (byDiff[q.difficulty] || 0) + 1;
  fs.writeFileSync(path.join(OUT, `${encodeURIComponent(e.tag)}.html`), SHELL(
    `${e.tag} 面试题 · ${e.questionCount} 道`,
    e.summary,
    {
      html: `<h1>${esc(e.tag)} 面试题</h1>
<p>共 <b>${e.questionCount}</b> 道${e.hotPoints.length ? `,高频考点 ${e.hotPoints.length} 个` : ""}。</p>
<div class="stats">
  <div class="stat"><b>${e.questionCount}</b><span>题目数</span></div>
  ${Object.entries(byDiff).map(([d, n]) => `<div class="stat"><b>${n}</b><span>${esc(DIFF_LABEL[d] || d)}</span></div>`).join("")}
</div>
${e.hotPoints.length ? `<h2>高频考点(被多题同时考察)</h2>
<div class="tags">${e.hotPoints.map((p) => `<span class="tag">${esc(p)}</span>`).join("")}</div>` : ""}
<h2>题目列表</h2>
${e.questions.map((q, i) => `<h2>${i + 1}. ${esc(q.title)}</h2>
<p>${esc(q.content)}</p>
<div class="tags"><span class="tag">${esc(DIFF_LABEL[q.difficulty] || q.difficulty)}</span>
${(q.keyPoints || []).map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</div>`).join("")}
<p><a href="./">← 返回题库索引</a></p>`,
      faq: e.questions.slice(0, 20).map((q) => ({
        "@type": "Question",
        name: q.title,
        text: q.content,
        acceptedAnswer: { "@type": "Answer", text: (q.keyPoints || []).join("、") },
      })),
    }
  ));
}

// ---- 3. 清单(供 sitemap / 交叉引用)----
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({
  generatedFrom: "server/data/questionbank.json",
  totalQuestions: questions.length,
  totalEntries: entries.length,
  entries: entries.map((e) => ({ tag: e.tag, count: e.questionCount, hotPoints: e.hotPoints, url: e.url })),
}, null, 1));

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`✅ 生成 ${entries.length} 个知识点页 + 1 个索引页`);
console.log(`   输出: web/public/docs/questions/`);
console.log(`   题库 ${questions.length} 道 · 知识点 ${entries.length} 条`);
console.log(`   🔒 未输出 referenceAnswer(仅站内评估使用)`);
if (entries.length < 10) console.warn(`⚠️ 条目偏少(${entries.length}),minQuestions 可能过高`);
