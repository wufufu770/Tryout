#!/usr/bin/env bash
# Tryout 门禁脚本
#
# 用法:
#   ./build.sh all      # 全量门禁(默认)
#   ./build.sh static   # 静态检查:语法 + 类型
#   ./build.sh unit     # 单元测试
#   ./build.sh e2e      # 端到端测试
#   ./build.sh build    # 前端构建
#   ./build.sh docker   # 镜像构建(需要 Docker)
#   ./build.sh install  # 安装依赖
#
# 退出码:0 = 全绿,1 = 有失败
#
# 设计原则:
#   1. 各子项独立执行并计数,最后统一汇总 —— 一眼看出是哪层红了
#   2. 不使用 CI 专有语法,本地与 CI 跑同一套
#   3. 环境缺失(如无 Docker)记为 SKIP 而非 FAIL,不阻塞其他门禁

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

if [ -t 1 ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'; DIM=$'\033[2m'; RST=$'\033[0m'
else
  RED=""; GRN=""; YLW=""; BLU=""; DIM=""; RST=""
fi

declare -a RESULTS=()

section() { printf '\n%s▶ %s%s\n' "$BLU" "$1" "$RST"; }
pass()    { printf '  %s✓ %s%s\n' "$GRN" "$1" "$RST"; }
fail()    { printf '  %s✗ %s%s\n' "$RED" "$1" "$RST"; }
skip()    { printf '  %s— %s(跳过: %s)%s\n' "$DIM" "$1" "$2" "$RST"; }
record()  { RESULTS+=("$1"); }
have()    { command -v "$1" >/dev/null 2>&1; }

summary() {
  printf '\n%s────────────────────────────────────────────────────%s\n' "$DIM" "$RST"
  local f=0 p=0 s=0
  for r in "${RESULTS[@]}"; do
    case "$r" in
      PASS:*) p=$((p+1)); printf '  %s✓%s %s\n' "$GRN" "$RST" "${r#PASS:}" ;;
      FAIL:*) f=$((f+1)); printf '  %s✗%s %s\n' "$RED" "$RST" "${r#FAIL:}" ;;
      SKIP:*) s=$((s+1)); printf '  %s—%s %s\n' "$DIM" "$RST" "${r#SKIP:}" ;;
    esac
  done
  printf '\n  通过 %s%d%s · 失败 %s%d%s · 跳过 %s%d%s\n' \
    "$GRN" "$p" "$RST" "$RED" "$f" "$RST" "$YLW" "$s" "$RST"
  if [ "$f" -gt 0 ]; then printf '\n%s门禁未通过%s\n' "$RED" "$RST"; return 1; fi
  printf '\n%s门禁全绿%s\n' "$GRN" "$RST"; return 0
}

# ── 资源回收(R50)──────────────────────────────────────────────
# 为什么要有:每轮 `do_docker` 都会产生 1~2GB 构建缓存,而**从来没有回收过**。
# 实测 R31~R49 十九轮累积到 10.85GB,磁盘一度只剩 **21MB**,
# 直接把镜像构建挤失败(R49 门禁唯一的红项就是它,而根因不是代码)。
#
# 只清**构建缓存**:不影响任何运行中的容器、镜像与卷。
# ⛔ 失败时**不清** —— 现场(/tmp/tryout-docker.log)是排查的唯一线索。
# ⛔ 只在 `all` 末尾执行,单独跑 `./build.sh docker` 不清(那是手动排查场景)。
do_reclaim() {
  section "资源回收"
  if ! have docker; then skip "构建缓存回收" "未安装 docker"; record "SKIP:回收"; return 0; fi
  # 先看有没有失败:有失败就保留现场
  local f=0
  for r in "${RESULTS[@]}"; do
    case "$r" in FAIL:*) f=$((f+1)) ;; esac
  done
  if [ "$f" -gt 0 ]; then
    skip "构建缓存回收" "本轮有 ${f} 项失败,保留 docker 构建日志与缓存现场"
    record "SKIP:回收"
    return 0
  fi
  local before; before=$(docker system df --format '{{.Reclaimable}}' 2>/dev/null | head -1)
  if docker builder prune -f >/tmp/tryout-reclaim.log 2>&1; then
    pass "构建缓存已回收"; record "PASS:回收"
  else
    skip "构建缓存回收" "prune 失败(详见 /tmp/tryout-reclaim.log)"; record "SKIP:回收"
  fi
  df -h / | awk 'NR==2{print "    磁盘剩余:" $4 " (" $5 ")"}'
}

