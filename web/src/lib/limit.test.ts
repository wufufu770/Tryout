// 并发限流器单元测试
// Seam:limit()(返回包装函数)——纯异步控制流,可测且不依赖计时精度
import { describe, it, expect } from "vitest";
import { createLimit } from "./limit";

describe("createLimit", () => {
  it("应限制并发数为 1(严格串行)", async () => {
    const limit = createLimit(1);
    let active = 0, maxActive = 0;
    const order: number[] = [];
    const task = (id: number) => limit(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      order.push(id);
      active--;
    });
    await Promise.all([task(1), task(2), task(3)]);
    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it("应限制并发数为 2", async () => {
    const limit = createLimit(2);
    let active = 0, maxActive = 0;
    const task = () => limit(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(maxActive).toBe(2);
  });

  it("并发数大于任务数时不应阻塞", async () => {
    const limit = createLimit(10);
    let active = 0, maxActive = 0;
    const task = () => limit(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
    });
    await Promise.all([task(), task(), task()]);
    expect(maxActive).toBe(3); // 3 个任务并发跑,不受 limit=10 影响
  });

  it("应返回任务的返回值", async () => {
    const limit = createLimit(1);
    expect(await limit(async () => "ok")).toBe("ok");
    expect(await limit(async () => 42)).toBe(42);
    expect(await limit(async () => null)).toBeNull();
  });

  it("任务抛错时应释放并发槽位并向上抛", async () => {
    const limit = createLimit(1);
    await expect(limit(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // 槽位必须已释放,后续任务仍能执行
    expect(await limit(async () => "still works")).toBe("still works");
  });

  it("一个任务失败不应阻塞后续任务", async () => {
    const limit = createLimit(1);
    const results = await Promise.allSettled([
      limit(async () => { throw new Error("fail1"); }),
      limit(async () => "ok2"),
      limit(async () => "ok3"),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: "ok2" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "ok3" });
  });

  it("并发数 <= 0 时应退化为 1(避免死锁)", async () => {
    const limit = createLimit(0);
    let active = 0, maxActive = 0;
    const task = () => limit(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;
    });
    // 若不归一化为 1,将永远等待 → 用 Promise.race 加超时兜底
    const done = Promise.all([task(), task()]);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT: 疑似死锁")), 1000));
    await Promise.race([done, timeout]);
    expect(maxActive).toBe(1);
  });
});
