#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
变异测试(goal 里明确要求、此前从未做过的一类扩展测试)。

## 为什么做这个
此前我做的"反向验证"都是**针对单个新守卫**(改坏一处 → 必须变红)。
但那只证明了"我新写的那条断言会红"。它**没有回答**:
> 整个测试套件,到底能抓住多少种**意外破坏**?

变异测试往核心逻辑里注入微小的语义错误(边界、比较符、返回值),
然后看现有测试会不会失败:
- **变异被杀死(killed)** = 测��套件能抓到这个破坏 ✅
- **变异存活(survived)** = **测试盲区** ⚠️ —— 代码改了但测试照样绿

存活变异不是"代码有 bug",而是"**测试不够**"。后者更危险,因为它会一直绿下去。

## 安全约束(必须)
1. 每个变异**独立**:备份 → 改一处 → 跑指定测试 → **无条件还原** → 校验还原成功
2. 还原用 `try/finally`;还原后再比一次字节,不一致立刻中止后续变异
3. 绝不在生产数据上跑;测试命令只跑单测

用法:python3 scripts/mutation-test.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (编号, 文件, 原片段, 变异片段, 测试命令, 变异说明)
MUTATIONS = [
    # ---------- server/validate.js:自研 schema 层(零依赖,全站输入校验的地基)----------
    ("V01", "server/validate.js",
     "if (this._hasDefault) return { ok: true, value: this._default };",
     "if (false) return { ok: true, value: this._default };",
     ["npm", "--prefix", "server", "test", "--", "test/validate.test.js"],
     "default() 失效:必填字段的默认值不再兜底"),

    ("V02", "server/validate.js",
     "constructor(shape) { super(); this._shape = shape; this._stripUnknown = true; }",
     "constructor(shape) { super(); this._shape = shape; this._stripUnknown = false; }",
     ["npm", "--prefix", "server", "test", "--", "test/validate.test.js", "test/validate-partial.test.js"],
     "s.object 不再剥离未知字段(ISSUE-064 那一类静默剥字段的镜像)"),

    # ---------- web/src/lib/evaluation/scoringEngine.ts:评分聚合与解析 ----------
    ("V03", "web/src/lib/evaluation/scoringEngine.ts",
     "const overall = Math.round(avg5 * 2 * 10) / 10;",
     "const overall = Math.floor(avg5 * 2 * 10) / 10;",
     ["npm", "--prefix", "web", "run", "test", "--", "aggregate"],
     "总分的取整从 round 变 floor(1-10 制的边界档位)"),

    ("V04", "web/src/lib/evaluation/scoringEngine.ts",
     "        score: 0,",
     "        score: 1,",
     ["npm", "--prefix", "web", "run", "test", "--", "aggregate"],
     "缺失维度的 fail-closed 0 分变成 1 分(等于 E 锚点)"),

    ("V05", "web/src/lib/evaluation/scoringEngine.ts",
     'const anchor = fragment.match(/"matched_anchor_id"\\s*:\\s*"([A-E])/);',
     'const anchor = fragment.match(/"matched_anchor_id"\\s*:\\s*"([A-E])/) || fragment.match(/"reasoning"/);',
     ["npm", "--prefix", "web", "run", "test", "--", "scoringEngine"],
     "R40 截断抢救:拿到 reasoning 也当成拿到 anchor —— 【等价变异,杀不死是正常的】"
     " 变异后 anchor[1] 是 undefined,parseDimensionScore 里 typeof rawId !== 'string' 仍返回 null,"
     " 行为完全不变。**它活着不代表测试有盲区。**"),

    ("V06", "web/src/lib/evaluation/scoringEngine.ts",
     "  if (!anchor) return null;",
     "  if (!anchor) return { matched_anchor_id: 'C' };",
     ["npm", "--prefix", "web", "run", "test", "--", "scoringEngine"],
     "截断抢救失败时**猜一个 C 档**而不是返回 null(绝不该发生的兜底)"),

    # ---------- server/services/questionBank.js:ISSUE-038 接线 ----------
    # R44 首跑时 V07 写的是"去掉 keyPoints.length === 0 的长度检查" ——
    # 那样杀不死,因为题库 808 题没有空 keyPoints,分支根本走不到。
    # 已把实现改成**先清洗再判空**,于是变异点也换成"去掉清洗后的空判"。
    ("V07", "server/services/questionBank.js",
     "  if (kp.length === 0) return null;",
     "  if (false) return null;",
     # ⚠️ 必须跑**能发现该变异**的测试集合。
     #    第一版这里写的是 `npm run check:corpus`,只跑语料校验、**不跑 `npm test`**,
     #    于是 R46 补的元测试(question-bank-injection.test.js)根本没被执行,
     #    变异照样存活 —— **与 mutation-test-gates.py 里犯过的错完全相同,第二次**。
     ["npm", "--prefix", "server", "test"],
     "去掉清洗后的 keyPoints 空判(R46 已用可注入题库 + 元测试覆盖)"),

    # ---------- server/db.js:ISSUE-065 事务 ----------
    # ---------- 安全关键路径(R47)----------
    # 这些代码"坏了不一定变红":safeEqual 换成普通比较,功能测试照样全过,
    # 但**时序侧信道防护没了**;元数据地址放行,SSRF 功能测试也未必察觉。
    ("V09", "server/auth.js",
     "    crypto.timingSafeEqual(ba, ba);\n    return false;",
     "    return false;",
     ["npm", "--prefix", "server", "test"],
     "safeEqual 删掉'长度不一致也要自比较一次'的时序防护(v10.2.5 P2-2)"),

    ("V10", "server/auth.js",
     "  return crypto.timingSafeEqual(ba, bb);",
     "  return ba.toString() === bb.toString();",
     ["npm", "--prefix", "server", "test"],
     "safeEqual 从常量时间比较退化成普通 === (时序侧信道)"),

    ("V11", "server/ssrf-shared.js",
     "/^169\\.254\\./,",
     "/^169\\.255\\./,",
     ["npm", "--prefix", "server", "test"],
     "SSRF 链路本地段被改窄 ⇒ 169.254.169.254 云元数据地址不再被拦",
     2),
    # ⚠️ R57:锚点必须对**无关改动**免疫。主会话 22:29 改过 ssrf-shared.js
    #   (逻辑未变,只是注释),而我原来的锚点带着行尾注释 ⇒ **静默失配**,
    #   覆盖悄悄少一条而门禁只报"跳过"。这里改用裸锚 + occurrence 指定第 2 处。
("V08", "server/db.js",
     "  const tx = db.transaction(() => {",
     "  const tx = (() => {",
     ["npm", "--prefix", "server", "test", "--", "test/agent-update-transaction.test.js"],
     "让 updateAgentWithVersion 失去事务包裹(ISSUE-065 的回归防护)",
     5),   # 全局第 5 处 = updateAgentWithVersion 内那个(用脚本实测得到,不猜)
]


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as f:
        f.write(s)


