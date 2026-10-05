// 限流器的**时间契约**测试(R49)
//
// ## 为什么需要
// R49 查"哪些代码坏了但测试不会红"时发现:
//
// 1. **限流的 `Retry-After` 从未被断言过**。
//    `e2e-defense-and-integrity.mjs` 只数"出现了几个 429",
//    没有任何一处读 `Retry-After` 头。
// 2. **预算熔断的 `Retry-After` 只有源码正则测试**
//    (`chat-budget-contract.test.js:63` 用 `assert.match` 匹配 `setHeader("Retry-After"`),
//    它测的是"代码里有没有这个字符串",**不是行为对不对**。
//    把 `Math.ceil` 改成 `Math.floor`,那个测试照样通过。
//
// ⇒ 两处 `Retry-After` 都没有行为覆盖。而 `Retry-After` 是**对外契约**:
// 客户端按它等待重试时间。向下取整会让客户端提前几百毫秒重试、立刻又被 429,
// 表现为"明明等够了还是被限流",且极难复现。
//
// ## 怎么测才算真测
// `Math.ceil` → `Math.floor` 只差 1 秒,靠"值大致对不对"抓不住。
// 精确判据是**行为上的因果**:
//
//   按 `Retry-After` 的值等够那么久 → 窗口**必须已过期** → 再请求**必须**不再 429
//
// 若实现用 floor,等待结束的那一刻窗口还差零点几秒,下一次请求**仍会 429**。
// 这个判据不依赖任何具体数字,只依赖"头里给的秒数确实够用"这条契约。
//
// 用 `windowMs: 400` 这样的短窗口,整个测试 1 秒内跑完,不必等生产环境的 60 秒。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../rateLimiter.js";

/** 造一个最小的 req/res,跑一次中间件,返回 {status, retryAfter, passed} */
function once(limiter, ip = "1.2.3.4") {
  const req = { ip, headers: {} };
  const headers = {};
  let status = null;
  let body = null;
  let passed = false;
  const res = {
    setHeader(k, v) { headers[k] = v; },
    status(c) { status = c; return this; },
    json(b) { body = b; return this; },
  };
  limiter(req, res, () => { passed = true; });
  return { status, retryAfter: headers["Retry-After"], body, passed };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("限流:第 max+1 次请求返回 429", () => {
  const limiter = createRateLimiter({ windowMs: 400, max: 3, label: "t" });
  for (let i = 0; i < 3; i++) assert.equal(once(limiter).passed, true, `第 ${i + 1} 次应放行`);
  const last = once(limiter);
  assert.equal(last.status, 429, "第 4 次(超过 max)必须 429");
  assert.equal(last.body.code, "RATE_LIMITED");
});

test("限流:429 必须带 Retry-After 头(此前无人断言过)", () => {
  const limiter = createRateLimiter({ windowMs: 400, max: 1, label: "t" });
  once(limiter);
  const r = once(limiter);
  assert.equal(r.status, 429);
  assert.notEqual(r.retryAfter, undefined, "429 必须带 Retry-After 头 —— 客户端靠它决定何时重试");
  assert.ok(Number.isInteger(r.retryAfter) && r.retryAfter > 0,
    `Retry-After 应为正整数秒,实得 ${r.retryAfter}`);
});

test("限流:Retry-After 不得超出窗口本身(防止写死常量)", () => {
  const limiter = createRateLimiter({ windowMs: 5000, max: 1, label: "t" });
  once(limiter);
  const r = once(limiter);
  assert.ok(r.retryAfter <= 5,
    `Retry-After=${r.retryAfter}s 不应超过 5000ms 窗口(5s)—— 疑似写死常量`);
  assert.ok(r.retryAfter >= 1, "Retry-After 不得为 0(会让客户端立即重试再被限流)");
});

test("⭐ 限流:按 Retry-After 等够之后,窗口必须已重置(向上取整契约)", async () => {
  const WINDOW = 400;
  const limiter = createRateLimiter({ windowMs: WINDOW, max: 1, label: "t" });
  once(limiter);                 // 第 1 次:放行,窗口从此刻起算
  const r = once(limiter);       // 第 2 次:429
  assert.equal(r.status, 429);

  // 头里说等 r.retryAfter 秒。**照它说的等**,然后必须已经能再进。
  await sleep(r.retryAfter * 1000);

  // 补一点余量,排除"恰好卡在边界"的抖动 —— 但余量远小于 1 秒,
  // 所以若实现用 floor(少报 1 秒),这里的 200ms 救不了它。
  await sleep(200);
  const after = once(limiter);
  assert.equal(after.status, null,
    `按 Retry-After=${r.retryAfter}s 等待后仍被限流 —— 说明该值不足,` +
    `客户端会提前重试并再次撞限流(ceil 退化为 floor?)`);
  assert.equal(after.passed, true, "窗口重置后必须放行");
});

test("限流:不同 IP 各自计数(不互相影响)", () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, label: "t" });
  assert.equal(once(limiter, "10.0.0.1").passed, true);
  assert.equal(once(limiter, "10.0.0.2").passed, true, "不同 IP 不该共享计数");
  assert.equal(once(limiter, "10.0.0.1").status, 429, "同一 IP 第二次应被限流");
});

test("限流:key 取 req.ip 而非 XFF(不可伪造)", () => {
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, label: "t" });
  const req = { ip: "10.0.0.5", headers: { "x-forwarded-for": "9.9.9.9, 8.8.8.8" } };
  const res = { setHeader() {}, status() { return this; }, json() { return this; } };
  let passed = 0;
  limiter(req, res, () => { passed++; });
  const res2 = { setHeader() {}, status() { return this; }, json() { return this; } };
  limiter(req, res2, () => { passed++; });
  assert.equal(passed, 1, "同一 req.ip 第二次必须被限流,伪造 XFF 不应重置计数");
});

test("⭐ 限流:窗口恰好到期的那一毫秒必须重置(<= 边界,变异测试反推补的)", () => {
  // 为什么这条要单独打桩 Date.now:
  // 上面那条"等 Retry-After 之后应放行"跑在真实时间上,等到的是 T0+1200ms,
  // 而窗口只有 400ms —— 边界差的那 1ms 早就被冲掉了,所以 `<=` 改成 `<` 它照样绿。
  // 要区分这两个,必须把时钟**正好停在 resetAt 那一毫秒**上。
  const WINDOW = 1000;
  const realNow = Date.now;
  let t = 1_000_000;
  Date.now = () => t;                       // rateLimiter.js 调 Date.now(),打桩生效
  try {
    const limiter = createRateLimiter({ windowMs: WINDOW, max: 1, label: "t" });
    assert.equal(once(limiter, "9.9.9.9").passed, true, "第 1 次放行,窗口从 T 起算");
    const r = once(limiter, "9.9.9.9");
    assert.equal(r.status, 429, "第 2 次应 429");

    t += WINDOW - 1;                         // 还差 1ms:窗口**未**到期
    assert.equal(once(limiter, "9.9.9.9").status, 429,
      "窗口尚未到期时必须仍被限流");

    t += 1;                                  // 恰好等于 resetAt —— 边界本身
    assert.equal(once(limiter, "9.9.9.9").passed, true,
      "到达窗口边界的那一毫秒就必须重置(`resetAt <= now`);" +
      "若实现写成 `<`,此处会继续 429,客户端整整多等一个窗口周期");
  } finally {
    Date.now = realNow;                      // ⛔ 无条件还原
  }
  // 对照:还原后真实时钟仍能正常工作
  assert.ok(Date.now() > 1_000_000, "Date.now 必须已还原");
});
