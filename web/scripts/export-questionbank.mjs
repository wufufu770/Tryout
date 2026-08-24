#!/usr/bin/env node
/**
 * export-questionbank.mjs — 把内置 TS 题库导出为 JSON 资产
 *
 * 用途：题库产品化第一步。JSON 化后：
 *   - 任何语言/工具都能消费（不依赖前端构建链）
 *   - 为「用户自定义题库导入」提供 schema 基准（同结构即可导入）
 *
 * 运行：npm run export:questionbank   （在 web/ 目录）
 * 输出：public/questionbank.json
 */
import { createServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  server: { middlewareMode: true },
  logLevel: 'silent',
  appType: 'custom',
});
try {
  const mod = await server.ssrLoadModule('/src/data/questionBank.ts');
  const bank = mod.QUESTION_BANK;
  if (!Array.isArray(bank) || bank.length === 0) throw new Error('QUESTION_BANK 为空，导出中止');
  const payload = {
    $schema: './questionbank.schema.json',
    version: new Date().toISOString().slice(0, 10),
    meta: {
      industries: mod.INDUSTRIES,
      questionTypes: mod.QUESTION_TYPES,
      difficulties: mod.DIFFICULTIES,
      total: bank.length,
    },
    questions: bank,
  };
  const out = join(root, 'public', 'questionbank.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 1), 'utf8');
  console.log(`OK ${out} — ${bank.length} 题`);
} finally {
  await server.close();
}
