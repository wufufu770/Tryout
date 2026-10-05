import json, math

S = {'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1}
load = lambda p: {(r['caseId'], r['level']): r for r in map(json.loads, open(p))}
A = load('qa/logs/evidence/r33-A-no-inject.jsonl')      # 不注入
B = load('qa/logs/evidence/r33-B-bank-reference.jsonl')        # 注入题库参考答案(R32 生产语义)
C = [json.loads(l) for l in open('qa/logs/evidence/r33-C-human-rubric.jsonl')]  # 注入人工档位标准

n = len(C)
Cmap = {(r['caseId'], r['level']): r for r in C}   # 与 A/B 同构,便于统一取值
keys = [(r['caseId'], r['level']) for r in C]
hit = lambda D: sum(1 for k in keys if D[k]['actualLetter'] == Cmap[k]['expectedLetter'])
mean = lambda D: sum(S[D[k]['actualLetter']] for k in keys) / n
exp = sum(S[r['expectedLetter']] for r in C) / n
bk = [k for k in keys if k in B]
mb = sum(S[B[k]['actualLetter']] for k in bk) / len(bk)
hb = sum(1 for k in bk if B[k]['actualLetter'] == next(r['expectedLetter'] for r in C if (r['caseId'], r['level']) == k)) / len(bk)

imp = sum(1 for r in C if S[r['actualLetter']] > S[A[(r['caseId'], r['level'])]['actualLetter']])
wor = sum(1 for r in C if S[r['actualLetter']] < S[A[(r['caseId'], r['level'])]['actualLetter']])
m, k = imp + wor, imp
p = sum(math.comb(m, i) for i in range(k, m + 1)) / 2**m if m else 1.0

print(f'配对 {n} 样本（technical×2 + design×1）\n')
print(f'{"条件":22} {"命中":>10} {"均分":>7} {"偏移":>7}')
print(f'{"期望(标注)":20} {"—":>10} {exp:>7.2f} {"—":>7}')
print(f'{"A 不注入":20} {hit(A):>6}/{n} ({hit(A)/n*100:.0f}%) {mean(A):>7.2f} {mean(A)-exp:>+7.2f}')
print(f'{"B 注入题库参考答案":18} {hb*len(bk):>5.0f}/{len(bk)} ({hb*100:.0f}%) {mb:>7.2f} {mb-exp:>+7.2f}')
print(f'{"C 注入人工档位标准":18} {hit(Cmap):>4}/{n} ({hit(Cmap)/n*100:.0f}%) {mean(Cmap):>7.2f} {mean(Cmap)-exp:>+7.2f}')
print(f'\n逐样本 C vs A: 改善 {imp} / 变差 {wor} / 不变 {n-imp-wor}')
print(f'二项检验 P(X>={k} | n={m}, p=0.5) = {p:.4f}')
print('\n高分档(期望 A)在三种条件下的判定:')
for r in C:
    if r['expectedLetter'] == 'A':
        kk = (r['caseId'], r['level'])
        print(f"  {r['caseId']:14} 无注入={A[kk]['actualLetter']}  参考答案={B.get(kk, {}).get('actualLetter','-')}  档位标准={r['actualLetter']}")
