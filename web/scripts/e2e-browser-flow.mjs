#!/usr/bin/env node
/*
 * 浏览器级 e2e —— **真实点击流**(补 FEATURE_MATRIX 里长期挂着的一条"未覆盖")
 *
 * ## 补的到底是哪个缺口
 * `e2e-browser.mjs` 已经覆盖了:首屏渲染、响应式断点、焦点陷阱的**可见性前提**、
 * 点击目标尺寸、控制台错误。FEATURE_MATRIX 里却一直留着一条:
 *   「浏览器级 E2E 覆盖的交互流程 | 目前只测渲染/响应式/尺寸/控制台,**未做真实点击流**」
 * 也就是说:本项目至今**没有任何一个测试真的点过按钮**。
 * 路由能渲染 ≠ 点得动;表单能显示 ≠ 输得进去;弹窗有 a11y hook ≠ 真的开得起来。
 * 常见的"元素存在但点击无效"(被 overlay 遮挡、pointer-events:none、z-index 错位)
 * 在纯渲染断言下**全部测不出来**。
 *
 * ## 本脚本做什么(全部用真实 Chrome 真实点击)
 *   A. 导航流:逐个点击 10 个导航项,校验 URL、主体内容非空、无新增控制台错误
 *   B. 语言切换 + 持久化:点「English」→ 断言导航文案变英文 → 刷新 → 断言持久化
 *      (localStorage 持久化是真实浏览器才能验的,jsdom 测不到真实 reload 语义)
 *   C. 模态框真实开合:点击触发器 → 断言弹窗出现且焦点进入 → Esc 关闭
 *   D. 表单禁用态联动:API key 输入框空 → 保存按钮 disabled;输入 → enabled
 *
 * ## 刻意不做的事
 *   - **绝不点保存 API key**:会污染本机正在跑的评测所用凭据。只验禁用态联动,不提交。
 *   - 不清 localStorage 里的 token,只动 locale。
 *   - 选择器一律用 `href` / `type` / `title` 等**与语言无关的稳定属性**,
 *     不用中文按钮文案(会随 i18n 变更而静默失效 —— 那种测试是负资产)。
 *
 * ## 前置
 *   后端 127.0.0.1:3001、前端 127.0.0.1:5173、本机 Chrome(CHROME_PATH 可指定)
 *
 * 用法:node scripts/e2e-browser-flow.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const WEB_BASE = process.env.WEB_BASE || "http://127.0.0.1:5173";
const API_BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const NAV = ["interview", "group", "flow", "experiences", "market", "agents", "materials", "history", "settings", "about"];

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m, d) => { console.log(`  ❗ ${m}${d ? `\n     ${d}` : ""}`); fail++; };

/* ---------------- 前置检查:不可达就明确失败,别静默假绿 ---------------- */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = "/home/wff/chrome";
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, "chrome-linux64", "chrome");
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.log("\n  ⚠️ 找不到 Chrome,跳过浏览器点击流 e2e(可用 CHROME_PATH 指定)");
  process.exit(0);
}
/**
 * ⚠️ R30(ISSUE-063):前置检查必须**区分「不可达」与「被限流」**。
 *   原先 `fetch(url)` 非 2xx 就 `exit(2)`,而 build.sh 把它排在另一条浏览器
 *   e2e 之后,后端通用限流(120 次/分钟)常被打满 → 拿到 429 → 直接跳过,
 *   **这一轮等于完全没有覆盖,而且报的是 SKIP 而不是 FAIL,很容易被忽略**。
 *   姊妹脚本 `e2e-browser.mjs` 早就处理过(4 次 × 62s 等待),这里一直没同步。
 *   → 这已是这对姊妹脚本的第三次"只修了一个"。
 *   故:429 视为"等得起",最多等 4×62s;真不可达才 exit(2)。
 */
for (const [name, url] of [["后端", `${API_BASE}/api/health`], ["前端", WEB_BASE]]) {
  let last = null, okUp = false;
  for (let attempt = 0; attempt < 4 && !okUp; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) { okUp = true; break; }
      last = `HTTP ${r.status}`;
      if (r.status === 429) {
        console.log(`  ${name}被限流(429),等待 62s 后重试…(${attempt + 1}/4)`);
        await new Promise((x) => setTimeout(x, 62000));
      } else break;
    } catch (e) { last = e.message; break; }
  }
  if (!okUp) {
    console.error(`\n❌ ${name}不可达(${url}):${last}`);
    process.exit(2);
  }
}
console.log(`\n  Chrome:${chromePath}`);
console.log(`  前端:${WEB_BASE}  后端:${API_BASE}`);

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

