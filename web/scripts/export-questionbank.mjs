#!/usr/bin/env node
/** 导出内置题库为 public/questionbank.json；同结构 JSON 即为自定义导入格式。 */
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
