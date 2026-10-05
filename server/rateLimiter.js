// 限流中间件(零依赖,基于内存 Map)
//
// ## 为什么要从 index.js 抽出来(R49)
// index.js 是**服务入口**:import 它就会启动整个 Express 服务,
// 所以任何单测都无法直接拿到 `createRateLimiter`。
//
// 而限流里真正难测、也最该测的是**时间契约**:
// `Retry-After` 到底是向上取整还是向下取整?窗口边界是 `<=` 还是 `<`?
// 这些只有在**可控的短窗口**上做行为断言才测得出来
// (生产窗口是 60_000ms,靠 e2e 等 60 秒不现实)。
//
// 抽出来后:
//   - 单元测试可以用 windowMs: 300 这样的短窗口,真实地等、真实地断言
//   - index.js 只是 import,行为一字未改
//
// v10:key 改用 req.ip(配合 app.set("trust proxy", 1) 取真实客户端 IP)
// 原实现用 XFF 第一段可伪造,攻击者可绕过限流
export function createRateLimiter({ windowMs, max, label }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    // v10:用 req.ip(BEHIND_PROXY=1 时取 XFF 最后一段,否则取 TCP 连接地址,均不可伪造)
    const ip = req.ip || "unknown";
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(ip, rec);
    }
    rec.count++;
    if (rec.count > max) {
      // ⚠️ 必须**向上取整**:窗口实际还剩 (resetAt - now) 毫秒,
      //   换算成秒后向上取整,才能保证"客户端按这个值等待后窗口一定已重置"。
      //   若用 floor,客户端会在窗口结束前几百毫秒重试,立刻又被 429 ——
      //   表现为"明明等够了还是被限流",且难以复现。
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.setHeader("Retry-After", retry);
      return res.status(429).json({ error: `请求过于频繁,请 ${retry} 秒后重试(${label})`, code: "RATE_LIMITED" });
    }
    next();
  };
}
