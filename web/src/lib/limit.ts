// 并发限流器
//
// 用途:批量调用 LLM 时限制同时在途的请求数。
// 独立评分(ADR-001)会把一次评估拆成 6 个维度调用,
// 评估一批问答就是 6×N 个请求 —— 不限流会同时打满供应商配额。
//
// 原实现内联在 HistoryPage.tsx 里,无法单测,也无法被其他调用方复用。
// 抽到这里后 HistoryPage 与未来的 scoringEngine 共用同一实现。

export interface Limit {
  <T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * 创建一个并发限流器
 * @param concurrency 最大并发数;小于 1 时归一化为 1(否则会死锁)
 */
export function createLimit(concurrency: number): Limit {
  const max = Math.max(1, Math.floor(concurrency) || 1);
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= max) return;
    const run = queue.shift();
    if (run) run();
  };

  return function limited<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task = () => {
        active++;
        // 无论成功失败都必须释放槽位,否则一次异常会永久卡死队列
        Promise.resolve()
          .then(fn)
          .then(
            (v) => { active--; next(); resolve(v); },
            (e) => { active--; next(); reject(e); }
          );
      };
      queue.push(task);
      next();
    });
  };
}