do_install() {
  section "安装依赖"
  # ⚠️ R30(ISSUE-061):原先是 `if [ -d server/node_modules ] && [ -d web/node_modules ]`
  #   → **只看目录在不在**,就报"依赖已就绪(跳过)"并 pass。
  #   目录存在但依赖损坏(缺包、版本不对、原生模块没 rebuild)照样放行,
  #   后面要么一串莫名失败,要么更糟:静默用着旧依赖跑出"通过"。
  #   本项目正好吃过这个亏:R1 发现 better-sqlite3 11.10.0 在 Node 24 上约 50% 原生崩溃,
  #   必须升到 12.11.1 并 npm rebuild —— 而 `node_modules` 目录**一直是存在的**,
  #   旧的门禁对这种情况完全无感。
  if [ -d server/node_modules ] && [ -d web/node_modules ]; then
    # 目录在,再验一次"关键依赖真的能加载"——尤其原生模块
    if (cd server && npm run --silent deps:check >/dev/null 2>&1); then
      pass "依赖已就绪(目录存在且关键依赖可加载,跳过安装)"; record "PASS:依赖检查"; return 0
    fi
    fail "node_modules 存在但关键依赖无法加载(better-sqlite3 / express)——请 npm install && npm rebuild"
    record "FAIL:依赖检查(依赖不可加载)"; return 1
  fi
  have npm || { fail "找不到 npm"; record "FAIL:安装依赖"; return 1; }
  printf '  %s→%s server ...\n' "$DIM" "$RST"
  (cd server && npm ci --no-audit --no-fund >/dev/null 2>&1) \
    || (cd server && npm install --no-audit --no-fund >/dev/null 2>&1) \
    || { fail "server 依赖安装失败"; record "FAIL:安装依赖"; return 1; }
  pass "server 依赖安装完成"
  printf '  %s→%s web ...\n' "$DIM" "$RST"
  (cd web && npm install --no-audit --no-fund >/dev/null 2>&1) \
    || { fail "web 依赖安装失败"; record "FAIL:安装依赖"; return 1; }
  pass "web 依赖安装完成"
  record "PASS:安装依赖"
}

