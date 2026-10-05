// 守卫测试:评测脚本必须**走生产代码路径**,且不得把 deps 漏成真实网络调用
//
// ## 为什么需要这条测试
// R17 跑完 100 样本真实评测,得出一个统计上极显著的结论:
//   「评分器偏严一档」,二项检验 P ≈ 2.0e-9。
// R18 追查发现**这个结论是假的**,而且是评测脚本自己的方法论缺陷:
//   - 脚本调用 `scoreAllDimensions`,它**没有重试**;
//   - 生产 UI(`InterviewPage.tsx:437` / `HistoryPage.tsx:300`)调的是
//     **`scoreWithRetry`(2 次尝试)**;
//   - `scoreAllDimensions` 在整个 `src/` 里**零生产调用方**,只有评测脚本在用。
// 于是量到的是一条**生产根本不走的路径**。该路径上解析失败率高达 ~37%,而
// `aggregateScores` 对缺失维度记 **0 分**(有意的 fail-closed,aggregate.test.ts:58 守护),
// 于是"偏严"绝大部分是 0 分造出来的假象。R18 同批样本实测:
//   无缺失维度 → 平均偏移 **0.00**;有缺失维度 → 平均偏移 **-1.00**。
//
// ## 第二个坑(改生产路径时踩的)
// 把调用换成 `scoreWithRetry` 时,**漏传了 `deps`**。`scoreWithRetry` 的默认 deps 是
// `{ chat: api.chat }` —— 于是 `--mock` 模式照样发真实 HTTP:无凭据 → 鉴权失败 →
// 被 try/catch 静默吞掉 → 6 个维度全 null → 全落 E → 报告照常打印、数字全假。
// **token 计数还是 0**(请求根本没到 LLM),只有实测才抓得到。
//
// 这两条都属于"测试自己有 bug 却报绿"——比产品缺陷更危险,所以用静态守卫钉死。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SCRIPTS = path.resolve(import.meta.dirname, "..", "..", "..", "scripts");
const srcRaw = fs.readFileSync(path.join(SCRIPTS, "eval-accuracy.mjs"), "utf8");
/**
 * ⚠️ R60 自审修正:原本 `src` 是**带注释**的源码全文,于是
 *   `expect(src).toMatch(/runAt/)` 这类断言会**匹配到注释里的那个词**,
 *   于是我把 `runAt: new Date()...` 真删掉,测试**照样绿** —— 恒真。
 *
 * 这是 R-050 批评过的"文本断言"反模式,我自己又犯了一次。
 * 修法与 `server/test/access-log-path.test.js` 一致:**先剥注释再匹配**。
 */
