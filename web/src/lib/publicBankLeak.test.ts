/**
 * 回归测试:公开产物绝不能含参考答案(ISSUE-002)
 *
 * ## 为什么需要这条测试
 * `web/public/questionbank.json` 会被 Vite 原样拷进 `dist/`,而 `dist/` 正是
 * GitHub Pages 的发布产物(pages.yml 上传 web/dist)。历史上导出脚本往 public/
 * 写的是含 referenceAnswer 的完整题库,导致任何人一次 GET 就能下载全部 808 题的
 * 评分基准,直接击穿"参考答案不对外公开"的产品策略。
 *
 * 运行时那层防护(`toLite()` / `stripReference()`)只保护 API 与前端状态,
 * 挡不住直接 curl 静态产物的人。所以必须在**产物层面**保证。
 *
 * 这条测试锁死的不变量:
 *   1. public/questionbank.json 不含 referenceAnswer
 *   2. public/ 题数与 server/data/ 权威副本一致(剥离答案不能丢题)
 *   3. public/ 保留 QuestionLite 所需的全部字段(离线兜底仍可用)
 *   4. server/data/ 权威副本仍含答案(评估链路不能被误伤)
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 本文件位于 web/src/lib/,故上溯两级才是 web/
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC_BANK = path.join(WEB, "public", "questionbank.json");
const SERVER_BANK = path.join(WEB, "..", "server", "data", "questionbank.json");

/** QuestionLite 的字段集,与 src/lib/questionSelector.ts 保持一致 */
const LITE_FIELDS = [
  "id", "industry", "type", "difficulty", "title", "content", "keyPoints",
  "tags", "estimatedMinutes",
];

const readBank = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

describe("公开产物不得泄露参考答案 (ISSUE-002)", () => {
  it("public/questionbank.json 存在(离线兜底依赖它)", () => {
    expect(fs.existsSync(PUBLIC_BANK)).toBe(true);
  });

  it("public/ 中没有任何题携带 referenceAnswer", () => {
    const { questions } = readBank(PUBLIC_BANK);
    const leaked = questions.filter((q) => "referenceAnswer" in q && q.referenceAnswer);
    const leakedIds = leaked.map((q) => q.id);
    expect(
      leakedIds,
      `以下题泄露了参考答案(共 ${leaked.length} 条): ${leakedIds.slice(0, 5).join(", ")}`,
    ).toEqual([]);
  });

  it("public/ 的题数与权威副本一致(剥离答案不能丢题)", () => {
    const lite = readBank(PUBLIC_BANK);
    const full = readBank(SERVER_BANK);
    expect(lite.questions.length).toBe(full.questions.length);
    expect(lite.questions.length).toBeGreaterThan(0);
  });

  it("public/ 的每题都保留 QuestionLite 全部字段(离线兜底仍可用)", () => {
    const { questions } = readBank(PUBLIC_BANK);
    for (const q of questions) {
      for (const f of LITE_FIELDS) {
        expect(q[f], `${q.id} 缺字段 ${f}`).toBeDefined();
      }
    }
  });

  it("server/data/ 权威副本仍含参考答案(评估链路不能被误伤)", () => {
    const { questions } = readBank(SERVER_BANK);
    const withAnswer = questions.filter((q) => q.referenceAnswer);
    expect(withAnswer.length).toBe(questions.length);
  });

  it("两份文件的题目 id 集合完全一致", () => {
    const liteIds = readBank(PUBLIC_BANK).questions.map((q) => q.id).sort();
    const fullIds = readBank(SERVER_BANK).questions.map((q) => q.id).sort();
    expect(liteIds).toEqual(fullIds);
  });
});
