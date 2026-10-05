// PDF 文本提取（pdfjs-dist legacy build）
//
// 为什么不用 pdf-parse@1.1.1:
//   1. 它最后更新于 2018-10-24,内置 4 份完整 pdf.js,解压后 31.8 MB / 770 个文件
//   2. 根因:lib/pdf-parse.js:71 是 `PDFJS.getDocument(dataBuffer)`,
//      从不传 cMapUrl(全仓库 grep 0 命中)。
//      pdf.js 无法解码 CJK 的 CID→Unicode 映射,导致部分中文 PDF 提取为空或乱码。
//   3. pdfjs-dist 是 Mozilla 官方维护,原生支持 cMapUrl / cMapPacked / standardFontDataUrl。
//
// 版本选择:锁 5.x 而非 6.x
//   6.x(6.0.227, 2026-05-30)要求 Node >=22.13.0 || >=24,
//   而本项目 CI 矩阵含 Node 20、README 承诺 Node >=20。
//   5.0.375(2025-03-15)是最后一个支持 Node 20 的版本。
//
// 资源说明:cmaps(1.7 MB / 169 文件)与 standard_fonts(804 KB)随包分发,
//   通过 resolveStaticBase() 定位;Docker 镜像需保证 node_modules 完整。

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// 定位 node_modules/pdfjs-dist 的绝对路径(cmaps / standard_fonts 都在其下)
const PDFJS_ROOT = path.dirname(require.resolve("pdfjs-dist/package.json"));

function resourceDir(name) {
  const p = path.join(PDFJS_ROOT, name);
  if (!fs.existsSync(p)) {
    throw new Error(`pdfjs-dist 资源缺失:${p}(请确认依赖安装完整,不要用 --omit=optional)`);
  }
  return p + path.sep;
}

/** pdfjs legacy build:无 DOM 依赖,可直接在 Node 运行 */
async function getPdfjs() {
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return mod.default ?? mod;
}

/**
 * 从 PDF Buffer 提取纯文本
 * @param {Buffer} buf
 * @returns {Promise<string>}
 */
export async function extractPdfText(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error("PDF 内容为空");
  // pdf.js 会转移 buffer 所有权,复制一份避免影响调用方的 multer buffer
  const data = new Uint8Array(buf);

  let doc;
  const pdfjs = await getPdfjs();
  try {
    doc = await pdfjs.getDocument({
      data,
      cMapUrl: resourceDir("cmaps"),
      cMapPacked: true,
      standardFontDataUrl: resourceDir("standard_fonts"),
      // 不允许 pdf.js 发起网络请求(纯本地,也不引入 SSRF 面)
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
  } catch (e) {
    const msg = e?.message || String(e);
    if (/password|encrypted/i.test(msg)) {
      throw new Error("PDF 已加密或需要密码,请先用其他工具解密后再上传");
    }
    throw new Error(`PDF 解析失败:${msg}`);
  }

  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // hasEOL 标记换行位置,用于还原段落结构
      let line = "";
      const lines = [];
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
      pages.push(lines.join("\n"));
      page.cleanup();
    }
  } catch (e) {
    throw new Error(`PDF 页面解析失败:${e?.message || e}`);
  } finally {
    try { await doc.destroy(); } catch { /* 忽略清理失败 */ }
  }

  const text = pages.join("\n\n").replace(/[ \t]+\n/g, "\n").trim();

  // 提取为空通常意味着:扫描件(图片型 PDF)或引用了未内嵌的预定义 CMap
  if (!text) {
    const e = new Error("PDF 中未提取到文字(可能是扫描件或特殊编码),请上传文字版 PDF 或直接粘贴文本");
    e.code = "PDF_NO_TEXT";
    throw e;
  }
  return text;
}
