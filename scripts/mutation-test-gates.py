#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
R45:对**门禁脚本本身**做变异测试。

## 为什么做这个(比 R44 更要紧)
R44 量化的是"业务代码的测试够不够"。但门禁里有一类特殊的代码 ——
**闸门脚本**(`check-silent-catch` / `check-eval-corpus` / `deps-check` /
i18n 三闸门 / 若干 e2e)。它们**决定整条门禁红还是绿**。

查证结果(R45):
    grep -rln "check-silent-catch|check-eval-corpus|deps-check|validate-i18n|..." \
        server/test/ web/src/     ⇒  **零命中**
    ⇒ **这些脚本没有任何自动化测试**,正确性只靠"我写的时候小心"。

一个闸门脚本写错了判据,它会**一直绿**,而门禁的其他几十项全绿时没人会去怀疑它。

## 本脚本的做法
对每个闸门脚本注入一个微小的语义变异,然后**跑整条相关测试**(单测 + 该闸门自身),
看**有没有任何东西**因此变红。

- 全绿 ⇒ 该脚本的判据**完全没有自动化保障**(比"有个测试但抓不到"更糟)
- 变红 ⇒ 存在某种测试间接覆盖了它

## 安全约束
与 mutation-test.py 相同:每变异独立,`try/finally` 无条件还原 + 字节校验。
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (编号, 文件, 原片段, 变异片段, 变异后要跑的东西, 说明)
GATE_MUTATIONS = [
    ("G01", "web/scripts/check-silent-catch.mjs",
     "    if (!code) {", "    if (false) {",
     ["npm", "--prefix", "web", "run", "test"],
     "把「完全空的 catch」判据放宽成「永不判空」⇒ 空的 catch 会漏过闸门"),

    ("G02", "server/scripts/check-eval-corpus.mjs",
     "if (rk !== \"ABCDE\") err(`rubric 档位不是恰好 A~E(实得:${rk})`);",
     "if (false) err(`rubric 档位不是恰好 A~E(实得:${rk})`);",
     # ⚠️ 必须跑**能发现该变异**的测试集合,而不是被变异的东西本身。
     #    第一版这里写的是 `npm run check:corpus`(只跑闸门自身)——
     #    结果变异当然活下来,于是我据此写下"没有自动化保障"这个**错误结论**。
     #    R45 补的元测试在 `npm test` 里,必须跑到那里才算数。
     ["npm", "--prefix", "server", "test"],
     "【等价变异:闸门有冗余检查】语料校验:不再检查 rubric 是否恰好 A~E 五档 —— "
     "但第 95 行还有逐档的 `rubric.${L} 缺失或过短`,破坏 92 行不改变行为,杀不死是正常的"),

    ("G03", "server/scripts/check-eval-corpus.mjs",
     "if (a.level !== a.expectedLetter) {",
     "if (false) {",
     ["npm", "--prefix", "server", "test"],
     "语料校验:不再检查 level 与 expectedLetter 是否一致"),

    ("G04", "server/scripts/deps-check.mjs",
     "process.exit(1)", "process.exit(0)",
     ["npm", "--prefix", "server", "test"],
     "依赖门禁:发现缺依赖时改为**通过**(即闸门失效)"),

    ("G05", "web/scripts/validate-i18n.mjs",
     "process.exit(bad > 0 ? 1 : 0);", "process.exit(0);",
     ["npm", "--prefix", "web", "run", "test"],
     "i18n 译文质量闸门:失败时改为通过(闸门失效)"),
]


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def main():
    killed, survived, invalid = [], [], []

    for mid, relpath, old, new, cmd, desc in GATE_MUTATIONS:
        abspath = os.path.join(ROOT, relpath)
        if not os.path.exists(abspath):
            print(f"  ⚠️ {mid} 跳过:文件不存在 {relpath}")
            invalid.append((mid, desc, "文件不存在"))
            continue
        orig = read(abspath)
        if old not in orig:
            print(f"  ⚠️ {mid} 跳过:片段未找到(代码可能已变) — {desc}")
            invalid.append((mid, desc, "片段未找到"))
            continue
        n = orig.count(old)
        if n > 1:
            print(f"  ⚠️ {mid} 跳过:片段出现 {n} 次,需人工指定")
            invalid.append((mid, desc, f"片段不唯一({n}次)"))
            continue

        try:
            write(abspath, orig.replace(old, new, 1))
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=600)
            failed = r.returncode != 0
        except subprocess.TimeoutExpired:
            failed = None
        finally:
            write(abspath, orig)
            if read(abspath) != orig:
                print(f"\n⛔ {mid} 还原失败:{relpath} —— 已中止")
                return 2

        if failed is True:
            killed.append((mid, desc))
            print(f"  {mid} KILLED ✅    {desc}")
        else:
            survived.append((mid, desc))
            print(f"  {mid} SURVIVED ⚠️ {desc}")

    print("\n" + "=" * 74)
    print(f"门禁脚本变异:杀死 {len(killed)} / 存活 {len(survived)} / 跳过 {len(invalid)}"
          f"(共 {len(GATE_MUTATIONS)})")
    if survived:
        print("\n⚠️ 存活 = **该闸门脚本的判据没有任何自动化保障**")
        print("   ⚠️ 但**存活 ≠ 一定是盲区**,必须逐个查证。三种可能:")
        print("      (a) 等价变异(行为不变)  (b) 冗余检查(多处查同一件事)  (c) 真盲区")
        print("   下面每一条都已在描述里注明属于哪一类:")
        for mid, desc in survived:
            print(f"  ⚠️ {mid}  {desc}")
        print("\n   影响面:这些脚本一旦判据失效,门禁会持续显示绿色,")
        print("   而被它们守护的缺陷(静默 catch / 语料错配 / 缺依赖 / 译文质量)")
        print("   可以随时回来而无人察觉。")
    if killed:
        print("\n被变异测试抓到(说明存在某种间接覆盖):")
        for mid, desc in killed:
            print(f"  ✅ {mid}  {desc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