/** 每一步前清空,只统计**本步新增**的错误 —— 否则会被历史噪声淹没 */
let errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
const takeErrs = () => { const e = errs.slice(); errs = []; return e; };
/**
 * 404 静态资源与未配 token 的 401 属已知噪声,不计入失败。
 * 429 同样必须排除:反复跑本脚本会耗掉后端 `/api` 通用限流额度(120 次/分钟),
 * 而本脚本一次要访问 10 个路由,限流被打满时页面会报 429 —— 那是**环境问题不是产品缺陷**,
 * 若不排除就会稳定产出**假失败**(ISSUE-024 记录过同类陷阱)。
 */
const realErrs = (list) =>
  list.filter((t) => !/status of 404|status of 401|status of 429|favicon/.test(t));

/**
 * 等页面**真正渲染完**再取文本长度。
 *
 * ⚠️ 第一版只 `waitForTimeout(450)` 然后断言 `bodyLen >= 20`,结果 7 个不同页面
 *   全部返回**一模一样的 136 字符** —— 那不是巧合,是懒加载路由的**骨架屏**,
 *   骨架当然轻松越过 20 字符的下限。实测 2.5s 后各页真实内容为 191~2037 字符。
 *   这就是**假绿**的典型长相:断言通过,但什么都没验到。
 *   (与"宽松断言让 ISSUE-012 的 500 溜过"同一类问题。)
 *
 * 判据:轮询到**文本长度连续两次不变**即视为渲染完成,再要求明显大于骨架基线。
 */
const SKELETON_BASELINE = 160; // 骨架屏实测 134~136,留一点余量
/**
 * ⚠️ R30(ISSUE-062):R18 修的版本**只等"文本长度稳定"**,这不够 ——
 *   **骨架屏本身也是稳定的**。负载下(build.sh 里紧接上一条浏览器 e2e 跑)
 *   `/settings` 的数据加载慢,骨架 136 字符纹丝不动地待着,
 *   于是"稳定"立刻达成 → 返回 136 → 判定失败。
 *   **这把"慢"当成了"坏"** —— 独立跑时该页 670 字符、一路绿灯,门禁里稳定失败。
 *
 * 正确判据:必须同时满足 ① 超过骨架基线 ② 连续两次长度不变。
 * 只满足 ② 的一律继续等;等到超时仍不满足,那才是真的没渲染出来。
 */
async function waitForRealContent(page, timeoutMs = 15000) {
  const read = () => page.locator("body").innerText().catch(() => "");
  const t0 = Date.now();
  let prev = -1, stable = 0, last = "";
  while (Date.now() - t0 < timeoutMs) {
    last = (await read()).trim();
    if (last.length > SKELETON_BASELINE) {
      if (last.length === prev) { if (++stable >= 2) return last; }
      else { stable = 0; prev = last.length; }
    } else {
      // 还在骨架屏:重置"已稳定"计数,继续等
      stable = 0; prev = -1;
    }
    await page.waitForTimeout(300);
  }
  return last.trim();
}

/* ================================================================ *
 * 预置:先把引导弹窗标记为已完成,否则 A/B 段的每一次点击都会被它吞掉
 * (OnboardingModal 是 fixed/z-[150],会 intercept pointer events —— 这是实测发现的,
 *  不是猜的。C 段会主动清掉这个标记,以新用户视角再测一遍。)
 * ================================================================ */
await page.goto(WEB_BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.setItem("tryout:onboarding:completed", "true");
  localStorage.setItem("tryout:locale", "zh-CN");
});

/* ================================================================ *
 * A. 导航流 —— 真的点,不是改 URL
 * ================================================================ */
console.log("\n── A. 真实点击导航(10 条路由)──");
await page.goto(WEB_BASE, { waitUntil: "networkidle" });
// 首屏可能落在 /interview;先确保在一个已渲染的页面里再找导航
await page.waitForSelector("a[href^='/']", { timeout: 15000 }).catch(() => {});
takeErrs();

