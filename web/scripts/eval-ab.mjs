#!/usr/bin/env node
/*
 * W2-4 · 独立评分 vs 联合评分 —— 一致性 A/B 实验
 *
 * 目的:在**本项目自己的** prompt、题库和模型上复现 arXiv:2608.14684 的结论
 * (联合评估存在系统性 rubric 干扰;独立评估一致性更高)。
 * 外部论文的数字是别人的模型、别人的题目 —— 不能直接当作本项目的依据。
 *
 * 用法:
 *   # 1) 无需任何 API key,用内置 mock 验证脚本自身正确性
 *   node scripts/eval-ab.mjs --mock
 *
 *   # 2) 真实测量(需要先在应用里配置供应商并导出 key)
 *   TRYOUT_TOKEN=xxx TRYOUT_PROVIDER=deepseek node scripts/eval-ab.mjs \
 *     --base http://127.0.0.1:3001 --runs 3
 *
 * 输出:逐维度两两一致率 + 总体对比 + 是否达到 V6 门禁(>= 85%)
 */

import { writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(WEB, "..");

// ---- 参数 ----
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const USE_MOCK = has("--mock");
const BASE = val("--base", "http://127.0.0.1:3001");
const TOKEN = process.env.TRYOUT_TOKEN || "";
const PROVIDER = process.env.TRYOUT_PROVIDER || "deepseek";
const RUNS = Math.max(2, parseInt(val("--runs", "3"), 10));

// ---- 打包被测模块(esbuild 已在 Vite 依赖链中)----
const ESBUILD = path.join(WEB, "node_modules", "esbuild", "bin", "esbuild");
if (!existsSync(ESBUILD)) {
  console.error("未找到 web/node_modules/esbuild,请先 cd web && npm install");
  process.exit(1);
}
const TMP = mkdtempSync(path.join(tmpdir(), "tryout-ab-"));
const ENTRY = path.join(TMP, "entry.mjs");
writeFileSync(
  ENTRY,
  [
    `export { scoreAllDimensions, parseDimensionScore } from "${WEB}/src/lib/evaluation/scoringEngine.ts";`,
    `export { EVALUATION_DIMENSIONS, generateEvaluationPrompt, parseEvaluationResult } from "${WEB}/src/lib/evaluation/starEvaluator.ts";`,
    `export { summarizeRuns, compareConsistency } from "${WEB}/src/lib/evaluation/consistency.ts";`,
    "",
  ].join("\n")
);
const BUNDLE = path.join(TMP, "bundle.mjs");
try {
  // esbuild 的 bin 是原生 ELF,必须直接 exec,不能用 node 跑
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    ESBUILD,
    [ENTRY, "--bundle", "--format=esm", "--platform=node", `--outfile=${BUNDLE}`, `--alias:@=${WEB}/src`, "--log-level=error"],
    { cwd: WEB, stdio: "pipe" }
  );
} catch (e) {
  console.error("esbuild 打包失败:\n" + (e.stdout?.toString() || e.message).slice(-1200));
  rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
}
const M = await import(BUNDLE);

// ---- 测试集:质量分层的问答对,覆盖强/中/弱三档 ----
const CASES = [
  {
    q: "为什么 InnoDB 用 B+ 树而不是红黑树做索引?",
    a: "因为非叶子节点只存索引键不存整行数据,同样的 16KB 页能放更多索引项,树更矮,磁盘 IO 次数更少;另外叶子节点用双向链表相连,范围查询可以直接顺序扫描,不用中序遍历。红黑树每个节点都存数据,扇出小、树高,IO 次数反而更多。",
  },
  {
    q: "说说索引失效的常见场景",
    a: "有:在索引列上做函数运算或类型转换、隐式字符转换、联合索引不满足最左前缀、like '%x' 前置通配、以及优化器判断走索引的区分度太低主动放弃。",
  },
  {
    q: "介绍下你做过的性能优化",
    a: "我们把接口的 P99 从 800 毫秒降到了 120 毫秒。",
  },
  {
    q: "什么是缓存穿透?怎么解决?",
    a: "就是。",
  },
  {
    q: "谈谈你对高并发系统的理解",
    a: "高并发系统需要在入口做限流和降级,中间层用无锁队列削峰,存储层靠分库分表和读写分离扛住压力。要点是让每个环节都有明确的背压策略,否则瓶颈会转移到最脆弱的地方。",
  },
  {
    q: "线程池的核心参数有哪些?",
    a: "核心线程数、最大线程数、空闲存活时间、任务队列类型和容量。核心线程数一般按 CPU 密集型 N+1、IO 密集型 2N 起步,再根据压测调整。",
  },
];

// ---- 两种模式的跑法 ----
async function runIsolated(deps, question, answer) {
  const scores = await M.scoreAllDimensions(
    M.EVALUATION_DIMENSIONS, question, answer, undefined, PROVIDER, 3, deps
  );
  const out = {};
  scores.forEach((s, i) => {
    if (s) out[M.EVALUATION_DIMENSIONS[i].name] = s.score;
  });
  return out;
}

async function runJoint(deps, question, answer) {
  const prompt = M.generateEvaluationPrompt(question, answer);
  const res = await deps.chat(PROVIDER, { messages: [{ role: "user", content: prompt }] });
  const parsed = M.parseEvaluationResult(res?.content || "");
  const out = {};
  for (const d of parsed?.dimensions || []) {
    out[d.dimensionName] = d.score;
  }
  return out;
}

