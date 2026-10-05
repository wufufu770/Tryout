// 属性/模糊测试:**校验层**(`server/validate.js`)
// 与解析层的模糊测试(web/src/lib/fuzz-parsers.test.ts)配对。
//
// ## 为什么校验层值得单独模糊
// 它是**全站所有输入的第一道关** —— 上传、导入、provider 配置、agent 保存、
// 评测请求全部走它。而它用的是自研的零依赖实现(不是 Zod),边界条件多:
//
//   - `.trim()` 之后才判空(ISSUE-045 修过一次)
//   - `.partial()` 的默认值陷阱(ISSUE-041)
//   - `optional()` 改写共享 schema(ISSUE-041)
//   - 未知字段静默剥离(ISSUE-064 的机制来源)
//
// 这些都是"只在某种畸形输入下才暴露"的类型 —— 枚举式测试很难覆盖全,
// 模糊测试正合适。
//
// ## 硬性要求
// 1. **畸形输入不得让校验层抛异常**(抛 ⇒ 500 ⇒ 错误信息进日志)
// 2. **纯空白/空输入不得绕过必填校验**
import { test } from "node:test";
import assert from "node:assert/strict";
import { s } from "../validate.js";

/** 确定性伪随机:失败可复现 */
function makeRng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

const BLANKS = [
  "", " ", "  ", "\n", "\t", "\0", "　", "﻿", "\v", "\f",
  "\r\n", "   \n\t  ", "　　", "", "᠎", "　﻿",
];

test("模糊:string().min(1) 面对 2000 条随机输入,纯空白一律不得绕过", () => {
  const rng = makeRng(0x5eed);
  const schema = s.string().min(1, "不能为空");
  const bypass = [];
  for (let i = 0; i < 2000; i++) {
    const input = i % 2 === 0
      ? BLANKS[Math.floor(rng() * BLANKS.length)]
      : ["", " ", "\t", "\n"][Math.floor(rng() * 4)];
    const r = schema.safeParse(input);
    // 只对"确实是空白"的输入要求拒绝
    if (input.trim().length === 0 || /^[\s\0﻿᠎　]*$/.test(input)) {
      if (r.ok) bypass.push(JSON.stringify(input));
    }
  }
  assert.equal(bypass.length, 0, `${bypass.length} 条纯空白绕过了 min(1):${JSON.stringify(bypass.slice(0, 8))}`);
});

test("模糊:非对象输入喂给 object schema 必须被拒,不得静默变 undefined", () => {
  const rng = makeRng(31337);
  const schema = s.object({ name: s.string().min(1, "必填") });
  const bad = [null, undefined, 0, 1, -1, "", "abc", true, false, [], [1, 2], NaN, Infinity, 0n];
  for (const b of bad) {
    assert.equal(schema.safeParse(b).ok, false, `非对象输入被接受:${String(b)}`);
  }
  // 随机畸形
  for (let i = 0; i < 500; i++) {
    const v = [
      [rng() > 0.5 ? "x" : "", 1, -1][Math.floor(rng() * 3)],
      [],
      {},
      [[1, 2, 3]],
    ][i % 4];
    const r = schema.safeParse(v);
    if (r.ok) {
      // 只有"恰好是 {name: 非空字符串}"才算合法通过
      assert.equal(typeof v, "object");
      assert.equal(Array.isArray(v), false);
      assert.equal(typeof v.name, "string");
      assert.ok(v.name.trim().length > 0);
    }
  }
});

test("模糊:深层嵌套不得让校验层抛异常(栈溢出是经典崩法)", () => {
  const schema = s.object({ a: s.object({ b: s.string().optional() }) });
  for (const depth of [10, 100, 500, 1000]) {
    const deep = "[".repeat(depth) + "1" + "]".repeat(depth);
    let threw = null;
    try {
      schema.safeParse(deep);
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, null, `深度 ${depth} 让校验层抛了异常:${threw?.message}`);
  }
});

test("模糊:number 边界与特殊值必须被拒或被正确接受,不得 NaN 逃逸", () => {
  const schema = s.number().int().min(1).max(10);
  for (const v of [NaN, Infinity, -Infinity, "abc", "", null, undefined, {}, [], 0, 11, -1, 1.5]) {
    const r = schema.safeParse(v);
    if (r.ok) {
      assert.equal(typeof v, "number");
      assert.ok(Number.isInteger(v), `非整数被接受:${v}`);
      assert.ok(v >= 1 && v <= 10, `越界值被接受:${v}`);
    }
  }
  // 合法值必须能过
  for (const v of [1, 5, 10]) {
    assert.equal(schema.safeParse(v).ok, true, `合法值被拒:${v}`);
  }
});

test("模糊:array schema 面对非数组与畸形元素不得抛异常", () => {
  const schema = s.array(s.string().min(1)).max(3);
  const bad = [null, undefined, 0, "", "abc", {}, true, [null], [[]], [""], ["a", 1], [{}]];
  for (const b of bad) {
    let threw = null;
    try {
      schema.safeParse(b);
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, null, `畸形数组输入让校验层抛了异常:${String(b)}`);
  }
});

test("模糊:enum 面对大小写/空白/超长/特殊字符不得放行非法值", () => {
  const schema = s.enum(["alpha", "beta"]);
  // ⚠️ `" alpha"` / `"alpha "` 是**故意**被接受的:R45(ISSUE-045)把校验改成
  //   **先 trim 再判**,就是为了让纯空白也能被 min(1) 拦下。
  //   我第一版把这两个写进"非法"列表,测试红了 —— 查证后确认是**设计**,不是缺陷。
  const bad = ["ALPHA", "Alpha", "", " ", "gamma", "alph", "alphaa", null, 1, {}, []];
  for (const b of bad) {
    assert.equal(schema.safeParse(b).ok, false, `非法枚举值被放行:${JSON.stringify(b)}`);
  }
  assert.equal(schema.safeParse("alpha").ok, true);
  assert.equal(schema.safeParse("beta").ok, true);
  // 锁定 trim 语义(ISSUE-045):首尾空白应被剥掉后接受
  for (const v of [" alpha", "alpha ", "  alpha  ", "\talpha\n"]) {
    assert.equal(schema.safeParse(v).ok, true, `trim 后应被接受:${JSON.stringify(v)}`);
  }
});

test("模糊:随机字节串不得让任何常用 schema 抛异常", () => {
  const rng = makeRng(0xf00d);
  const schemas = [
    s.string(), s.string().min(1), s.string().max(10),
    s.number(), s.number().int().min(0).max(5),
    s.array(s.string()), s.enum(["a", "b", "c"]),
    s.object({ k: s.string().optional() }),
  ];
  for (let i = 0; i < 3000; i++) {
    const n = Math.floor(rng() * 30);
    let junk = "";
    for (let k = 0; k < n; k++) junk += String.fromCharCode(Math.floor(rng() * 0x2000));
    for (const sc of schemas) {
      let threw = null;
      try {
        sc.safeParse(junk);
      } catch (e) {
        threw = e;
      }
      assert.equal(threw, null, `随机输入让 schema 抛异常:${threw?.message}\n输入=${JSON.stringify(junk.slice(0, 60))}`);
    }
  }
});