def main():
    killed, survived, invalid = [], [], []
    backups = {}

    for mut in MUTATIONS:
        mid, relpath, old, new, cmd, desc = mut[:6]
        occ = mut[6] if len(mut) > 6 else None   # 可选:第 N 次出现(1-based)
        abspath = os.path.join(ROOT, relpath)
        if not os.path.exists(abspath):
            print(f"  ⚠️ {mid} 跳过:文件不存在 {relpath}")
            continue
        orig = read(abspath)
        backups[mid] = orig
        if old not in orig:
            print(f"  ⚠️ {mid} 跳过:原文片段找不到(代码已变?)({desc})")
            invalid.append((mid, desc, "片段未找到"))
            continue
        # 片段出现多次时,除非显式指定"第 N 次",否则判定为不唯一并跳过。
        # ⚠️ R57:以前这里只有"唯一/不唯一"两个选项,于是像 `169\.254`
        # (IPv4 规则 2 处)、`db.transaction`(11 处)这类**本就该有多处**的锚点
        # 一旦遇到,就只能整条跳过 —— 覆盖静默丢失,门禁只报"跳过"不报警。
        # ⇒ 允许元组带第 6 个元素 occurrence(N),明确"我要第 N 处那个"。
        cnt = orig.count(old)
        if cnt == 0:
            pass  # 上面已判过"片段未找到"
        elif cnt > 1 and occ is None:
            print(f"  ⚠️ {mid} 跳过:片段出现 {cnt} 次,不唯一(可用第 6 元素指定第几处)")
            invalid.append((mid, desc, "片段不唯一"))
            continue

        try:
            if occ is None:
                mutated = orig.replace(old, new, 1)
            else:
                # 定位第 occ 次出现并只替换那一次
                idx = -1
                for _ in range(occ):
                    idx = orig.find(old, idx + 1)
                    if idx < 0:
                        break
                mutated = orig[:idx] + new + orig[idx + len(old):]
            write(abspath, mutated)
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=900)
            failed = r.returncode != 0
        except subprocess.TimeoutExpired:
            failed = None  # 超时:视作"没抓到"但单列
        finally:
            # ⛔ 无条件还原
            write(abspath, orig)
            if read(abspath) != orig:
                print(f"\n⛔ {mid} 还原失败!文件:{relpath}")
                print("   已中止,不再执行后续变异。请手动检查该文件。")
                return 2

        tag = "KILLED ✅" if failed is True else ("SURVIVED ⚠️" if failed is False else "TIMEOUT ⚠️")
        if failed is True:
            killed.append((mid, desc))
        else:
            survived.append((mid, desc))
        print(f"  {mid} {tag:14} {desc}")

    print("\n" + "=" * 72)
    print(f"变异测试:杀死 {len(killed)} / 存活 {len(survived)} / 跳过 {len(invalid)}(共 {len(MUTATIONS)})")
    rate = len(killed) / max(1, len(killed) + len(survived)) * 100
    print(f"变异得分(mutation score)={rate:.0f}%")
    if survived:
        print("\n存活变异 = **测试盲区**(代码改了但测试照样绿):")
        for mid, desc in survived:
            print(f"  ⚠️ {mid}  {desc}")
    if invalid:
        print("\n跳过(需要人工确认):")
        for mid, desc, why in invalid:
            print(f"  ? {mid}  {desc}  —— {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
