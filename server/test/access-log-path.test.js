// 单元测试:访问日志的 path 字段必须反映**真实被请求的路由**(守卫 ISSUE-033)
//
// ## 缺陷现象
// `logger.js` 在 `res.on("finish")` 里读 `req.path` 来记录请求路径,
// 初衷是脱敏(不含 query,避免 token/PII 落日志)。但 `req.path` 是**基于
// `req.url` 实时计算**的,而 `app.use("/api/chat", limiter)` 这类挂载会把
// `req.url` 改写成挂载点内的相对路径,且**限流中间件短路返回 429 时不会还原**
// (只有 `app.post(...)` 路由匹配后 Express 才在返回路径上恢复前缀)。
//
// 后果是访问日志**恰恰在最需要排查的请求上失真**:
//   36 条成功请求 → "path":"/api/chat"  ✅
//    2 条被限流的 → "path":"/"          ❌
// 运维从日志里无法判断到底是哪个接口在被限流,429 告警定位成本直接翻倍。
//
// ## 为什么用静态守卫
// 该缺陷只在"被限流短路"这条路径上出现。要在单测里复现需要连打 >20 次
// /api/chat 并解析日志文件,成本高且依赖真实限流器状态。断言"路径在
// 改写之前就被定格"更直接,也更能防住同类回归(任何把 req.path 挪到
// finish 回调里的改法都会被拦下)。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(SERVER_DIR, "logger.js"), "utf8");

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
}
const code = stripComments(src);

test("path 在进入中间件时就被定格,不依赖 finish 时点的 req.path", () => {
  // 必须存在一个"提前抓取"的赋值
  const grab = /const\s+(\w*[Pp]ath\w*)\s*=\s*req\.path\s*;/.exec(code);
  assert.ok(grab, "未发现对 req.path 的提前定格(ISSUE-033 回归)");
  const varName = grab[1];
  // 且 write(...) 的 path 字段必须用这个变量
  assert.match(
    code,
    new RegExp(`path:\\s*${varName}\\b`),
    `访问日志的 path 字段应使用提前定格的 ${varName},而不是现算的 req.path`,
  );
});

test("finish 回调内不再直接读取 req.path", () => {
  // 只检查 write(...) 调用附近:若那里写的是 req.path,说明又退回去了
  const writeBlock = /write\(level,\s*"request",\s*\{[\s\S]*?\}\)/.exec(code);
  assert.ok(writeBlock, "未找到访问日志的 write 调用");
  assert.doesNotMatch(
    writeBlock[0],
    /\bpath:\s*req\.path\b/,
    "write(\"request\") 里不能现算 req.path —— 限流短路时它已被改写成挂载内相对路径",
  );
});

test("仍保持脱敏:不使用含 query 的 originalUrl", () => {
  // v10 引入 path 脱敏是为了避免 ?token=xxx / ?phone=138... 落日志,
  // ISSUE-033 的修复不能把这个已经修好的洞重新打开。
  assert.doesNotMatch(
    code,
    /originalUrl/,
    "不得用 req.originalUrl(含 query,会带入 token/PII)作为日志路径",
  );
});
