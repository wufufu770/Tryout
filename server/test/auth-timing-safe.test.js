// 元测试:token 比较的**时序侧信道防护**(R47 变异测试 V09/V10 发现的盲区)
//
// ## 为什么需要
// R47 把变异测试扩到安全关键代码,立刻抓到两个**真盲区**:
//
//   V10 把 `crypto.timingSafeEqual(ba, bb)` 换成 `ba.toString() === bb.toString()`
//   V09 删掉「长度不一致时也要自比较一次」的那次 `timingSafeEqual(ba, ba)`
//
// **两个变异跑完整套后端单测都全绿。**
// 有人把常量时间比较退化成普通字符串比较,或把 v10.2.5(P2-2)专门加的
// 时序防护删掉,**没有任何测试会红**。
//
// 而这两行是防"逐字符猜 token"的唯一屏障:`===` 在第一个不同字符处就返回,
// 耗时与公共前缀长度成反比,攻击者可以据此逐位爆破。
//
// ## 做法
// 给 `crypto.timingSafeEqual` 打桩**数调用次数**。
// 不检查它被怎么用,只检查"必须经过它" —— 这样任何把它换成别的比较方式的
// 改动都会立刻暴露。
//
// ⚠️ 走真实入口 `authMiddleware` 而不是导出一个内部函数:
// `safeEqual` 刻意不导出(内部实现),而为了测试去改它的可见性属于
// "为了可测而改生产接口"。中间件是它的唯一调用方,从那里观测最真实。
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";

const AUTH_PATH = path.resolve(import.meta.dirname, "..", "auth.js");
// ⚠️ 必须用 **DB_DIR**,不是 `server/data`。
//   `test/setup-env.mjs` 会把 DB_DIR 指向一次性临时目录(除非外部已设),
//   所以 auth.js 读的 token 在那里 —— 我最初读 `server/data/.api_token`,
//   拿到的是开发库那个,于是"正确 token"被判 401。
//   (这与 ISSUE-059 同源:测试依赖"调用方环境的某处恰好是这样"。)
// token 来源:优先环境变量(最直接),否则读 DB_DIR 下的文件。
// ⚠️ 两者都可能**不存在** —— .api_token 是**首次启动时**才生成的。
//   所以测试自己备一个确定值,不去依赖"环境里恰好已经有"。
//   这里用环境变量注入 + 顶层 import 时设置,保证 auth.js 读到它。
//
// ⚠️⚠️ R48 修正:上一版写的是 `if (!process.env.INTERVIEWX_API_TOKEN) { ... }`,
//   **门禁里这 3 条测试全红**,根因正是这个"认外部环境"的条件:
//   1. `build.sh:340` 跑后端单测时带 `INTERVIEWX_AUTH_DISABLED=1`
//      ⇒ `loadTokens()` 返回 null ⇒ 中间件直接 next() ⇒ **一次都不调 timingSafeEqual**
//      ⇒ 断言"必须观察到调用"必然失败。
//   2. 即使没禁用,门禁也可能带着**别的** `INTERVIEWX_API_TOKEN`,
//      我的 `if (!...)` 会沿用它,而 `TOKEN` 变量读到的也是它 —— 看似一致,
//      但那是**调用方的值**,不是本测试的确定值。
//
//   ⇒ 本测试必须**无条件自建环境**,不认任何外部值。
//     这与 ISSUE-059 的修法一致(`multer-errors.test.js` 显式清空认证 env):
//     **测试要能在敌对环境下自证,而不是假设环境干净。**
delete process.env.INTERVIEWX_AUTH_DISABLED;
process.env.INTERVIEWX_API_TOKEN = "meta-timing-safe-token-0123456789";
const TOKEN = "meta-timing-safe-token-0123456789";

/** 打桩 crypto.timingSafeEqual,跑一次中间件,返回 {status, calls} */
function runMiddleware({ headerToken }) {
  const orig = crypto.timingSafeEqual;
  let calls = 0;
  crypto.timingSafeEqual = (a, b) => {
    calls++;
    return orig(a, b);
  };
  try {
    // auth.js 是 ESM 单例,import 缓存保证与它拿到的是同一个 crypto 模块对象
    const req = {
      method: "POST",                       // 避开 GET 免鉴权分支
      path: "/anything",
      headers: headerToken === undefined ? {} : { authorization: `Bearer ${headerToken}` },
    };
    let status = null;
    const res = {
      status(c) { status = c; return this; },
      json() { return this; },
    };
    const { authMiddleware } = require$(AUTH_PATH);
    authMiddleware(req, res, () => { status = 200; });
    return { status, calls };
  } finally {
    crypto.timingSafeEqual = orig;
  }
}

// ESM 里没有 require,这里用同步 createRequire 拿 CJS 风格的 require
import { createRequire } from "node:module";
const require$ = createRequire(import.meta.url);

test("元测试:token 校验必须经过 crypto.timingSafeEqual(杀掉 V10)", () => {
  // R48:先自证环境。否则认证一旦被禁用,"没有 timingSafeEqual 调用"这句话
  // 会同时对应两种完全不同的解释:
  //   (a) 防护真的没了  (b) 认证被关掉,根本没走到比较
  // 上一版没做这个区分,于是门禁里报的是"防护可能已退化",而真实原因其实是 (b) ——
  // **一个误导性的失败信息比一个失败更糟**,它会把排查引向错误的方向。
  assert.notEqual(
    process.env.INTERVIEWX_AUTH_DISABLED, "1",
    "认证被禁用,timingSafeEqual 根本不会被调用 —— 本测试的前提不成立(检查 build.sh 的测试环境)"
  );
  assert.equal(
    process.env.INTERVIEWX_API_TOKEN, TOKEN,
    "INTERVIEWX_API_TOKEN 被外部改写,本测试的 TOKEN 与 auth.js 实际读到的值不一致"
  );

  const r = runMiddleware({ headerToken: TOKEN });
  assert.ok(
    r.calls >= 1,
    "没有观察到任何 timingSafeEqual 调用 —— 校验可能已退化成普通字符串比较(时序侧信道)"
  );
  assert.equal(r.status, 200, `正确 token 应通过,实得 status=${r.status}`);
});

test("元测试:长度不一致时也必须比较一次(杀掉 V09,v10.2.5 P2-2)", () => {
  // 长度不同的错误 token:旧实现会"提前 return",删掉防护后耗时显著变短
  const r = runMiddleware({ headerToken: "z" });
  assert.ok(
    r.calls >= 1,
    "长度不一致时直接返回,没做等量时间的比较 —— v10.2.5 的时序防护已被删除"
  );
  assert.equal(r.status, 401, "长度不同的错误 token 必须被拒");
});

test("元测试:正确 token 通过、错误 token 被拒(对照组,确保前两条不是恒真)", () => {
  assert.equal(runMiddleware({ headerToken: TOKEN }).status, 200, "正确 token 应通过");
  assert.equal(runMiddleware({ headerToken: "definitely-wrong" }).status, 401, "错误 token 应被拒");
  assert.equal(runMiddleware({ headerToken: "" }).status, 401, "空 token 应被拒");
  assert.equal(runMiddleware({ headerToken: undefined }).status, 401, "无 header 应 401");
});
