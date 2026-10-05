#!/usr/bin/env node
/**
 * 导出内置题库为 JSON。同结构 JSON 即为自定义导入格式。
 *
 * 产出两份(内容一致,各司其职):
 *   1. web/public/questionbank.json   —— 前端可直接 fetch,供离线使用与用户手动导入
 *   2. server/data/questionbank.json —— 服务端权威副本
 *
 * 为什么需要服务端副本(W3-1):
 *   题库此前只存在于前端 TS 模块里(909 KB 全进主 bundle),
 *   服务端读不到 referenceAnswer —— 而"评技术正确性"这条产品主线
 *   恰恰依赖参考答案作为客观基准。题库是静态参考数据,不必建表,
 *   放 JSON + 进程内建索引即可。
 */
import { createServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root,
  server: { middlewareMode: true },
  logLevel: 'silent',
  appType: 'custom',
});

try {
  // 数据源在仓库根的 data/questionbank-src/(不在前端源码树内,避免 917 KB 进 bundle)
  const mod = await server.ssrLoadModule('/../data/questionbank-src/index.ts');
  const bank = mod.QUESTION_BANK;
  if (!Array.isArray(bank) || bank.length === 0) throw new Error('QUESTION_BANK 为空，导出中止');

  // ---- 导出前做完整性校验:缺字段的题会让下游检索/评估拿到 undefined ----
  const REQUIRED = ['id', 'industry', 'type', 'difficulty', 'title', 'content', 'referenceAnswer'];
  const problems = [];
  const seenIds = new Set();
  for (const q of bank) {
    for (const k of REQUIRED) {
      if (q[k] === undefined || q[k] === null || q[k] === '') {
        problems.push(`${q.id}: 缺字段 ${k}`);
      }
    }
    if (seenIds.has(q.id)) problems.push(`${q.id}: id 重复`);
    seenIds.add(q.id);
    if (!Array.isArray(q.keyPoints) || q.keyPoints.length === 0) {
      problems.push(`${q.id}: keyPoints 为空(它是检索加权的核心依据)`);
    }
  }
  if (problems.length > 0) {
    console.error(`题库校验失败,共 ${problems.length} 处问题(前 20 条):`);
    for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
    throw new Error('题库校验未通过,导出中止');
  }

  // 元数据从薄层取(它不含题库内容,可在前端安全 import)
  const meta = await server.ssrLoadModule('/src/data/questionMeta.ts');
  const payload = {
    $schema: './questionbank.schema.json',
    version: new Date().toISOString().slice(0, 10),
    meta: {
      industries: meta.INDUSTRIES,
      questionTypes: meta.QUESTION_TYPES,
      difficulties: meta.DIFFICULTIES,
      total: bank.length,
    },
    questions: bank,
  };

  // 公开产物一律不含参考答案。三条理由:
  //   1. public/ 会被 Vite 原样拷进 dist/,而 dist/ 是 GitHub Pages 的发布产物
  //      (pages.yml 上传 web/dist)。带答案等于把 808 题的评分基准公开可下载,
  //      直接击穿"参考答案不对外公开"这条产品策略。
  //   2. 前端类型 QuestionLite 本就不含该字段,只有 QuestionFull(含 referenceAnswer)
  //      是服务端内部用的,离线兜底用不到。
  //   3. 内容页生成读的是 server/data/ 那份权威副本,不受影响。
  // 服务端仍需要完整副本做评估注入,所以两份内容不同,不能简单写同一个 payload。
  const liteBank = bank.map(({ referenceAnswer, ...rest }) => {
    void referenceAnswer;
    return rest;
  });
  const litePayload = { ...payload, questions: liteBank };

  const outs = [
    [join(root, 'public', 'questionbank.json'), litePayload],            // 公开/离线兜底:薄层,无答案
    [join(root, '..', 'server', 'data', 'questionbank.json'), payload],  // 服务端权威副本:含答案
  ];
  for (const [out, data] of outs) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(data, null, 1), 'utf8');
    console.log(`OK ${relative(root, out)} — ${data.questions.length} 题${data === litePayload ? '(无参考答案)' : '(含参考答案)'}`);
  }

  // ---- 题库统计:便于 review 时快速核对 ----
  const byInd = {};
  for (const q of bank) byInd[q.industry] = (byInd[q.industry] || 0) + 1;
  console.log(`\n行业分布(${Object.keys(byInd).length} 个):`);
  for (const [k, v] of Object.entries(byInd).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(12)} ${v}`);
  }
  console.log('\n校验通过:字段完整性、id 唯一性、keyPoints 非空');
} finally {
  await server.close();
}