for (const route of NAV) {
  const link = page.locator(`nav a[href="/${route}"], a[href="/${route}"]`).first();
  const visible = await link.isVisible().catch(() => false);
  if (!visible) { bad(`导航项 /${route} 不可见/不存在,无法点击`); continue; }
  // 关键:用 click() 而不是 goto —— 才能暴露被遮挡/pointer-events:none 的问题
  try { await link.click({ timeout: 8000 }); }
  catch (e) { bad(`/${route} 点击失败(可能被遮挡或不可命中)`, e.message.split("\n")[0]); continue; }
  await page.waitForTimeout(450); // 路由切换的过渡
  const url = new URL(page.url()).pathname;
  const text = await waitForRealContent(page);
  const bodyLen = text.length;
  const e = realErrs(takeErrs());
  if (url !== `/${route}`) { bad(`/${route} 点击后 URL 不符`, `实际 ${url}`); continue; }
  if (bodyLen < SKELETON_BASELINE) {
    bad(`/${route} 点击后仍疑似骨架屏(未真正渲染)`, `文本 ${bodyLen} 字符 ≤ 基线 ${SKELETON_BASELINE}`);
    continue;
  }
  if (e.length) { bad(`/${route} 产生 ${e.length} 条控制台错误`, e[0]); continue; }
  ok(`/${route} → URL 正确、渲染 ${bodyLen} 字符、无错误`);
}

/* ================================================================ *
 * B. 语言切换 + 刷新持久化
 * ================================================================ */
console.log("\n── B. 语言切换与持久化(真实 reload)──");
await page.goto(`${WEB_BASE}/settings`, { waitUntil: "networkidle" });
takeErrs();
  // ⚠️ R30:ISSUE-062 只修了 A 段,B/D 段**同样** goto 后立即查元素、没有等渲染,
  //   负载下设置页数据未到 → 按钮/输入框查不到。这是**同一个文件内**的第二次"只修了一个"。
  await waitForRealContent(page);
const navBefore = (await page.locator("a[href='/history']").first().innerText().catch(() => "")).trim();
const enBtn = page.locator("button[title='English']").first();
if (!(await enBtn.isVisible().catch(() => false))) {
  bad("设置页未找到语言切换按钮 button[title='English']");
} else {
  await enBtn.click({ timeout: 8000 });
  await page.waitForTimeout(600);
  const navAfter = (await page.locator("a[href='/history']").first().innerText().catch(() => "")).trim();
  if (navBefore === navAfter) {
    bad("点 English 后导航文案未变化", `前后都是「${navBefore}」`);
  } else {
    ok(`点 English 后文案切换:「${navBefore}」→「${navAfter}」`);
  }
  // 真实 reload:jsdom 测不到 localStorage 在导航后的真实恢复语义
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const navReload = (await page.locator("a[href='/history']").first().innerText().catch(() => "")).trim();
  if (navReload !== navAfter) {
    bad("刷新后语言未持久化", `刷新前「${navAfter}」→ 刷新后「${navReload}」`);
  } else {
    ok(`刷新后语言持久化:仍是「${navReload}」`);
  }
  // 还原成中文,免得污染后续人工使用。
  // ⚠️ title 用的是 LOCALES 里的 `englishName`(zh-CN → "Chinese"),**不是** label("中文")。
  const zhBtn = page.locator("button[title='Chinese']").first();
  if (await zhBtn.isVisible().catch(() => false)) {
    await zhBtn.click({ timeout: 8000 });
    await page.waitForTimeout(500);
    const back = (await page.locator("a[href='/history']").first().innerText().catch(() => "")).trim();
    ok(`已还原为中文:「${back}」` + (back === navBefore ? "" : ` (注意:与切换前不同,原为「${navBefore}」)`));
  }
}

/* ================================================================ *
 * C. 引导弹窗:新用户视角的**第一次点击**
 * ================================================================ *
 * 写这一段是被实测逼出来的:第一版用"遍历所有按钮直到弹出模态框"的启发式,
 * 结果 Playwright 报 `... intercepts pointer events` —— 抓到的不是 bug 而是
 * **OnboardingModal**(`components/OnboardingModal.tsx:81,z-[150]`)挡住了整页。
 * 那是真实用户**第一次打开应用必然遇到**的东西,所以它本身就是最有价值的点击流:
 *   全新 localStorage → 引导弹窗出现 → 遮挡全页 → 点"跳过" → 弹窗关闭 → 页面可点
 * 同时,清掉完成标记后其它段落才可复现(否则导航点击全被遮罩吞掉)。
 */
console.log("\n── C. 引导弹窗(新用户首次进入)──");
// 回到"全新用户"状态:清掉引导完成标记与语言(语言由 B 段自己管理)
await page.goto(WEB_BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.removeItem("tryout:onboarding:completed");
  localStorage.removeItem("tryout:onboarding:profile");
});
await page.goto(`${WEB_BASE}/interview`, { waitUntil: "networkidle" });
takeErrs();

