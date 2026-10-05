// 单元测试:日 token 预算熔断的对外契约(守卫 ISSUE-030)
//
// ## 为什么需要这条测试
// 预算耗尽与短窗口限流**都是 429**,但语义完全相反:
//   RATE_LIMITED         → 等 60 秒就好,立即重试有意义
//   TOKEN_BUDGET_EXCEEDED → 当天不可能恢复,重试 100% 必然失败,要等跨日重置
//
// 原实现对两者复用同一个 `ErrorCodes.RATE_LIMITED`,且**不带 Retry-After**,
// 客户端无法区分"该重试"和"该停",唯一线索是 message 里一句中文散文。
// 实际后果不是理论上的:R16 跑 100 样本评测时,评测脚本把所有 429 一律
// 当限流处理(睡 62 秒重试,最多 20 次),撞上预算熔断后**空转 14 分钟**,
// 每个剩余样本还要再空转 20 分钟 —— 且不落盘,78 个已完成样本的结果全丢。
//
// 为什么用静态守卫而不是运行测试:
// 真正触发熔断需要「起服务 + 把 DAILY_TOKEN_BUDGET 压到极小 + 真的调一次 LLM」,
// 成本高且会污染 token_usage 表。而本缺陷的本质是**响应契约写错**,
// 用静态断言守住契约不退回,更直接也更可靠。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(SERVER_DIR, f), "utf8");

// 剥注释,避免匹配到说明性注释文本(本项目已多次因"测试自己有 bug"产生假阳性)
function stripComments(src) {
  // ⚠️ 必须单次合并正则,不能分两步 replace(理由同 route-schema-contract.test.js)
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
}

const responseSrc = stripComments(read("response.js"));
const indexSrc = stripComments(read("index.js"));

/** 取出预算熔断那一整段(从日预算校验到 return 结束) */
function budgetBlock() {
  const start = indexSrc.indexOf("getTodayTokenUsage()");
  assert.ok(start > 0, "未找到日预算校验代码块");
  // 从 getTodayTokenUsage 之后第一个 `if (used >` 开始,取到该 if 块结束
  const ifStart = indexSrc.indexOf("if (used >", start);
  assert.ok(ifStart > 0, "未找到 `if (used > DAILY_TOKEN_BUDGET)` 预算判断");
  // 以 `    }` 收尾(4 空格缩进的 if 块闭合)
  const end = indexSrc.indexOf("\n    }", ifStart);
  assert.ok(end > ifStart, "预算判断块未正常闭合");
  return indexSrc.slice(ifStart, end);
}

test("ErrorCodes 导出 TOKEN_BUDGET_EXCEEDED 且与 RATE_LIMITED 并列", () => {
  assert.match(responseSrc, /TOKEN_BUDGET_EXCEEDED:\s*"TOKEN_BUDGET_EXCEEDED"/);
  // 两者必须都在,且是两个独立项(防止有人把新码又定义成旧码的值)
  assert.match(responseSrc, /RATE_LIMITED:\s*"RATE_LIMITED"/);
});

test("预算熔断返回 TOKEN_BUDGET_EXCEEDED,不再复用 RATE_LIMITED", () => {
  const block = budgetBlock();
  assert.match(block, /ErrorCodes\.TOKEN_BUDGET_EXCEEDED/,
    "预算熔断必须用独立错误码");
  assert.doesNotMatch(block, /ErrorCodes\.RATE_LIMITED/,
    "预算熔断不得复用 RATE_LIMITED —— 这正是 ISSUE-030 的根因");
});

test("预算熔断带 Retry-After 头(让客户端知道等到何时)", () => {
  const block = budgetBlock();
  assert.match(block, /setHeader\(\s*["']Retry-After["']/,
    "预算熔断必须设置 Retry-After 头");
  // Retry-After 的值要来自真实计算,不能写死
  assert.match(block, /retryAfterSeconds/,
    "Retry-After 应由距下次重置的秒数计算得出");
});

test("预算熔断响应体带 i18nKey(供前端本地化,不依赖中文 message)", () => {
  const block = budgetBlock();
  assert.match(block, /i18nKey/);
  assert.match(block, /i18nParams/);
});

test("重置时点按 UTC 计算,与服务端 date('now') 的分日口径一致", () => {
  // R50:本条原先是源码正则 —— assert.match(block, /getUTCFullYear|getUTCMonth|getUTCDate/)。
  // 它有两个致命问题:
  //   1. **检测"存在性"而非"语义位置"**: 只要 `budgetBlock()` 取到的源码里
  //      任何地方残留一个 `getUTC*` 字样(哪怕在不可达分支里),它就通过;
  //      而把真正的 `getUTCDate()` 换成 `getDate()` —— 非 UTC 部署下
  //      重置点会**偏差整整一天** —— 它照样绿。
  //   2. **把实现位置也当成了契约**: 计算逻辑一移到 server/budget.js,
  //      本条立刻失败 —— 它护的不是行为,是"这段代码必须写在 index.js 里"。
  //
  // ⇒ 改为由 `budget-retry-after.test.js` 用**行为**覆盖:
  //    那里强制 TZ=Asia/Shanghai,并在跨 UTC 日界线的时刻断言返回值
  //    恰好等于"距下一个 UTC 零点的秒数"。已用变异测试验证:
  //    把 getUTC* 换成 get* 会被杀掉(两个时区下都杀)。
  //
  // 这里只保留一条**更弱但仍有价值**的存在性护栏:口径文档别被删掉。
  const block = budgetBlock();
  assert.match(block, /secondsUntilUtcMidnight/,
    "预算熔断应通过 secondsUntilUtcMidnight 计算重置点(口径集中在 server/budget.js)");
});
