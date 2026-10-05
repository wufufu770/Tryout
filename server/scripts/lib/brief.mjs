// 诊断信息的安全格式化(R56)
//
// ## 为什么需要它
// e2e 脚本里到处是这种写法:
// ```js
// check("provider 创建", !!providerId, JSON.stringify(pv.body).slice(0, 120));
// ```
// 当 `pv.body` 是 `undefined` 时(比如请求失败、响应体缺失):
//
//   JSON.stringify(undefined) === undefined   ← **不是字符串!**
//   undefined.slice(0, 120)                  → TypeError
//
// ⇒ **断言本来该正常报失败的,却在"构造失败信息"这一步崩了。**
// R52 实际发生:`e2e-voice-smoke` 拿到一个 `{error, code}` 形态的响应(无 `data` 包装),
// `trJson.data` 是 undefined,脚本在第 97 行崩成
// `TypeError: Cannot read properties of undefined (reading 'slice')`,
// **把真正的失败原因(服务返回了什么)彻底吞掉**。
//
// 这比"断言失败"糟糕得多:失败处理本身失败,等于没有失败处理。
//
// ## 修法
// 全部换成 `brief(x, n)`:null/undefined 也能安全格式化,永不抛错。
export function brief(x, n = 120) {
  let s;
  try {
    // ⚠️ R56 自审修正:第一版写的是 `typeof x === "string" ? x : JSON.stringify(x)`,
    //   想着"字符串不用再序列化"更省事。**那是自作聪明,而且改变了原行为**:
    //     brief("")       → ''  (空!)  而 JSON.stringify("") → '""'
    //     brief("hello")  → 'hello'   而 JSON.stringify("hello") → '"hello"'
    //   空字符串与"没有内容"变得无法区分,而 e2e 诊断恰恰需要区分这两者。
    //   ⇒ 一律走 JSON.stringify,保持与被替换代码**完全一致**的输出,
    //     只把"崩"换成"不崩"。**替换应当是纯粹的健壮性加固,不该顺带改语义。**
    s = JSON.stringify(x);
  } catch {
    s = String(x);          // 循环引用等 stringify 抛错的场景
  }
  if (s === undefined) s = String(x);   // ⬅ JSON.stringify(undefined) 的坑
  return s.length > n ? s.slice(0, n) + "…" : s;
}
