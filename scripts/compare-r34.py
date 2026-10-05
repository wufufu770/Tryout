import json
from math import comb

S = {'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1}
load = lambda p: {(r['caseId'], r['level']): r for r in map(json.loads, open(p))}

A = load('qa/logs/evidence/r33-A-no-inject.jsonl')      # 不注入
B = load('qa/logs/evidence/r33-B-bank-reference.jsonl')        # 注入题库参考答案
C = load('qa/logs/evidence/r33-C-human-rubric.jsonl')        # 注入**人工**档位标准
D = load('qa/logs/evidence/r34-D-gen-rubric.jsonl')           # R34:LLM 生成(各档独立)
E = load('qa/logs/evidence/r35-C-human-rubric-30.jsonl')           # R35:LLM 生成(递进)

ks = list(D)
n = len(ks)
exp = sum(S[D[k]['expectedLetter']] for k in ks) / n
# ⚠️ B 轮(参考答案)主动停在 21 样本 —— 必须按**各自可用**的 key 算,
#    否则会拿 21 个样本的均分和 30 个样本的期望去比,凭空造出一个偏差。
def stats(D_):
    """按**各自可用**的 key 计算 —— B 轮只有 21 样本,
    拿 21 个的均分去比 30 个样本的期望会凭空造出一个偏差。"""
    kk = [k for k in ks if k in D_]
    h = sum(1 for k in kk if D_[k]['actualLetter'] == D[k]['expectedLetter'])
    m = sum(S[D_[k]['actualLetter']] for k in kk) / len(kk)
    e = sum(S[D[k]['expectedLetter']] for k in kk) / len(kk)
    return h, m, len(kk), e

print(f'配对 {n} 样本(technical×2 + design×2 + coding×2)\n')
print(f'{"条件":24}{"命中":>12}{"均分":>8}{"偏移":>8}{"样本":>6}')
for nm, D_ in (('A 不注入', A), ('B 注入题库参考答案', B), ('C 注入人工档位', C), ('D 生成·独立(R34)', D), ('E 生成·递进(R35)', E)):
    h, m, cnt, e = stats(D_)
    note = f' ({cnt})' if cnt != n else '     '
    print(f'{nm:22}{h:>5}/{cnt} ({h/cnt*100:>2.0f}%){m:>8.2f}{m-e:>+8.2f}{note}')

print('\n配对命中 McNemar(vs 不注入):')
for nm, D_ in (('B 参考答案', B), ('C 人工档位', C), ('D 生成·独立', D), ('E 生成·递进', E)):
    kk = [k for k in ks if k in D_]
    only_x = sum(1 for k in kk if D_[k]['actualLetter'] == D[k]['expectedLetter'] and A[k]['actualLetter'] != D[k]['expectedLetter'])
    only_a = sum(1 for k in kk if A[k]['actualLetter'] == D[k]['expectedLetter'] and D_[k]['actualLetter'] != D[k]['expectedLetter'])
    m = only_x + only_a
    p = sum(comb(m, i) for i in range(only_x, m + 1)) / 2**m if m else 1.0
    print(f'  {nm:12} 仅该条件命中 {only_x:>2} / 仅不注入命中 {only_a:>2}   P={p:.5f}')

print('\n人工(C) vs 生成(D) 之间:')
oc = sum(1 for k in ks if C[k]['actualLetter'] == D[k]['expectedLetter'] and D[k]['actualLetter'] != D[k]['expectedLetter'])
od = sum(1 for k in ks if D[k]['actualLetter'] == D[k]['expectedLetter'] and C[k]['actualLetter'] != D[k]['expectedLetter'])
m = oc + od
p = sum(comb(m, i) for i in range(oc, m + 1)) / 2**m if m else 1.0
print(f'  仅人工命中 {oc} / 仅生成命中 {od}   P={p:.5f}')

print('\n高分档(期望 A)判定:')
for k in ks:
    if D[k]['expectedLetter'] == 'A':
        print(f"  {k[0]:14} 无注入={A[k]['actualLetter']}  参考答案={B.get(k,{}).get('actualLetter','-')}  人工={C[k]['actualLetter']}  生成={D[k]['actualLetter']}")

print('\n分题型命中率(不注入 → 人工 → 生成):')
import collections
byt = collections.defaultdict(lambda: [0, 0, 0])
for k in ks:
    t = D[k]['caseId'].split('-')[1]
    byt[t][0] += 1
    if A[k]['actualLetter'] == D[k]['expectedLetter']: byt[t][1] += 1
    if D[k]['actualLetter'] == D[k]['expectedLetter']: byt[t][2] += 1
for t, (c, ha, hd) in sorted(byt.items()):
    print(f'  {t:10} {ha}/{c}  →  {hd}/{c}')
