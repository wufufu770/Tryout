// 日预算 `Retry-After` 的**行为**测试(R50)
//
// ## 为什么替换掉原来的源码正则测试
// `chat-budget-contract.test.js` 原本这样"测":
// ```js
// assert.match(budgetBlock(), /getUTCFullYear|getUTCMonth|getUTCDate/,
//              "Retry-After 的重置点必须用 UTC");
// ```
// **它只检查"源码里出现过这几个字符串"。**
// 把 `getUTCDate()` 改成 `getDate()` —— 本地时区在 UTC+8 时,
// 重置点会**偏差整整一天**,而这个测试照样通过,
// 因为别处只要残留任何一个 `getUTC*` 字样,正则就匹配。
//
// ⇒ 它检测"存在性",不检测"语义位置"。本文件用**行为**取代它。
//
// ## 核心难点:必须让测试跑在**非 UTC 时区**
// 在 UTC 机器上,UTC 口径和本地口径给出**完全相同**的结果 ——
// 那种环境下任何"它算的是 UTC 零点"的测试都是恒真的,等于没测。
// 所以本文件顶部**强制把 TZ 设成 Asia/Shanghai**,并用一条断言自证时区确实生效。
import { test, before } from "node:test";
import assert from "node:assert/strict";

// ⛔ 必须在第一次使用 Date 之前设置(Node/V8 会重新加载时区)
process.env.TZ = "Asia/Shanghai";

const { secondsUntilUtcMidnight } = await import("../budget.js");

before(() => {
  // 自证:时区确实被切走了(偏移 -480 = UTC+8)。若这条红,
  // 说明下面所有"UTC 口径"的断言都可能恒真 —— 那比没有测试更危险。
  const offset = new Date("2026-10-05T12:00:00Z").getTimezoneOffset();
  assert.equal(offset, -480,
    `时区未生效(offset=${offset});下面的 UTC 判据在 UTC 机器上会恒真,必须先确保非 UTC 环境`);
});

test("预算 Retry-After:算的是**下一个 UTC 零点**,不是本地零点", () => {
  // 这个时刻是关键:20:00Z = 本地(UTC+8)次日 04:00,**已跨过本地日界线**。
  //
  //  UTC 口径   → 下个零点是 2026-10-06T00:00Z → 4 小时 → 14400 秒
  //  本地口径   → 本地已是 6 号,算到 10-07 本地零点 = 10-06T16:00Z → 20 小时
  //
  // 两者差 16 小时,足够把语义错误抓出来。
  const now = new Date("2026-10-05T20:00:00Z");
  const expected = (Date.parse("2026-10-06T00:00:00Z") - now.getTime()) / 1000;
  assert.equal(expected, 14400, "本用例的判据前提:距 UTC 零点应恰好 4 小时");

  const r = secondsUntilUtcMidnight(now);
  assert.equal(r, expected,
    `UTC 口径应得 ${expected}s,实得 ${r}s —— ` +
    (r - expected === 86400 || expected - r === 86400
      ? "**整整差 24 小时:算成了本地零点**(getUTCDate 被换成了 getDate?)"
      : "重置点算错了"));
});

test("预算 Retry-After:本地时间跨日不会让它漂移", () => {
  // 同一时刻,从 UTC 与本地两个视角看,返回值必须相同(它只看 UTC)
  const now = new Date("2026-10-05T20:00:00Z");
  assert.equal(secondsUntilUtcMidnight(now), secondsUntilUtcMidnight(new Date(now.getTime())));
  // 换几个跨日界的时刻都验一遍
  for (const iso of ["2026-01-01T23:59:59Z", "2026-06-15T16:00:00Z", "2026-12-31T16:00:00Z"]) {
    const t = new Date(iso);
    const want = (Date.parse(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1)).toISOString()) - t.getTime()) / 1000;
    assert.equal(secondsUntilUtcMidnight(t), Math.max(60, want), `${iso} 的重置点算错了`);
  }
});

test("预算 Retry-After:向上取整(ceil),不得少报", () => {
  // 距零点 0.5 秒 → ceil 应为 1;floor 会给 0
  const t = new Date(Date.parse("2026-10-06T00:00:00Z") - 500);
  const r = secondsUntilUtcMidnight(t);
  assert.ok(Number.isInteger(r), "Retry-After 必须是整数秒");
  // 由于有 60 秒下限,这里只会得到 60;真正的 ceil 判据在下面那条
  assert.ok(r >= 60, `不足 60 秒时应给 60 下限,实得 ${r}`);
});

test("预算 Retry-After:向上取整的精确判据(用 60 秒下限之外的场景)", () => {
  // 距零点 90.4 秒 → ceil = 91, floor = 90
  const t = new Date(Date.parse("2026-10-06T00:00:00Z") - 90_400);
  assert.equal(secondsUntilUtcMidnight(t), 91, "距零点 90.4 秒必须向上取整为 91");
  // 距零点 90.0 秒 → 恰好 90
  const t2 = new Date(Date.parse("2026-10-06T00:00:00Z") - 90_000);
  assert.equal(secondsUntilUtcMidnight(t2), 90);
});

test("预算 Retry-After:60 秒下限(不得返回 0 让客户端立刻重试)", () => {
  // 距零点 1 秒 → 若无下限会返回 1,客户端 1 秒后重试,几乎必然再撞
  const t = new Date(Date.parse("2026-10-06T00:00:00Z") - 1_000);
  assert.equal(secondsUntilUtcMidnight(t), 60, "接近零点时必须给 60 秒下限");
});

test("预算 Retry-After:距零点恰好等于一个整日上限(24h 附近不自相矛盾)", () => {
  const t = new Date("2026-10-05T00:00:01Z");
  const r = secondsUntilUtcMidnight(t);
  assert.equal(r, 86_399, "距 UTC 零点 1 秒时应报 86399");
  assert.ok(r <= 86_400, "不得超过一个整日");
});