do_static() {
  section "静态检查"
  have node || { fail "找不到 node"; record "FAIL:静态检查"; return 1; }

  local syntax_ok=1
  for f in index.js db.js llm.js auth.js crypto.js validate.js response.js logger.js \
           pii.js seed.js ssrf-shared.js routes/analysis.js services/whisper.js services/pdf.js; do
    [ -f "server/$f" ] || { fail "文件缺失: server/$f"; syntax_ok=0; continue; }
    node --check "server/$f" 2>/dev/null || { fail "语法错误: server/$f"; syntax_ok=0; }
  done
  if [ $syntax_ok -eq 1 ]; then pass "后端语法检查(14 个文件)"; record "PASS:后端语法"; else record "FAIL:后端语法"; fi

  # 门禁脚本自身的变异测试(2026-10-05 新增,R45)
  # 为什么单独一层:上面那层测的是"业务代码的测试够不够";
  # 这一层测的是**闸门脚本自己的判据**是否有效 —— 它们决定整条门禁红还是绿。
  # R45 实测:所有闸门脚本原本**零自动化测试**,判据坏掉没有任何东西会红。
  # 补了 3 个元测试(deps-check / check-eval-corpus / check-silent-catch)后,
  # G01/G03/G04 从"存活"变成"被杀"。
  if [ -f scripts/mutation-test-gates.py ] && command -v python3 >/dev/null 2>&1; then
    if python3 scripts/mutation-test-gates.py >/tmp/tryout-mutation-gates.log 2>&1; then
      pass "门禁脚本变异测试"; record "PASS:变异测试(门禁)"
    else
      fail "门禁脚本变异测试(详见 /tmp/tryout-mutation-gates.log)"; record "FAIL:变异测试(门禁)"
    fi
  else
    skip "门禁脚本变异测试" "脚本或 python3 缺失"; record "SKIP:变异测试(门禁)"
  fi

  # 变异测试(2026-10-05 新增,R44)
  # 为什么必须有:覆盖率只说明"这行代码被执行过",不说明"测试能抓住破坏它"。
  # 变异测试往核心逻辑注入微小的语义错误(边界/比较符/兜底值),看测试会不会红。
  # 存活变异 = **测试盲区**:代码改了测试照样绿,会一直绿到出事。
  # R44 首跑 62%(8 个变异只杀掉 5 个),补断言 + 改实现后 86%,
  # 剩余存活项经查证是**等价变异**(行为不变),不算盲区。
  if [ -f scripts/mutation-test.py ] && command -v python3 >/dev/null 2>&1; then
    if python3 scripts/mutation-test.py >/tmp/tryout-mutation.log 2>&1; then
      pass "变异测试"; record "PASS:变异测试"
    else
      fail "变异测试(详见 /tmp/tryout-mutation.log)"; record "FAIL:变异测试"
    fi
  else
    skip "变异测试" "脚本或 python3 缺失"; record "SKIP:变异测试"
  fi

  # 评测语料结构校验(2026-10-05 新增)
  # 人工标注的 ground truth 一旦档位错配/答案缺失/题库对不上,
  # 评测会照常跑完并打印一张漂亮的准确性表格 —— 只是把错的东西当基准。
  # R17/R18 的结论都建立在这份语料上,标注错了结论就作废。
  if [ -f server/scripts/check-eval-corpus.mjs ] && [ -f server/data/questionbank.json ]; then
    if (cd server && node scripts/check-eval-corpus.mjs >/tmp/tryout-eval-corpus.log 2>&1); then
      pass "评测语料结构"; record "PASS:评测语料"
    else
      fail "评测语料结构(详见 /tmp/tryout-eval-corpus.log)"; record "FAIL:评测语料"
    fi
  else
    skip "评测语料结构" "题库或校验脚本缺失"; record "SKIP:评测语料"
  fi

  if [ -d web/node_modules ]; then
    if (cd web && npx tsc --noEmit >/tmp/tryout-tsc.log 2>&1); then
      pass "TypeScript 类型检查"; record "PASS:TypeScript"
    else
      fail "TypeScript 类型检查(详见 /tmp/tryout-tsc.log)"; record "FAIL:TypeScript"
    fi
  else
    skip "TypeScript 类型检查" "web 依赖未安装"; record "SKIP:TypeScript"
  fi

  # i18n key 一致性(2026-10-04 新增)
  # 采用「已知缺口基线 + 新增漂移即失败」:8 种语言的 52 条历史缺口记在
  # web/scripts/i18n-known-gaps.json,不阻塞构建;但任何**新增**未翻译 key
  # 会让这里变红,防止内容债继续扩大。
  if [ -f web/scripts/check-i18n.mjs ]; then
    if (cd web && node scripts/check-i18n.mjs >/tmp/tryout-i18n.log 2>&1); then
      pass "i18n key 一致性"; record "PASS:i18n"
    else
      fail "i18n key 一致性(详见 /tmp/tryout-i18n.log)"; record "FAIL:i18n"
    fi
  else
    skip "i18n key 一致性" "脚本不存在"; record "SKIP:i18n"
  fi

  # LLM 失败转移(failover)真实触发(2026-10-04 R19 新增)
  # 起两个本地 mock 上游(主 500 / 备 200)走真实 API 触发转移,**零 token 成本**。
  # 这条测试的价值:R19 正是靠它挖出两个此前零覆盖的生产级缺陷
  # (ISSUE-041 共享 schema 被 partial 改写、ISSUE-040 partial 套用创建默认值
  #  把 category 从 local 覆盖成 custom,导致本地备援被静默跳过)。
  if [ -f server/scripts/e2e-failover.mjs ]; then
    (cd server && timeout 300 node scripts/e2e-failover.mjs >/tmp/tryout-e2e-failover.log 2>&1)
    local frc=$?
    if [ "$frc" -eq 0 ]; then
      pass "E2E LLM failover"; record "PASS:E2E failover"
    elif [ "$frc" -eq 2 ]; then
      skip "E2E LLM failover" "后端未启动,详见 /tmp/tryout-e2e-failover.log"
      record "SKIP:E2E failover"
    else
      fail "E2E LLM failover,详见 /tmp/tryout-e2e-failover.log"; record "FAIL:E2E failover"
    fi
  else
    skip "E2E LLM failover" "脚本不存在"; record "SKIP:E2E failover"
  fi

  # 全路由错误码映射扫描(2026-10-04 R20 新增)
  # 解析全部 61 条 /api 路由,对每条注入畸形载荷,断言「4xx 不得 5xx」。
  # 这类缺陷历史上栽过两次(ISSUE-012 上传超限 500、ISSUE-028 不存在的 provider 500),
  # 都是逐个用例偶然撞见的;批量扫描才能保证**每一条**路由都如实表达错误性质。
  # 载荷集刻意包含「结构合法但资源无效/未就绪」—— 只发结构非法的载荷会漏掉
  # ISSUE-044 那一类(资源存在但没配 key 却报 500)。
  if [ -f server/scripts/e2e-error-mapping.mjs ]; then
    (cd server && timeout 400 node scripts/e2e-error-mapping.mjs >/tmp/tryout-e2e-errmap.log 2>&1)
    local emc=$?
    if [ "$emc" -eq 0 ]; then
      pass "E2E 全路由错误码映射"; record "PASS:E2E errmap"
    elif [ "$emc" -eq 2 ]; then
      skip "E2E 全路由错误码映射" "后端未启动,详见 /tmp/tryout-e2e-errmap.log"
      record "SKIP:E2E errmap"
    else
      fail "E2E 全路由错误码映射,详见 /tmp/tryout-e2e-errmap.log"; record "FAIL:E2E errmap"
    fi
  else
    skip "E2E 全路由错误码映射" "脚本不存在"; record "SKIP:E2E errmap"
  fi

  # PII 不得经「上游报错」路径落进服务端日志(2026-10-04 R20 新增,守卫 ISSUE-043)
  # 既有 e2e-pii-attack.mjs 用恒返 200 的 mock,llm.js 的 !resp.ok 分支从未被执行,
  # 于是 ISSUE-026 的修复在那里静默漏网 6 轮。本脚本用恒返 500 的 mock 补上这条路径。
  if [ -f server/scripts/e2e-pii-upstream-error.mjs ]; then
    (cd server && timeout 300 node scripts/e2e-pii-upstream-error.mjs >/tmp/tryout-e2e-pii-uperr.log 2>&1)
    local puc=$?
    if [ "$puc" -eq 0 ]; then
      pass "E2E PII 上游报错路径"; record "PASS:E2E pii-upstream-err"
    elif [ "$puc" -eq 2 ]; then
      skip "E2E PII 上游报错路径" "后端未启动,详见 /tmp/tryout-e2e-pii-uperr.log"
      record "SKIP:E2E pii-upstream-err"
    else
      fail "E2E PII 上游报错路径,详见 /tmp/tryout-e2e-pii-uperr.log"; record "FAIL:E2E pii-upstream-err"
    fi
  else
    skip "E2E PII 上游报错路径" "脚本不存在"; record "SKIP:E2E pii-upstream-err"
  fi

  # 真实 LLM 端到端(2026-10-04 新增)
  # 覆盖"功能是否真的能用":创建会话 → 抽题 → 非流式/流式聊天 → 逐题评分 →
  # 反馈 CRUD → 整场评估 → 弱项聚合 → PII → 输入校验。
  # 依赖 TRYOUT_TOKEN / TRYOUT_PROVIDER;缺凭据时以退出码 3 跳过,
  # 不能让没有 API key 的开发机因此变红。
  if [ -f server/scripts/e2e-real-interview.mjs ]; then
    if [ -n "${TRYOUT_TOKEN:-}" ] && [ -n "${TRYOUT_PROVIDER:-}" ]; then
      (cd server && TRYOUT_TOKEN="$TRYOUT_TOKEN" TRYOUT_PROVIDER="$TRYOUT_PROVIDER" \
        API_BASE="${API_BASE:-http://127.0.0.1:3001}" \
        timeout 900 node scripts/e2e-real-interview.mjs >/tmp/tryout-e2e-real.log 2>&1)
      if [ $? -eq 0 ]; then
        pass "E2E 真实 LLM 面试闭环"; record "PASS:E2E real"
      else
        fail "E2E 真实 LLM 面试闭环,详见 /tmp/tryout-e2e-real.log"; record "FAIL:E2E real"
      fi
    else
      skip "E2E 真实 LLM 面试闭环" "未设置 TRYOUT_TOKEN / TRYOUT_PROVIDER"
      record "SKIP:E2E real"
    fi
  else
    skip "E2E 真实 LLM 面试闭环" "脚本不存在"; record "SKIP:E2E real"
  fi

  # 浏览器级 e2e(playwright-core + 本机 Chrome)
  # 补 jsdom / node 环境都测不到的三类问题:
  #   可见性启发式(offsetParent)、响应式布局、移动端点击目标尺寸
  # 依赖前后端在跑;不可达时脚本以退出码 2 说明原因,门禁记为 SKIP 而非 FAIL。
  if [ -f web/scripts/e2e-browser.mjs ] && [ -d web/node_modules/playwright-core ]; then
    (cd web && timeout 420 node scripts/e2e-browser.mjs >/tmp/tryout-e2e-browser.log 2>&1)
    local brc=$?
    if [ "$brc" -eq 0 ]; then
      pass "E2E 浏览器级"; record "PASS:E2E browser"
    elif [ "$brc" -eq 2 ]; then
      skip "E2E 浏览器级" "前后端未启动或无 Chrome,详见 /tmp/tryout-e2e-browser.log"
      record "SKIP:E2E browser"
    else
      fail "E2E 浏览器级,详见 /tmp/tryout-e2e-browser.log"; record "FAIL:E2E browser"
    fi
  else
    skip "E2E 浏览器级" "playwright-core 未安装或脚本不存在"; record "SKIP:E2E browser"
  fi

  # 2026-10-04(R18)新增:浏览器级**真实点击流**
  #   补 FEATURE_MATRIX 长期挂着的一条缺口 —— 此前全部浏览器断言都只看渲染结果,
  #   项目里**没有任何一个测试真的点过按钮**。"元素存在但点不动"(overlay 遮挡 /
  #   pointer-events:none / z-index 错位)在纯渲染断言下完全测不出来。
  #   覆盖:10 条导航真实点击、语言切换 + 真实 reload 持久化、模态框开合与焦点进入、
  #        表单禁用态联动(刻意不提交凭据,避免污染本机 API token)。
  if [ -f web/scripts/e2e-browser-flow.mjs ] && [ -d web/node_modules/playwright-core ]; then
    (cd web && timeout 420 node scripts/e2e-browser-flow.mjs >/tmp/tryout-e2e-browser-flow.log 2>&1)
    local brfc=$?
    if [ "$brfc" -eq 0 ]; then
      pass "E2E 浏览器点击流"; record "PASS:E2E browser-flow"
    elif [ "$brfc" -eq 2 ]; then
      skip "E2E 浏览器点击流" "前后端未启动或无 Chrome,详见 /tmp/tryout-e2e-browser-flow.log"
      record "SKIP:E2E browser-flow"
    else
      fail "E2E 浏览器点击流,详见 /tmp/tryout-e2e-browser-flow.log"; record "FAIL:E2E browser-flow"
    fi
  else
    skip "E2E 浏览器点击流" "playwright-core 未安装或脚本不存在"; record "SKIP:E2E browser-flow"
  fi

  # 静默失败检查(2026-10-04 R28 新增)
  # 前端不得存在"既无处理逻辑、又无一行说明"的 catch。
  # ISSUE-057 就是 `catch {}` 造成的真实数据丢失:群面消息先乐观更新进 UI、
  # 再异步落库,落库失败被完全吞掉 → 刷新页面消息凭空消失,用户全程无感知。
  # 而 9 个前端页面零测试覆盖,空 catch 不会让任何现有测试变红。
  # 判定:有处理逻辑 / 只有注释(写明了理由)→ 放行;完全空 → 失败。
  if [ -f web/scripts/check-silent-catch.mjs ]; then
    if (cd web && node scripts/check-silent-catch.mjs >/tmp/tryout-silent-catch.log 2>&1); then
      pass "前端无静默 catch"; record "PASS:no-silent-catch"
    else
      fail "前端存在静默 catch,详见 /tmp/tryout-silent-catch.log"; record "FAIL:no-silent-catch"
    fi
  else
    skip "前端无静默 catch" "脚本不存在"; record "SKIP:no-silent-catch"
  fi

  # 硬编码 i18n 检查(2026-10-04 R24 新增)
  # 前两道 i18n 闸门管不到这一类:check-i18n 校验词典之间的 key 对齐,
  # validate-i18n 校验译文质量,而「源码压根没用 t()」两者都看不见。
  # 这类缺陷不会让任何测试变红 —— 功能正常、渲染正常,只是那 9 种语言显示中文。
  if [ -f web/scripts/check-hardcoded-i18n.mjs ]; then
    if (cd web && node scripts/check-hardcoded-i18n.mjs >/tmp/tryout-i18n-hardcoded.log 2>&1); then
      pass "i18n 无硬编码中文"; record "PASS:i18n hardcoded"
    else
      fail "i18n 硬编码中文,详见 /tmp/tryout-i18n-hardcoded.log"; record "FAIL:i18n hardcoded"
    fi
  else
    skip "i18n 无硬编码中文" "脚本不存在"; record "SKIP:i18n hardcoded"
  fi

  # 译文质量:脚本混杂 / 中文串味 / 占位符丢失(2026-10-04 新增)
  # 与上面的 key 一致性互补 —— 后者只看"有没有",前者看"对不对"。
  if [ -f web/scripts/validate-i18n.mjs ]; then
    if (cd web && node scripts/validate-i18n.mjs >/tmp/tryout-i18n-quality.log 2>&1); then
      pass "i18n 译文质量"; record "PASS:i18nQuality"
    else
      fail "i18n 译文质量(详见 /tmp/tryout-i18n-quality.log)"; record "FAIL:i18nQuality"
    fi
  else
    skip "i18n 译文质量" "脚本不存在"; record "SKIP:i18nQuality"
  fi
}

