#!/usr/bin/env node
// Sitemap / robots.txt 生成
//
// 为什么做:web/public/docs/questions/ 下有 428 个静态页
// (427 个知识点页 + 索引页),但**没有 sitemap 也没有 robots.txt** ——
// 搜索引擎没有任何线索能发现它们。内容资产做完了,却进不了索引。
//
// 只输出题目与考察点,绝不输出 referenceAnswer(见 gen:pages 的同款约束)。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(WEB, "public");
const QUESTIONS_DIR = path.join(PUBLIC, "docs", "questions");
const BASE_URL = process.env.SITE_URL || "https://wufufu770.github.io/Tryout";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#apos;" }[c]));

export function buildSitemapXml(urls, lastmod) {
  const entries = urls
    .map(
      (u) => `  <url>
    <loc>${esc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}
    <changefreq>${u.changefreq || "monthly"}</changefreq>
    <priority>${u.priority ?? "0.6"}</priority>
  </url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

export function buildRobotsTxt(baseUrl, sitemaps = ["/sitemap.xml"]) {
  return `# Tryout —— 本地优先的 AI 面试模拟平台
User-agent: *
Allow: /
Disallow: /api/

# 本地优先产品:无账号、无用户数据,爬取无隐私顾虑

Sitemap: ${baseUrl}/sitemap.xml
${sitemaps.slice(1).map((s) => `Sitemap: ${baseUrl}${s}`).join("\n")}
`;
}

function main() {
  if (!fs.existsSync(QUESTIONS_DIR)) {
    console.error("内容页目录不存在,请先执行 npm run gen:pages");
    process.exit(1);
  }
  const files = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.endsWith(".html"));

  // 索引页优先,其次按文件名排序保证输出稳定
  const indexFile = files.find((f) => f === "index.html");
  const rest = files.filter((f) => f !== "index.html").sort();
  const ordered = indexFile ? [indexFile, ...rest] : rest;

  const urls = ordered.map((f) => {
    const name = f === "index.html" ? "" : f.replace(/\.html$/, "");
    // ⚠️ 文件名已经是 generate-question-pages.mjs 用 encodeURIComponent 编码过的,
    //    这里**不能再编码一次** —— 否则 %E4%B8%80 会变成 %25E4%25B8%25%80,
    //    sitemap 里全是死链。
    const loc = name
      ? `${BASE_URL}/docs/questions/${name}/`
      : `${BASE_URL}/docs/questions/`;
    return {
      loc,
      changefreq: name ? "monthly" : "weekly",
      priority: name ? "0.6" : "0.9",
    };
  });
  // 站点根页
  urls.unshift({ loc: `${BASE_URL}/`, changefreq: "weekly", priority: "1.0" });

  fs.writeFileSync(path.join(PUBLIC, "sitemap.xml"), buildSitemapXml(urls), "utf8");
  fs.writeFileSync(path.join(PUBLIC, "robots.txt"), buildRobotsTxt(BASE_URL), "utf8");

  console.log(`✅ sitemap.xml  — ${urls.length} 个 URL(含站点根)`);
  console.log(`✅ robots.txt   — 指向 ${BASE_URL}/sitemap.xml`);
  console.log(`   输出目录: web/public/`);
  console.log(`   ⚠️ 需配合 GitHub Pages 部署到 ${BASE_URL} 才生效`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