const src = srcRaw
  .replace(/\/\*[\s\S]*?\*\//g, "")   // 块注释
  .replace(/^\s*\/\/.*$/gm, "");          // 行注释
const srcCommentsStripped = src !== srcRaw;

// 剥注释,避免匹配到说明性注释里的示例代码
const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("评测脚本契约:必须测产品真实行为", () => {
  it("不得调用无重试的 scoreAllDimensions(生产零调用方的那条路径)", () => {
    // 允许在注释里提到,但代码里不能真的调用
    const calls = [...code.matchAll(/\bscoreAllDimensions\s*\(/g)];
    expect(calls.length, "评测脚本仍调用 scoreAllDimensions —— 它没有重试,生产不用它")
      .toBe(0);
  });

  it("必须经 scoreWithRetry 走生产路径", () => {
    expect(code).toMatch(/\bscoreWithRetry\s*\(/);
  });

  it("scoreWithRetry 调用必须透传 deps(否则 --mock 会打真实网络)", () => {
    const m = /scoreWithRetry\s*\(([^)]*)\)/.exec(code);
    expect(m, "未找到 scoreWithRetry 调用").toBeTruthy();
    // 捕获组是 `[^)]*`,**不含**右括号,所以只能锚到参数末尾,不能要求 `\)`
    const last = m![1].trim().split(",").pop()!.trim();
    // ⚠️ R54:原判据是正则 `/^\w*[Dd]eps$/`,即**检查变量名**。
    //   R54 给 deps 加了 onDiag(埋点),调用处写的是 `{...deps, onDiag}`,
    //   于是这条测试红了 —— 而**行为完全正确**:deps 照样透传了。
    //   一个锁"名字"的测试会挡住正确改动,和 R-050 批评的
    //   `assert.match(block, /getUTCDate/)`(锁文本不锁语义)是同一类反模式。
    //   ⇒ 改为锁**行为**:末位实参必须是一个"像 deps 的东西"
    //     (含 chat / onDiag 的对象字面量,或一个标识符),这才是
    //     "不会退回默认 api.chat、不会让 --mock 打真实网络"的真正判据。
    // ⚠️ R54 反向验证抓到本判据第一版是**恒真**的:`/^\w+$/` 会把
    //   "漏掉 deps"时的末位实参 `2`(attempts)也判成"像 deps"。
    //   ⇒ 数字必须排除,只有**标识符**才可能是 deps。
    const isDepsLike =
      (last.startsWith("{") && /\bchat\b|onDiag/.test(last)) ||
      (/^\w+$/.test(last) && !/^\d+$/.test(last));
    expect(
      isDepsLike,
      `scoreWithRetry 末位实参是「${last}」,不像 deps —— 默认 deps 是 api.chat,mock 模式会发真实请求`
    ).toBe(true);
    expect(last, "deps 不能是 undefined/null").not.toMatch(/^(undefined|null)$/);
  });

  it("并发限流器必须来自项目自己的 limit.ts,不得自行实现", () => {
    // 脚本曾用"凑合"的并发写法;统一走 createLimit 保证与生产同一实现
    expect(code).toMatch(/\bcreateLimit\s*\(/);
    expect(src).toMatch(/src\/lib\/limit\.ts/);
  });
});

describe("消融开关的防退化", () => {
  it("rubric 映射必须用 split(展开字符)—— [\"ABCDE\"] 是单元素数组,会静默注入空", () => {
    // ["ABCDE"].filter(L => r[L]) 里 L === "ABCDE",r["ABCDE"] 恒 undefined,
    // 于是 keyPoints 为空数组,注入退化成"什么都没注入",两轮数字几乎相同,
    // 还会被误读成"注入 rubric 没用"。靠肉眼几乎发现不了。
    // 判定反模式要用**剥掉注释**后的代码 —— 否则会匹配到脚本里记录该 bug 的说明注释
    expect(code).not.toMatch(/\["ABCDE"\]/);
    expect(code).toMatch(/"ABCDE"\.split\(""\)/);
  });

  it("rubric 映射为空时必须显式中止,不得静默降级", () => {
    expect(src).toMatch(/映射为空/);
    expect(src).toMatch(/已中止/);
  });
});

describe("落盘字段必须能证伪关键假设", () => {
  it("每条结果都要记录缺失维度数与各维度分", () => {
    // 缺了这两个字段,"偏严"就无法与"解析失败被记 0 分"区分开,结论不可证伪
    expect(src).toMatch(/missingDims/);
    expect(src).toMatch(/noEvidenceDims/);
    expect(src).toMatch(/dimScores/);
  });

  it("前置条件:注释必须已被剥离,否则下面所有 toMatch 都可能匹配到注释", () => {
    expect(srcCommentsStripped, "注释剥离未生效 —— toMatch 会匹配到注释文字,断言将恒真")
      .toBe(true);
    // 实证:runAt 这个词在剥离后应只出现在真正赋值的那一行
    expect(src).toMatch(/runAt:\s*new Date\(\)/);
  });

  it("每条结果都必须带 runAt 与 provider(R60)", () => {
    // R60 实测:同一批样本相隔几轮,解析失败率从 38% 变成 0%,
    // 而本地解析代码未变 ⇒ 指向 provider 侧行为漂移。
    // **没有时间戳,"跨轮次比较"在方法上就不成立** ——
    // 我此前反复比较的百分比,底层分布可能早已改变而我完全不知道。
    // ⇒ 这两个字段是**结论时效性的前提**,不是可选的元数据。
    expect(src).toMatch(/runAt/);
    expect(src).toMatch(/provider:\s*PROVIDER/);
  });

  it("必须落盘 finishReason 与输出长度(R54 埋点,否则无法验证截断假设)", () => {
    // R38 限 reasoning、R53 限 evidence,两次都建立在"输出太长被截断"这个
    // **从未被测量过**的前提上。R54 靠这两个字段把它证伪了 ——
    // finishReason 从来不是 length,输出仅 ~210 字符。
    // ⇒ 没有它们,同类假设还会以同样的方式被当成事实。
    expect(src).toMatch(/finishReasons/);
    expect(src).toMatch(/outLengths/);
  });

  it("⚠️ real 模式的 deps.chat 必须原样透传上游响应(R63)", () => {
    // R63 实测的教训:原先写的是 `return { content: j?.data?.content || "" }`,
    // **只取 content、丢掉 finishReason/model/tokens**。
    // ⇒ R54 看到落盘里 finishReasons 全空,据此断言"不存在截断",
    //   **而那个空是因为这个包装没把字段传上来**。观测不到 ≠ 没发生。
    // ⇒ 断言:real 分支必须整体展开 `...data`,而不是只挑 content。
    expect(src, "real 模式的 chat 丢了上游字段 —— 会让 finishReason 类观测永久失效")
      .not.toMatch(/return\s*\{\s*content:\s*j\?\.data\?\.content/);
    expect(src).toMatch(/\.\.\.d\b|\.\.\.data/);
  });

  it("必须落盘 failReason 与 resKeys(R62 失败现场,否则抓不到空 content)", () => {
    // R61 实测 6 次失败**全是 contentLength === 0**,
    // 而 `failHeads`(contentHead)对空 content 结构上就抓不到 ——
    // `"".slice(0,300)` 仍是 `""`。
    // `failReason` 区分 field-missing / field-null / not-a-string / empty-string,
    // 这五种对应**不同的上游成因与不同的修法**;`|| ""` 把它们全抹成同一个 0 长度。
    expect(src).toMatch(/failReasons/);
    // ⚠️ 不能只写 toMatch(/resKeys/) —— onDiag 的**形参名**也是 resKeys,
    //   删掉落盘那行照样能匹配到它 ⇒ 恒真(反向验证实测抓到)。
    //   ⇒ 必须匹配"它是 row 的一个字段"这个形态:`resKeys: (() => {`。
    expect(src).toMatch(/resKeys:\s*\(\(\)\s*=>/);
  });
});
