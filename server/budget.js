// 日 token 预算的**时间计算**(R50 从 index.js 抽出)
//
// ## 为什么要抽
// 这段计算原先内联在 `/api/chat` 的路由处理里。R49 发现它的 `Retry-After`
// 只有**源码正则测试**(`chat-budget-contract.test.js` 用 `assert.match` 匹配
// `getUTCDate` 等字样),而那类测试**检测"存在性",不检测"语义位置"** ——
// 把 `getUTCDate()` 改成 `getDate()`,只要别处残留一个 `getUTC*` 字符串就照样通过。
//
// 抽成纯函数后,可以在**指定时区**下直接断言"它到底算的是哪个零点"。

/**
 * 距下一个 UTC 零点还有多少秒(向上取整,至少 60 秒)。
 *
 * ⚠️ 必须按 **UTC** 算,不能按本地时区:
 * `getTodayTokenUsage` 用 `date(created_at)=date('now')` 分日,
 * 而 SQLite 的 `date('now')` 是 UTC。两者口径必须一致,
 * 否则非 UTC 部署(如本机 UTC+8)会给出**偏差整整一天**的重置点。
 *
 * @param {Date} [now] 注入当前时间(便于测试),默认取系统时间
 * @returns {number} 秒数,写入 `Retry-After` 头
 */
export function secondsUntilUtcMidnight(now = new Date()) {
  const nextUtcReset = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  // ⬆ 向上取整:少报 1 秒会让客户端在窗口结束前就重试,立刻又被 429。
  // 60 秒下限:给一个不会立刻重试的最小退避。
  return Math.max(60, Math.ceil((nextUtcReset - now.getTime()) / 1000));
}