const overlay = page.locator("div.fixed.inset-0").first();
if (!(await overlay.isVisible().catch(() => false))) {
  bad("全新 localStorage 下引导弹窗未出现(新用户将直接看到裸界面)");
} else {
  ok("全新用户进入时引导弹窗出现");
  // 验证它确实**挡得住**点击 —— 否则这段等于没测
  const blocked = await page.evaluate(() => {
    const ov = document.querySelector("div.fixed.inset-0");
    if (!ov) return false;
    const cs = getComputedStyle(ov);
    return cs.position === "fixed" && (cs.zIndex === "150" || Number(cs.zIndex) >= 150);
  });
  blocked ? ok("弹窗为 fixed/z-index≥150,确实构成点击遮挡") : bad("弹窗未构成点击遮挡,新用户可误触背景");
  // 用 aria-label 定位(与语言无关),aria-label 是读屏用户能拿到的稳定名
  const skip = page.locator("div.fixed.inset-0 button[aria-label]").first();
  if (!(await skip.isVisible().catch(() => false))) {
    bad("引导弹窗内未找到带 aria-label 的跳过按钮(读屏用户无法操作)");
  } else {
    await skip.click({ timeout: 5000 }).catch((e) => bad("点击跳过失败", e.message.split("\n")[0]));
    await page.waitForTimeout(500);
    const gone = (await page.locator("div.fixed.inset-0").count()) === 0;
    gone ? ok("点击跳过后引导弹窗关闭") : bad("点击跳过后弹窗仍未关闭");
    // 关闭后页面必须真的可点:再点一次刚才被遮挡的导航
    const again = page.locator("a[href='/settings']").first();
    try {
      await again.click({ timeout: 5000 });
      await page.waitForTimeout(400);
      const u = new URL(page.url()).pathname;
      u === "/settings" ? ok("关闭后导航恢复可点(遮挡确已解除)") : bad("关闭后导航仍点不动", `URL=${u}`);
    } catch (e) {
      bad("关闭后导航仍点不动(遮罩可能未真正移除)", e.message.split("\n")[0]);
    }
  }
  const eC = realErrs(takeErrs());
  eC.length === 0 ? ok("C 段无控制台错误") : bad(`C 段 ${eC.length} 条控制台错误`, eC[0]);
}

/* ================================================================ *
 * D. 表单禁用态联动(绝不点保存,避免污染本机凭据)
 * ================================================================ */
console.log("\n── D. 表单禁用态联动(只验联动,不提交)──");
await page.goto(`${WEB_BASE}/settings`, { waitUntil: "networkidle" });
takeErrs();
  // ⚠️ R30:ISSUE-062 只修了 A 段,B/D 段**同样** goto 后立即查元素、没有等渲染,
  //   负载下设置页数据未到 → 按钮/输入框查不到。这是**同一个文件内**的第二次"只修了一个"。
  await waitForRealContent(page);
const tokenInput = page.locator("input[type='password']").first();
if (!(await tokenInput.isVisible().catch(() => false))) {
  bad("设置页未找到 API token 输入框");
} else {
  // 保存按钮:内容含 Save 图标,取该行内按钮;用"空值时是否 disabled"来定位
  const saveBtn = page.locator("input[type='password'] + button").first();
  const d0 = await saveBtn.isDisabled().catch(() => null);
  await tokenInput.fill("e2e-not-saved-probe");
  await page.waitForTimeout(250);
  const d1 = await saveBtn.isDisabled().catch(() => null);
  if (d0 === true && d1 === false) {
    ok(`保存按钮禁用态联动正确:空值 disabled=${d0} → 有值 disabled=${d1}`);
  } else {
    bad("保存按钮禁用态未随输入联动", `空值 disabled=${d0},有值 disabled=${d1}`);
  }
  // ⚠️ 刻意**不点保存**:会覆盖本机 token,影响正在运行的评测
  await tokenInput.fill("");
  await page.waitForTimeout(200);
  const d2 = await saveBtn.isDisabled().catch(() => null);
  d2 === true ? ok("清空后保存按钮恢复 disabled(未提交任何凭据)") : bad("清空后保存按钮未恢复 disabled");
  const eD = realErrs(takeErrs());
  eD.length === 0 ? ok("D 段无控制台错误") : bad(`D 段 ${eD.length} 条控制台错误`, eD[0]);
}

await browser.close();
console.log(`\n${"=".repeat(58)}`);
console.log(`  结果:${pass} 通过 / ${fail} 失败`);
console.log(`${"=".repeat(58)}\n`);
process.exit(fail > 0 ? 1 : 0);