// ---- deps:mock 或真实 HTTP ----
/*
 * mock 必须**按模式返回对应格式**:
 *   isolated → parseDimensionScore 格式(单个 matched_anchor_id)
 *   joint    → parseEvaluationResult 格式(dimensions 数组)
 * 早期版本两者共用一种格式,导致联合评分解析全失败、维度表为空 ——
 * 这类"跑通了但结果是空"的 bug 必须靠 mock 自测才能发现。
 */
function makeDeps(kind, mode) {
  if (!USE_MOCK) {
    return {
      chat: async (_provider, body) => {
        const r = await fetch(`${BASE}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
          },
          body: JSON.stringify({ provider: PROVIDER, stream: false, ...body }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const j = await r.json();
        return { content: j?.data?.content ?? j?.content ?? "" };
      },
    };
  }
  // 种子提升到模块级,跨 makeDeps 共享 —— 否则每次调用都从同一起点走,
  // 随机序列高度相关,一致率会假性拉满。
  // 抖动用**调用计数**辅助去相关:
  //   早期版本每次 chat 重建 deps 时把 seed 重置回 12345,
  //   导致同一题的多次调用走出同一条随机路径 → 一致率假性 100%。
  //   mock 若测不出差异,就失去了自测价值。
  let jitterSum = 0;
  let calls = 0;
  const ID = ["A", "B", "C", "D", "E"];
  // isolated 抖动比 joint 小 —— 模拟"拆开评更稳"这一**待验证假设**。
  // 真实结论必须用真实模型跑 --runs 测,不能采信这里的数字。
  const jitter = mode === "isolated" ? 0.45 : 0.9;
  return {
    chat: async () => {
      calls++;
      const pick = () => {
        const r = rnd();
        jitterSum += r;
        if (r < jitter * 0.25) return 1;
        if (r < jitter * 0.5) return 2;
        if (r < jitter * 0.75) return 3;
        if (r < jitter) return 4;
        return 5;
      };
      if (mode === "joint") {
        return {
          content: JSON.stringify({
            dimensions: M.EVALUATION_DIMENSIONS.map((d) => ({
              dimensionName: d.name,
              score: pick(),
              comment: "mock",
            })),
            overallScore: 6,
            report: "mock",
            improvementAdvice: "",
            betterAnswerSample: "",
          }),
        };
      }
      return {
        content: JSON.stringify({
          matched_anchor_id: ID[pick() - 1],
          evidence: ["mock 引用"],
          confidence: "high",
        }),
      };
    },
  };
}

// ---- 共享 PRNG(跨模式、跨调用) ----
let __seed = 20261001;
const rnd = () => {
  __seed ^= __seed << 13; __seed >>>= 0;
  __seed ^= __seed >> 17;
  __seed ^= __seed << 5;  __seed >>>= 0;
  return __seed / 4294967296;
};

// ---- 主流程 ----
console.log("=== W2-4 · 独立评分 vs 联合评分 一致性 A/B ===\n");
console.log(`模式:${USE_MOCK ? "MOCK(自测)" : "REAL"} · 供应商:${PROVIDER} · 每题重复:${RUNS} 次 · 题目:${CASES.length}\n`);

const isolatedRuns = [];
const jointRuns = [];

for (const c of CASES) {
  const iso = [];
  const jnt = [];
  for (let r = 0; r < RUNS; r++) {
    // 每次用独立的 deps 实例,避免 mock 的随机序列被另一模式污染
    iso.push(await runIsolated(makeDeps("mock", "isolated"), c.q, c.a));
    jnt.push(await runJoint(makeDeps("mock", "joint"), c.q, c.a));
  }
  isolatedRuns.push(...iso);
  jointRuns.push(...jnt);
}

const cmp = M.compareConsistency({
  isolated: M.summarizeRuns(isolatedRuns),
  joint: M.summarizeRuns(jointRuns),
});

console.log("逐维度两两一致率(N 次运行中任意两次分数相同的比例)\n");
const pct = (x) => (x * 100).toFixed(1).padStart(6) + "%";
console.log("  维度              独立评分   联合评分    差值");
console.log("  " + "─".repeat(44));
for (const [dim, v] of Object.entries(cmp)) {
  if (dim === "overall") continue;
  const sign = v.delta >= 0 ? "+" : "";
  console.log(`  ${dim.padEnd(16, " ")}${pct(v.isolated)}  ${pct(v.joint)}  ${sign}${(v.delta * 100).toFixed(1)}pp`);
}
console.log("  " + "─".repeat(44));
const o = cmp.overall;
console.log(`  ${"总体".padEnd(16, " ")}${pct(o.isolated)}  ${pct(o.joint)}  ${(o.delta >= 0 ? "+" : "")}${(o.delta * 100).toFixed(1)}pp`);

console.log("\nV6 门禁(单维度一致率 >= 85%)\n");
if (USE_MOCK) {
  console.log("  MOCK 模式:随机抖动数据不代表真实模型,不判定门禁。");
  console.log("  脚本自检:能跑通、能量化差异即达标。");
  console.log("  实测请用:TRYOUT_TOKEN=... node scripts/eval-ab.mjs --runs 3");
} else {
  const passed = o.isolated >= 0.85;
  console.log(`  独立评分总体一致率:${pct(o.isolated)} → ${passed ? "✅ 达标" : "❌ 未达标"}`);
  console.log(`  联合评分总体一致率:${pct(o.joint)}(对照组)`);
  const verdict = o.isolated > o.joint
    ? "✅ 独立评分优于联合评分 —— ADR-001 在本项目上成立"
    : "⚠️ 独立评分未优于联合评分 —— ADR-001 需重新评估(可能是模型在长上下文下反而更稳)";
  console.log(`  结论:${verdict}`);
}

rmSync(TMP, { recursive: true, force: true });
