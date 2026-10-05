#!/usr/bin/env node
// W2-3 回归防护:独立评分必须真的发出 N 个互相不可见的请求
//
// 为什么单元测试不够:
//   aggregate.test.ts 只验证纯函数,不验证"调用方真的独立发了 6 次请求"。
//   若有人日后把 scoreAllDimensions 改回单次调用,单元测试仍会全绿,
//   而 ADR-001 的问题(维度间互相污染)会静默回归。
//
// 本脚本直接在 Node 里跑 scoringEngine 的编译产物(用 tsc 预编译到 build/)。
//
// 用法:node scripts/e2e-isolated-scoring.mjs

import { writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

const ROOT = path.resolve(import.meta.dirname, "../..");  // 仓库根(web/scripts -> web -> 根)
const TMP = mkdtempSync(path.join(tmpdir(), "tryout-w23-"));
const WEB = path.join(ROOT, "web");

// ---- 把 scoringEngine 打成单文件 ESM(可直接 node 运行) ----
// 用 esbuild(Vite 依赖链里已有),一次解决两件事:
//   1. 解析 "@/api/client" 路径别名
//   2. 打包成单文件,免去 ESM 显式 .js 扩展名的麻烦
const ESBUILD = path.join(WEB, "node_modules", "esbuild", "bin", "esbuild");
if (!existsSync(ESBUILD)) {
  console.error("未找到 web/node_modules/esbuild,请先 cd web && npm install");
  rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
}
// 入口文件同时导出被测函数与常量,避免多次 import
const ENTRY = path.join(TMP, "entry.mjs");
writeFileSync(ENTRY, [
  `export { scoreAllDimensions, aggregateScores } from "${WEB}/src/lib/evaluation/scoringEngine.ts";`,
  `export { EVALUATION_DIMENSIONS } from "${WEB}/src/lib/evaluation/starEvaluator.ts";`,
  "",
].join("\n"));
const BUNDLE = path.join(TMP, "bundle.mjs");
try {
  // ⚠️ esbuild 的 bin 是原生 ELF 可执行文件,必须直接 exec,
  //    不能用 process.execPath(node) 去跑 —— 那会报 "Invalid or unexpected token"。
  execFileSync(ESBUILD, [
    ENTRY,
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${BUNDLE}`,
    `--alias:@=${WEB}/src`,
    "--log-level=error",
  ], { cwd: WEB, stdio: "pipe" });
} catch (e) {
  console.error("esbuild 打包失败:\n" + (e.stdout?.toString() || e.message).slice(-1500));
  rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
}

const { scoreAllDimensions, aggregateScores, EVALUATION_DIMENSIONS } =
  await import(BUNDLE);

console.log("=== W2-3 独立评分回归防护 ===\n");

// ---- 记录所有实际发出的 prompt ----
const seen = [];
const deps = {
  chat: async (_provider, body) => {
    const prompt = body.messages[0].content;
    seen.push(prompt);
    // 每次都返回同样的高分,这样聚合结果可预期
    return {
      content: JSON.stringify({
        matched_anchor_id: "A",
        evidence: ["候选人明确指出了方案的失效边界"],
        confidence: "high",
      }),
    };
  },
};

const QUESTION = "为什么用 B+ 树做 InnoDB 索引?";
const ANSWER = "因为非叶子节点只存索引,单页能放更多索引项,树更矮,磁盘 IO 更少;叶子节点用链表相连,范围查询高效。";

const results = await scoreAllDimensions(
  EVALUATION_DIMENSIONS, QUESTION, ANSWER, undefined, "mock-provider", 3, deps
);

// 1) 必须发出与维度数相同的请求数
if (seen.length === EVALUATION_DIMENSIONS.length) {
  ok(`发出 ${seen.length} 个独立请求(等于维度数 ${EVALUATION_DIMENSIONS.length})`);
} else {
  bad(`请求数应为 ${EVALUATION_DIMENSIONS.length},实际 ${seen.length} —— 单次调用会污染维度`);
}

// 2) 每个 prompt 只含自己维度的锚点
let crossLeak = 0;
seen.forEach((p, i) => {
  const own = EVALUATION_DIMENSIONS[i];
  const others = EVALUATION_DIMENSIONS.filter((_, j) => j !== i);
  for (const o of others) {
    if (p.includes(o.anchors[5]) || p.includes(o.anchors[1])) crossLeak++;
  }
  if (!p.includes(own.anchors[5]) || !p.includes(own.anchors[1])) crossLeak++;
});
if (crossLeak === 0) ok("每个 prompt 只含本维度锚点(无跨维度泄漏)");
else bad(`检测到 ${crossLeak} 处跨维度锚点泄漏`);

// 3) 不得索取总分(锚定偏见 d=0.71)
const asksTotal = seen.filter((p) => /(请|需要|一并|同时)(给出|输出|评估).{0,6}总分/.test(p));
if (asksTotal.length === 0) ok("无 prompt 索取总分(避免锚定偏见)");
else bad(`${asksTotal.length} 个 prompt 索取总分`);

// 4) prompt 不得含其他维度的得分
const crossScore = seen.filter((p) => /(其他|各|其余)维度(的)?(得分|分数)/.test(p));
if (crossScore.length === 0) ok("无 prompt 引用其他维度得分");
else bad(`${crossScore.length} 个 prompt 引用其他维度得分`);

// 5) 全部高分 → 聚合总分应为 10(1-10 制)
const agg = aggregateScores(results);
if (agg.overallScore === 10) ok(`全 A 聚合为 ${agg.overallScore}/10`);
else bad(`全 A 应聚合为 10,实际 ${agg.overallScore}`);

// 6) 部分失败 → 不得静默虚高
const partial = aggregateScores([
  results[0], results[1], results[2], null, null, null,
]);
if (partial.missingCount === 3 && partial.overallScore < 10) {
  ok(`3 个维度失败时总分降为 ${partial.overallScore}(未虚高),missingCount=${partial.missingCount}`);
} else {
  bad(`部分失败处理异常: overall=${partial.overallScore} missing=${partial.missingCount}`);
}

rmSync(TMP, { recursive: true, force: true });

console.log(`\n${"=".repeat(46)}`);
console.log(`结果:${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