do_unit() {
  section "单元测试"
  if [ -d server/node_modules ]; then
    # ⚠️ 必须用**唯一** DB_DIR。测试会往库里写数据(agent-crud 等),
    #    复用同一目录第二次跑必然冲突 —— 曾导致门禁出现 33 个假失败。
    #    node --test 自带并发,再叠加共享 DB 就会互相踩。
    local t_db; t_db="$(mktemp -d /tmp/tryout-gate-XXXXXX)"
    if (cd server && DB_DIR="$t_db" INTERVIEWX_AUTH_DISABLED=1 node --test --test-concurrency=1 >/tmp/tryout-server-test.log 2>&1); then
      # ⚠️ R29(ISSUE-060):原先只匹配 TAP 的 `^# pass N`,而本机 Node 输出的是
      #   `ℹ pass N` —— 正则**永远匹配不到**,计数静默退化成 `?`,
      #   于是门禁显示「后端单元测试 (? 通过)」。
      #   危险之处:测试数从 183 掉到 100,门禁**照样显示通过**,只是数字不见了。
      #   这就是"静默失败"在我自己的门禁里的复现。
      #   现在两个格式都匹配,且**提取不到就判失败** —— 门禁必须能读出自己的结果。
      local n; n=$(grep -oE '^(ℹ|#) pass [0-9]+' /tmp/tryout-server-test.log | grep -oE '[0-9]+' | head -1)
      local f; f=$(grep -oE '^(ℹ|#) fail [0-9]+' /tmp/tryout-server-test.log | grep -oE '[0-9]+' | head -1)
      if [ -z "$n" ]; then
        fail "后端单元测试:无法从日志提取通过数(门禁自身失效),详见 /tmp/tryout-server-test.log"
        record "FAIL:后端单测(计数提取失败)"
      else
        pass "后端单元测试 (${n} 通过 / ${f:-?} 失败)"; record "PASS:后端单测"
      fi
    else
      fail "后端单元测试(详见 /tmp/tryout-server-test.log)"; record "FAIL:后端单测"
    fi
    rm -rf "$t_db"
  else
    skip "后端单元测试" "依赖未安装"; record "SKIP:后端单测"
  fi

  if [ -d web/node_modules ]; then
    if (cd web && npx vitest run >/tmp/tryout-web-test.log 2>&1); then
      local n; n=$(grep -oE 'Tests +[0-9]+ passed' /tmp/tryout-web-test.log | grep -oE '[0-9]+' | head -1)
      pass "前端单元测试 (${n:-?} 通过)"; record "PASS:前端单测"
    else
      fail "前端单元测试(详见 /tmp/tryout-web-test.log)"; record "FAIL:前端单测"
    fi
  else
    skip "前端单元测试" "web 依赖未安装"; record "SKIP:前端单测"
  fi
}

