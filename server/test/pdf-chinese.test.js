// 中文 PDF 端到端测试(V1)
// 用**真实的中文简历 PDF**验证 pdfjs-dist + cMapUrl 能正确提取 CID 编码文本。
//
// 这三份夹具的来源与特性:
//   resume1.pdf          LaTeX/XeLaTeX 生成。CJK 字体全为 CID Type0C + Identity-H,
//                       且**完全没有 ToUnicode CMap** —— 提取必须依赖
//                       CIDSystemInfo → 预定义 CMap 映射。
//                       这是最硬的一类中文 PDF,弱解析器会直接输出空白。
//   resume2/3_typst_zh   Typst 生成,带 ToUnicode,标准 CID 路径(对照组)。
//
// 许可证:三份均为开源简历模板的编译产物
//   resume1: github.com/forfrt/cn_resume (MIT)
//   resume2/3: github.com/NorthSecond/Auto_Typst_Resume_Template
//
// 实测基线(2026-10-02):
//   pdf-parse@1.1.1  → 三份全部提取失败(0 中文字)
//   pdfjs-dist@5     → 1260 / 860 / 860 中文字
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPdfText } from "../services/pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

const CASES = [
  { file: "resume1.pdf", minCjk: 1000, label: "无 ToUnicode 的 Identity-H(最硬)" },
  { file: "resume2_typst_zh.pdf", minCjk: 500, label: "Typst + ToUnicode" },
  { file: "resume3_typst_zh_v2.pdf", minCjk: 500, label: "Typst 旧版 + ToUnicode" },
];

test("中文 PDF 端到端提取(V1)", async (t) => {
  for (const c of CASES) {
    const p = path.join(FIXTURES, c.file);
    if (!fs.existsSync(p)) {
      t.diagnostic(`跳过 ${c.file}(夹具缺失)`);
      return;
    }
    await t.test(`${c.file} — ${c.label}`, async () => {
      const text = await extractPdfText(fs.readFileSync(p));
      const cjk = (text.match(/[一-龥]/g) || []).length;
      assert.ok(
        cjk >= c.minCjk,
        `${c.file} 提取的中文字过少:${cjk}(期望 >= ${c.minCjk})`
      );
      // 必须是可读的中文,而不是空白或乱码符号
      assert.ok(text.length > 200, `${c.file} 提取长度过短:${text.length}`);
    });
  }
});

test("无文字层 PDF 应给出可操作提示,而非静默返回空", async () => {
  // 构造一个只有页面没有内容流的极简 PDF
  const minimal = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF",
    "latin1"
  );
  await assert.rejects(
    () => extractPdfText(minimal),
    (e) => /未提取到文字|扫描件|文字版/.test(e.message),
    "无文字层时应抛出带用户指引的错误"
  );
});

test("损坏的 PDF 不应导致进程崩溃", async () => {
  const garbage = Buffer.from("这不是一个 PDF,只是一段垃圾数据".repeat(50), "utf8");
  await assert.rejects(() => extractPdfText(garbage));
});

test("空 Buffer 应被拒绝", async () => {
  await assert.rejects(() => extractPdfText(Buffer.alloc(0)));
});