do_e2e() {
  section "端到端测试"
  if [ ! -d server/node_modules ]; then skip "E2E" "依赖未安装"; record "SKIP:E2E"; return 0; fi

  local found=0
  # 安全/数据完整性 E2E(2026-10-04 自主测试循环新增)
  # e2e-auth-routes / e2e-ssrf-route:路由级鉴权与 SSRF 两层防线
  # e2e-defense-and-integrity:限流 + 日 token 预算 + 导出导入
  # e2e-question-reference:ISSUE-038 题目级评分基准端点(鉴权/三件套/不泄露/不静默 404)
  #   ↑ 该脚本需等待两个限流窗口自然过期以分别观测各套限流,耗时约 2.5-3.5 分钟,
  #     故单独给更长超时,不能用通用的 180s。
  for s in scripts/e2e-pii-mapping.mjs scripts/e2e-pii-attack.mjs scripts/e2e-session-position.mjs \
           scripts/e2e-auth-routes.mjs scripts/e2e-ssrf-route.mjs \
           scripts/e2e-upload.mjs scripts/e2e-route-smoke.mjs \
           scripts/e2e-transcribe.mjs scripts/soak-limits.mjs \
           scripts/e2e-crud-semantics.mjs \
           scripts/e2e-agents-keys.mjs \
           scripts/e2e-question-reference.mjs \
           scripts/e2e-path-traversal.mjs \
           scripts/e2e-concurrency.mjs \
           scripts/e2e-xff-trust-proxy.mjs \
           scripts/e2e-defense-and-integrity.mjs; do
    [ -f "server/$s" ] || { skip "$(basename "$s")" "不存在"; continue; }
    found=1
    local name; name=$(basename "$s" .mjs)
    local tmo=180
    case "$name" in
      e2e-defense-and-integrity) tmo=480 ;;   # 含两次 62s 限流窗口等待
      e2e-auth-routes|e2e-ssrf-route|e2e-upload) tmo=300 ;;
      e2e-crud-semantics|e2e-concurrency) tmo=300 ;;   # 多组并发写入,给足时间
      soak-limits) tmo=600 ;;   # 长稳:多轮启停 + 上千次请求
      e2e-xff-trust-proxy) tmo=420 ;;   # 需起真实 nginx 容器
      e2e-path-traversal) tmo=300 ;;   # 36 路由 × 8 payload = 288 次请求
    esac
    if (cd server && timeout "$tmo" node "$s" >/tmp/tryout-e2e-$name.log 2>&1); then
      pass "E2E $name"; record "PASS:E2E $name"
    else
      fail "E2E $name(详见 /tmp/tryout-e2e-$name.log)"; record "FAIL:E2E $name"
    fi
  done
  # 前端 E2E:验证 ADR-001 的独立评分真的生效(6 个独立请求、无跨维度泄漏)
  for wf in scripts/e2e-isolated-scoring.mjs scripts/e2e-exam-focus.mjs; do
  if [ -f "web/$wf" ] && [ -d web/node_modules ]; then
    local wname; wname=$(basename "$wf" .mjs)
    if (cd web && timeout 300 node "$wf" >/tmp/tryout-e2e-$wname.log 2>&1); then
      pass "E2E $wname"; record "PASS:E2E $wname"
    else
      fail "E2E $wname(详见 /tmp/tryout-e2e-$wname.log)"
      record "FAIL:E2E $wname"
    fi
  fi
  done

  [ -f server/scripts/e2e-voice-smoke.mjs ] && do_e2e_voice
  [ $found -eq 0 ] && [ ! -f server/scripts/e2e-voice-smoke.mjs ] \
    && [ ! -f web/scripts/e2e-isolated-scoring.mjs ] && { skip "E2E" "无 E2E 脚本"; record "SKIP:E2E"; }
}

# e2e-voice-smoke 是"外部服务"型脚本:它只起 mock LMM,要求主服务已就绪。
# 门禁需自动准备前置服务,否则该脚本永远只能在人工预热后跑 —— 即等于没有门禁。
do_e2e_voice() {
  local port=3501 db=/tmp/tryout-e2e-voice
  rm -rf "$db"; mkdir -p "$db"
  printf '  %s→%s 起临时后端 :%s ...\n' "$DIM" "$RST" "$port"
  # ⚠️ 关键:不要用 `( cd server && node index.js ) &`。
  #    那样 $! 拿到的是子 shell 的 pid,node 是它的孙进程。
  #    kill 子 shell 后 node 会被 init 收养(PPID=1)继续运行并占住端口,
  #    导致后续 E2E 随机失败("后端未就绪"但日志为空)。必须让 node 成为直接子进程。
  (
    cd server || exit 1
    exec env PORT="$port" DB_DIR="$db" INTERVIEWX_AUTH_DISABLED=1 node index.js
  ) >/tmp/tryout-e2e-voice-server.log 2>&1 &
  local pid=$!
  # 等待就绪(最多 30s)
  local up=0
  for _ in $(seq 1 120); do
    if (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; then exec 3<&- 3>&-; up=1; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  if [ "$up" -ne 1 ]; then
    kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
    fail "临时后端启动失败(详见 /tmp/tryout-e2e-voice-server.log)"
    record "FAIL:E2E e2e-voice-smoke"; return 0
  fi
  ( cd server && API_BASE="http://127.0.0.1:$port" timeout 180 \
      node scripts/e2e-voice-smoke.mjs >/tmp/tryout-e2e-e2e-voice-smoke.log 2>&1 )
  local rc=$?
  # 先 SIGTERM,宽限后 SIGKILL —— 只 kill 不 wait 会让进程在下一轮仍占着端口,
  # 表现为后续 E2E 随机失败("后端未就绪"但日志为空),极难排查。
  kill "$pid" 2>/dev/null
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  rm -rf "$db"
  if [ $rc -eq 0 ]; then
    pass "E2E e2e-voice-smoke"; record "PASS:E2E e2e-voice-smoke"
  else
    fail "E2E e2e-voice-smoke(详见 /tmp/tryout-e2e-e2e-voice-smoke.log)"
    record "FAIL:E2E e2e-voice-smoke"
  fi
}

do_build() {
  section "前端构建"
  if [ ! -d web/node_modules ]; then skip "前端构建" "web 依赖未安装"; record "SKIP:前端构建"; return 0; fi
  if (cd web && npm run build >/tmp/tryout-build.log 2>&1); then
    local main; main=$(grep -oE 'assets/index-[^ ]+\.js +[0-9.]+ kB' /tmp/tryout-build.log | grep -oE '[0-9.]+ kB' | head -1)
    pass "前端构建成功${main:+ (主 chunk $main)}"; record "PASS:前端构建"
  else
    fail "前端构建失败(详见 /tmp/tryout-build.log)"; record "FAIL:前端构建"
  fi
}

do_docker() {
  section "镜像构建"
  if ! have docker; then skip "Docker 镜像" "未安装 docker(不计入失败)"; record "SKIP:Docker"; return 0; fi
  if ! docker info >/dev/null 2>&1; then skip "Docker 镜像" "daemon 未运行(不计入失败)"; record "SKIP:Docker"; return 0; fi
  # ⚠️ R47:`docker/Dockerfile.server` **早就写好了** `ARG APT_MIRROR` 与 `ARG NPM_REGISTRY`
  #   两个 build-arg(为了在受限网络里能换源),但 build.sh 从来没传过 ——
  #   于是每轮都硬走 deb.debian.org + registry.npmjs.org。
  #   后果不是"慢",而是**必然失败或超时**:R31~R34 连续四轮卡在
  #   `apt-get update` 下载 8.79MB 的 Debian 索引,R47 干脆直接报错。
  #   开关一直在那儿,只是没人接上。
  #
  #   默认值保持官方源 ⇒ **不改变任何生产行为**;网络受限时用环境变量加速:
  #     APT_MIRROR=mirrors.aliyun.com NPM_REGISTRY=https://registry.npmmirror.com ./build.sh all
  local apt_mirror="${APT_MIRROR:-deb.debian.org}"
  local npm_registry="${NPM_REGISTRY:-https://registry.npmjs.org}"
  if docker build -f docker/Dockerfile.server -t tryout-server:gate \
      --build-arg APT_MIRROR="$apt_mirror" \
      --build-arg NPM_REGISTRY="$npm_registry" \
      . >/tmp/tryout-docker.log 2>&1; then
    pass "server 镜像构建"; record "PASS:Docker server"
  else
    fail "server 镜像构建(详见 /tmp/tryout-docker.log)"; record "FAIL:Docker server"; return 0
  fi
  if docker build -f docker/Dockerfile.web -t tryout-web:gate . >>/tmp/tryout-docker.log 2>&1; then
    pass "web 镜像构建"; record "PASS:Docker web"
  else
    fail "web 镜像构建"; record "FAIL:Docker web"
  fi
  # 失败时把实际用的源打出来 —— 否则只看 "镜像构建失败" 无法判断是代码问题还是网络问题
  echo "    (本次使用的源:APT_MIRROR=$apt_mirror  NPM_REGISTRY=$npm_registry)"
}

case "${1:-all}" in
  install) do_install; summary ;;
  static)  do_static;  summary ;;
  unit)    do_unit;    summary ;;
  e2e)     do_e2e;     summary ;;
  build)   do_build;   summary ;;
  docker)  do_docker;  summary ;;
  all)     do_install; do_static; do_unit; do_e2e; do_build; do_docker; do_reclaim; summary ;;
  help|-h|--help) sed -n '2,16p' "$0" | sed 's/^#\{1,\} \{0,1\}//' ;;
  *) printf '未知参数: %s\n用法: ./build.sh [all|static|unit|e2e|build|docker|install|help]\n' "$1"; exit 2 ;;
esac
