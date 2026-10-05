# Changelog

本项目所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Fixed
- nginx 改为运行时解析后端(`resolver 127.0.0.11` + 变量 upstream)：web 容器不再因后端未就绪/换 IP 而启动失败或断链（独立运行时 /api 返回 502 而非崩溃）。
- README 的 `## License` 链接未闭合（渲染为 `[MIT## 题库资产`），且标题重复出现两次；README 版本号与已发布版本不一致。
- `groupDiscussionEngine.ts` 注释写"消息数 >= 20"，实际阈值为 24。

### Changed
- **PDF 解析换用 `pdfjs-dist`（替代 `pdf-parse@1.1.1`）**：`pdf-parse` 最后更新于 2018-10-24、内置 4 份 pdf.js（解压 31.8 MB），且其 `getDocument(dataBuffer)` 从不传 `cMapUrl`，导致引用预定义 CMap 的中文 PDF 提取为空。锁定 `pdfjs-dist@5.0.375`（最后一个支持 Node 20 的版本；6.x 要求 Node ≥22.13）。逻辑抽至 `server/services/pdf.js`。
- 扫描件（无文字层 PDF）返回可操作提示，引导用户上传文字版或粘贴文本。
- 流式响应下新增 PII 占位符映射下发（首个 SSE 事件 `pii_mapping`），由前端渲染时还原，解决"流式无法回填明文"导致用户看到 `[PHONE_xxxxxxxx]` 的问题。映射仅存在于浏览器内存，不落库、不写日志。
- CI 前端测试移除 `|| true`（此前恒为通过）；`npm install --legacy-peer-deps` 改为 `npm ci`；"Lint" 更名为 "Syntax check"（实为 `node --check`），并补入 `routes/analysis.js` 与 `services/whisper.js`。
- `resumeParser.ts` 移除未被调用的前端 PDF 解析实现（原实现对中文 PDF 必然失效，注释亦误导），文件头改为指向服务端实现。
- CHANGELOG 修正日期年份笔误（2025 → 2026，仓库实际创建于 2026-07-22）。
- Docker 部署方案并入本仓库 `docker/` 目录（Dockerfile.server / Dockerfile.web / docker-compose.yml / nginx.conf），原独立仓库 interviewx-docker 废弃并重定向；镜像与容器名统一为 tryout-server / tryout-web（随仓库更名 Tryout）。
- Dockerfile.server 基础镜像 node:20-alpine → node:24-slim：依赖树含 onnxruntime-node(仅 glibc) 与需要 Node24 API 的 undici；受限网络提供 APT/NPM/sharp 镜像源构建参数，better-sqlite3 用镜像内自带 Node 头文件本地编译。
- 新增题库 JSON 导出：`npm run export:questionbank` 生成框架无关的 public/questionbank.json（808 题），README 文档化导入 schema。
- CI 新增 docker-build job（构建两个镜像验证）。

### Added
- `web/src/lib/evaluation/consistency.ts` + 15 例测试：把 V6「单维度一致率 >= 85%」
  变成可计算的指标。采用**两两比较**（N 次运行中任意两次分数相同的比例），
  而非众数占比（N=3 时退化）或标准差（1-5 序数量，均值/方差无直觉意义）。
- `web/scripts/eval-ab.mjs`：独立评分 vs 联合评分的一致性 A/B 实验。
  目的是在**本项目自己的 prompt、题库、模型**上复现 arXiv:2608.14684 的结论，
  而不是直接引用别人的数字。支持 `--mock` 自测（无需 API key）与真实测量两种模式。
  输出逐维度一致率、总体对比与 V6 门禁判定。
- 2 个 E2E 脚本加入统一清理守卫（`process.on("exit"/"uncaughtException"/"unhandledRejection")`）。

### Added
- **V1 中文 PDF 端到端验证：从"未验证"到"有测试守护的已验证"**
  - 引入 3 份**真实中文简历 PDF** 作为测试夹具（`server/test/fixtures/`，741 KB）：
    - `resume1.pdf` — LaTeX/XeLaTeX 生成，CJK 字体全为 CID Type0C + Identity-H，
      **完全没有 ToUnicode CMap**，提取必须依赖 CIDSystemInfo → 预定义 CMap 映射。
      **这是最硬的一类中文 PDF。**
    - `resume2/3_typst_zh.pdf` — Typst 生成，带 ToUnicode，标准 CID 路径（对照组）
  - `server/test/pdf-chinese.test.js`（7 例）：三份夹具的中文字数下限、无文字层 PDF 的
    可操作提示、损坏 PDF 不崩溃、空 Buffer 拒绝。
  - `scripts/verify-v1.sh`：真实 HTTP 上传链路验证（上传 → 解析 → 结构化字段）。

  **实测基线对比**：

  | 库 | resume1 | resume2 | resume3 |
  |---|---|---|---|
  | `pdf-parse@1.1.1`（W1 换库前） | 0 中文字 ❌ | 0 ❌ | 0 ❌ |
  | `pdfjs-dist@5` + cMapUrl（W1 换库后） | **1260 ✅** | 860 ✅ | 860 ✅ |

  **W1 那个换库决定，在这三份真实文件上从 0 变成 1260 字。**

- `web/src/lib/groupSummary.test.ts`（16 例）：分组归纳从零测试到全覆盖 ——
  覆盖 review 优先于 evaluation、时间排序、趋势三档、空数据 insufficient、孤儿评估忽略。
- `server/services/weaknessCore.js` + `server/test/weaknessCore.test.js`（14 例）：
  弱项分析核心逻辑，从 Express 路由内联代码抽为可测纯函数。
- `web/src/lib/exporter.test.ts`（15 例）+ `web/src/lib/reviewGenerator.test.ts`（17 例）：
  导出与整场回顾解析从零测试到全覆盖。
  拆分出 `buildSessionMarkdown` / `buildSessionJSON` 纯函数后，导出内容**首次具备可测性**。
- `web/src/lib/candidatePersonas.test.ts`（14 例）：245 行画像权重表从零测试到全覆盖 ——
  概率型权重必须在 [0,1]、画像间必须可区分、**画像数量必须与 `CandidatePersona` 联合类型一致**
  （多一个或少一个都会造成"UI 能选但调度引擎查不到"的静默不一致）。
- `web/src/lib/heatmapData.test.ts`（11 例）：热力图聚合。
  覆盖时区偏移（纯日期字符串按 UTC 解析，东八区会记错一天）、
  部分评估缺分数时平均分只算有分数的、非法日期跳过、53 周单调递增。
  **确认整周对齐（含最多 6 天未来日期）是 GitHub 贡献图的标准行为而非 bug** ——
  `Heatmap.tsx` 用 `future: date > today` 专门渲染。
- `web/src/lib/matchScore.ts` + 11 例测试：JD 匹配度计算，区分「0 分」与「无法计算」。
- `web/src/lib/resumeParser.test.ts`（34 例）+ `web/src/lib/community.test.ts`（24 例）：
  两个"用户可控输入"模块从零测试到全覆盖。**补出 2 个真 bug + 1 个校验缺口**（见下）。

### Added
- **sitemap.xml + robots.txt 生成**（`npm run gen:sitemap`）——
  428 个题库内容页此前**没有任何入口能让搜索引擎发现**。
  生成 429 条 URL（站点根 + 索引页 + 427 个知识点页），含 `lastmod`/`changefreq`/`priority`。
- **GitHub Pages 部署工作流**（`.github/workflows/pages.yml`）——
  在 build 前依次执行 `export:questionbank` → `gen:pages` → `gen:sitemap` → `build`，
  确保内容页与题库始终同步；并校验产物（sitemap/robots 存在、页面数 > 0）。

### Changed
- README 首屏加入**题库在线浏览入口**，说明 427 个专题页的内容与"不提供参考答案"的原因。
- README Docker 段补充镜像拉取命令，并**说明 GHCR 镜像与 main 分支存在时间差**
  （`latest`/`v1.1.0` 对应 2026-08-24 的代码，主分支仍在改进）。

### Fixed
- **sitemap URL 双重编码**：`generate-question-pages.mjs` 存的文件名已经过
  `encodeURIComponent`，sitemap 脚本再编码一次导致 `%E4%B8%80` 变成
  `%25E4%25B8%25%80` —— **sitemap 里全是死链**。

- **门禁复用固定 DB_DIR 导致连续运行时出现 33 个假失败** —— 测试隔离缺陷。
  `build.sh` 一直用 `/tmp/tryout-gate`,而部分测试(agent-crud 等)会**往库里写数据**;
  第一次跑干净、第二次跑就与残留数据冲突。
  这是**只有连跑两次才能暴露**的问题 —— 单次运行永远是绿的。
  → 改用 `mktemp -d` 每次生成唯一目录,并加 `--test-concurrency=1` 避免测试间互相踩库。
  验证:连跑两次门禁均全绿。

- **分组归纳静默丢弃无分数的会话** —— 一个 session 的评估全部缺分时,
  旧代码用 `(Number(score) || 0)` 求平均得 0,再被 `avg > 0` 过滤,
  该会话从 `progressPoints` 凭空消失,但 `totalSessions` 仍计入它 ——
  两者数量对不上,趋势计算失真,而用户只看到"少了点"的分段归纳。
  → 只对**有有效分数**的评估求平均;一个都没有时排除并记入 `noScoreSessionIds`,
    供 UI 说明"N 场未评分",而不是悄悄丢掉。

- **弱项分析用 1 个样本给用户下练习建议** —— 原实现对所有维度一视同仁。
  1 次评估得 3 分可能是运气(题目恰好不熟),10 次均分 3 分才是真弱项。
  → 核心逻辑抽到 `services/weaknessCore.js`(14 例测试,此前内联在路由里无法测),
    加样本量门槛(默认 3 次,可配置),样本不足的维度标 `lowConfidence`,
    且**全部不足时说明"还差几次"而不是给建议**。
  保留原有正确行为:无数据时 `hasData:false`,不编造建议。

- **整场回顾解析把失败当 0 分** —— "假数据"模式的**第五次**。
  `parseReviewResult` 此前是 `Number(parsed.overallScore) || 0`:
  LLM 漏掉 `overallScore` 或返回非数字时**静默变成 0 分** ——
  用户看到"本次面试 0 分",而真相是"我没解析出来"。
  数组字段同理:`Array.isArray(x) ? x : []` 让缺结构的结果看起来像"没有优点/不足"。
  → 必需字段缺失或类型错误时返回 `null`,走"解析失败"分支;
    `overallScore: 0` 本身是**有效值**(真的 0 分),改用 `Number.isFinite` 判定;
    `improvements[].priority` 非法值做**归一**(medium)而非丢弃整个结果;
    新增 <think> 块剥离(模型常在 think 里规划,可能写出半截 JSON)。

- **导出内容无法测试（可测性缺陷）** —— `exportSessionAsMarkdown` /
  `exportSessionAsJSON` 把「生成内容」与「触发浏览器下载」混在一个函数里,
  在 Node 环境直接 `document is not defined`。
  **这意味着导出功能从来没能被自动化测试覆盖过**,想验证导出结构只能人肉打开下载的文件。
  → 拆出纯函数 `buildSessionMarkdown()` / `buildSessionJSON()`;
    原导出函数签名与行为**完全不变**,向后兼容。

- **导出内容可破坏 Markdown 结构** —— 消息/建议被**原样**拼进导出的 Markdown。
  对话里出现 `**加粗**`、`# 标题`、`` `代码` `` 时,
  导出文件结构被破坏 —— 而这是用户要**发给别人的**文档。
  → 新增 `neutralizeBlockStructure()`:只中和**会改变块结构的行首标记**
    (标题/引用/列表/代码围栏/分割线),行内标记原样保留。
    不做完整转义 —— 那会让正文全是反斜杠,可读性更差。

- **雷达图把"缺基准"画成 0 分** —— "假数据"的第四次出现。
  `EvaluationRadar` 此前是 `hasBaseline = Object.keys(baseline).length > 0`(全局判断)
  + `benchmark: baseline?.[dim] ?? 0`(缺失填 0)。
  后果:只要**任意一个**维度有基准就画出整条线,而没有基准的维度被填成 0,
  在雷达图上塌到原点 —— 看起来像"这个维度你历史上一分都没有",
  而真相是"样本不足,还没算出来"。
  **`0`(确实是 0 分)与 `null`(无数据)在雷达图上视觉无差别,含义却相反。**
  → 新增 `charts/radarData.ts`(8 例测试),缺基准填 `null`(Recharts 会在该轴断开),
    并在图上提示"部分维度暂无历史数据"。
    同时确认**基准值本身为 0 仍是有效数据**,不被当成缺失。

### Fixed（续）
- **JD 匹配度在解析失败时给 0 分** —— 这是"假数据"的第三次出现。
  `MaterialPage` 原本是 `parsed.skills.length ? round(matched/skills*100) : 0`:
  简历技能解析出 0 条时直接显示「匹配度 0」,用户会以为是自己能力差,
  而真相是**解析器没读懂简历**。
  0 分和"无法计算"是两件事:前者是结论,后者是失败。
  → 新增 `lib/matchScore.ts`(11 例测试),分数为 `null` 时 UI 显示「无法计算」
    并说明原因,附"这不代表你不符合该岗位"。

- **`parseGaps` 加了却没人用**（R20 的悬空点）——
  字段存在但没有消费方,等于没加。现已接到 UI:
  简历摘要区显式列出"以下内容未能自动识别:{fields}",
  并说明"这不代表简历里没有,只是解析器没读出来"。

- **`parseResume` 无法解析真实简历格式（4 个根因）** —— 用真实中文 PDF 端到端验证时暴露。
  此前解析器**比真实简历格式窄得多**，教育/经历**静默返回空**：
  用户以为导入成功，面试官却拿不到任何上下文。

  | | 修之前 | 修之后（真实 PDF 实测） |
  |---|---|---|
  | resume1 教育 | **0 条** | **2 条** |
  | resume1 经历 | **0 条** | **4 条** |
  | resume2 教育 | **0 条** | **3 条** |
  | resume2 经历 | **0 条** | **2 条** |

  1. **时间格式太窄** —— 只认 `2022.07 - 至今`，而真实简历普遍写
     `2023 年 6 月 – 至今`（中文年月日）与 `2020.09 -- 2024.06`（双连字符）。
  2. **经历强制要求竖线** —— 只认 `公司 | 职位`，而真实简历常写 `职位, 公司 年份`
     （**职位在前**），或纯空格分隔。
  3. **教育只认 `时间段 + 学校`** —— 真实排版常把「学校·学院 学位」与「时间段」
     放在**相邻两行**（LaTeX/Typst 排版所致），逐行处理会错位。
  4. **技能噪声** —— 把 `研究领域 : 语音识别` 的标签冒号当技能；
     Typst 模板的**随机中文隐私遮罩**（`肺己阐择萧精拜纱茎`）也被当成技能。

  同时新增**跨行配对**（`pairWithNextTimeLine`），并排除段落标题与列表项
  —— 它们没有时间，若参与配对会吸走本该独立成对的行，导致条目凭空消失。

- **`parseJDMatchResult` 缺结构校验** —— 此前只做 `JSON.parse`，LLM 少返回一个字段时
  下游拿到 `undefined` 会在渲染时崩。缺 `matchScore` / 数组字段含非字符串 → 返回 null，
  让调用方走「解析失败」分支。

- **`parseResume` 新增 `parseGaps`** —— 显式暴露"哪些字段没解析出来"，
  把「静默部分失败」变成调用方可展示的提示。

- **`parseResume` 把身份证号当手机号**：`/1[3-9]\d{9}/` 无边界约束，
  `110101199003078515`（18 位身份证）会误抓出 `19900307851`。
  用户填的是身份证，反馈里却显示别人的号码片段。→ 加前后向数字边界 `(?<!\d)...(?!\d)`。
- **`parseResume` 技能重复**：`技能：Java、Java` 产出 `['Java','Java']`，
  重复项会污染 JD 匹配的 matchedSkills / missingSkills 对比。→ 去重。
- **`validateExperience` 接受空 questions**：没有问题的"面经"没有意义，
  却会在列表里占位，导入者还会以为导入成功了。→ 显式拒绝空数组。

### Added（续）
- `docs/v7-question-bank-audit.md`：**V7 验收报告** —— 24 题分层抽样（12 行业 × 两端难度）
  逐条核对参考答案技术正确性，**24/24 通过**；全库 808 题结构完整性检查全部通过。
  抽样特别确认了 5 个高频易错点均写对：HashMap 树化的容量 ≥64 条件、SQL 注入防御中
  动态表名不能用预编译、K8s 调度只是初始决策、3PC 不解决一致性、RANK 与 DENSE_RANK 的跳号差异。
- `web/src/lib/evaluation/referenceAdapter.ts` + 15 例测试：**评估链路的参考答案裁剪**。
  抽样发现 226 题（28%）参考答案超 500 字符（coding 题 126 条塞了完整代码，最长 1818 字符），
  在评估 prompt 里会挤压其他内容并推高成本。
  **只在评估链路裁剪，不动题库资产** —— 完整代码对人是有价值的学习材料，站内浏览仍展示全文。
  按句读边界截断（不劈开半句）、coding 题用更短上限、额外抽取「判分要点」注入 prompt。
- **题库内容资产化（W5-4）** —— 808 道题从"站内浏览页"变成**可被外部检索的公开内容**。
  - `web/src/lib/bankAggregator.ts` + 16 例测试：按知识点聚合、跨题高频考点、FAQ 条目生成。
  - `web/scripts/generate-question-pages.mjs`：生成 **428 个静态页**（427 个知识点页 + 1 个索引页）
    到 `web/public/docs/questions/`，含 schema.org FAQPage 结构化数据，可被搜索引擎与 AI 直接引用。
  - 每个知识点页都带**具体统计数字**（题数、难度分布）与**跨题高频考点**，
    例如「行为」页：150 道题，48 初级 / 63 中级 / 39 高级，高频考点为
    量化、复盘、机制化、折中方案、根因、灰度等。
  - `manifest.json` 输出清单供后续 sitemap / 交叉引用。

  **安全约束（不可违反）**：内容页**只输出题目与考察点，绝不输出 `referenceAnswer`**。
  参考答案是评估技术正确性的唯一客观基准，泄进内容页 = 用户背答案 = 练习失去意义。
  已验证：428 个页面零 `referenceAnswer` 字样、零答案文本。
  每页底部显式声明这一点。

  内容策略：走**统计数据 + 结构化**路线，不堆关键词 —— 纯关键词堆砌是内容农场特征、
  降低可信度；含具体题数与考点交集的内容才是 AI 愿意引用的。

- `web/src/lib/groupDiscussionEngine.test.ts`（26 例）：群面调度引擎从**零测试**到全覆盖。
  覆盖：空数组/未定义不崩、阈值边界、未知画像回退、**画像权重真的起作用**
  （1000 次采样 leader 占比显著高于 follower）、prompt 注入防护（讨论记录与主题
  都包裹标签并声明不可执行）、自我介绍顺序。
- `web/src/lib/contextInjector.test.ts`（22 例）：prompt 注入核心路径从**零测试**到全覆盖。
  覆盖：三段注入顺序、空行结构一致性、长资料截断、多份叠加总量受控、
  `examFocus` 插在行为约束之前、阶段信号指令存在、focusDirection 包裹。

### Changed
- **群面讨论消息数上限参数化**。此前硬编码 24，无依据也不可配 ——
  10 分钟群面和 40 分钟群面显然不该用同一个上限。
  `scheduleNextSpeaker(..., maxDiscussionMsgs?)`，默认值保持向后兼容，非法值回退默认。
- **统一 `injectMaterials` 三段之间的空行结构**。此前首段用 `\n\n`、后续段用 `\n`，
  而每段末尾又追加 `\n\n`，实际产生 `\n\n\n` 的不一致空行，
  Markdown 渲染时段间间距不均。现在段间恰好一个空行。

- **阶段推进改为内容驱动（W5-2）**。此前是
  `Math.floor(totalMessages / 6)` —— **不管聊的是什么，每 6 条消息就跳一个阶段**，
  且各阶段深度需求差异极大（自我介绍 3 轮足够，项目深挖可能 10 轮）。

  改为**混合策略**：`stageAdvance.ts`（17 例测试）
  - LLM 只给**建议信号** `[STAGE_STATUS:continue|advance]` + `[COVERAGE:已问…|未问…]`
  - **不强制** —— 模型不配合时退回轮数覆盖规则，行为依然可预期
  - 明确的 `continue` 会**压制**轮数强制推进：内容判断优先于计数器
  - 轮数上限仍然保留，防止卡死在一个阶段

  为什么不让 LLM 独占决策：① 阶段判断每轮都做，= 每轮多一次调用（成本翻倍）
  ② LLM 判断会抖，同一段对话两次运行结论可能不同，而练习需要可复现。

  `stripStageMarkers()`（24 例测试）：**程序标记绝不入库/展示**，
  否则界面上会闪现 `[STAGE_STATUS:advance]`，历史回看同样会看到。
  已接入三条路径：入库前、流式渲染中、MessageBubble 兜底（防历史/导入数据）。

### Added
- `web/src/lib/evaluation/stageAdvance.ts` + `stageAdvanceSignal.ts`：阶段推进决策与信号解析。

### Changed（续）
- **删除 `PEER_BENCHMARK`（P2-4，挂了 6 轮才处理）**。
  它原本是 `EVALUATION_DIMENSIONS.map(d => ({..., score: 3.5}))` ——
  **六个维度全写死 3.5，却在 `EvaluationRadar` 里标为"同岗位平均"展示**。
  零数据来源的常数被包装成行业基准，属于可信度问题。

  为什么不改成"同岗位真实平均"：**我们没有任何真实面试数据**。
  任何声称"同岗位平均"的数字都是编的，数值合理（如 3.5）也一样。

  改为**用户自己的历史中位数**（`computePersonalBaseline`）：
  数据真实存在、对用户有意义（"你这次低于自己平均的 30%"）、
  冷启动（<3 次评估）时不显示而不是画一条假线。
  `starEvaluator.test.ts` 里新增一条"不应再导出 PEER_BENCHMARK"的契约测试，
  防止它被加回来。

- **表达指标去伪精度（W5-1）**
  - 填充词改用词边界感知的 `fillerDetector`（15 例测试）。原实现是
    `text.split(w).length - 1` **子串**计数，实测缺陷：
    `"I also think that some people like this"` → `like` 误判；
    `"这个方案我觉得非常好,因为它解决了那个我们一直头疼的问题"`（零填充词）→ 误判 3 次。
  - **中文高虚词移出默认词表**：`那个/这个/就是/然后/其实` 在正常中文里是
    指示代词与连接词，当填充词会**系统性低估中文用户** —— 而本项目目标用户以中文为主。
    保留 `嗯/呃/唔` 这类真正的无意义语气词。
  - **综合分 `expressionScore` 弃用，恒为 0**。权重（0.3/0.2/0.25/0.25）是拍脑袋定的，
    把四类性质不同的指标加权成一个数字是伪精度；各人语速基线差异很大，
    合成一个分对用户没有可解释意义。字段保留仅为向后兼容。
  - 文案从 `综合 {score}/100` 改为纯观察陈述
    （`语速 X 字/分 · 填充词 Y 次 · 平均句长 Z 字`），并附一句说明
    "以上为可观察指标,不含综合评分 —— 各人语速基线不同,合成一个分数没有意义"。

  参照 HireVue 的教训:*"放弃摄像头判决、保留麦克风判决,
  并不是修复了问题,只是把它移到了更难被看见的地方。"*
  诚实的数据边界比好看的图表重要。

- **上下文窗口治理（W4-4）** —— 修一处"三处路径标准互相矛盾"的显性缺陷。
  | 路径 | 治理前 | 治理后 |
  |---|---|---|
  | `predict-questions` 端点 | 简历 20000 / JD 10000 字符（硬编码） | 统一常量 + 显式省略声明 |
  | **主链路 `injectMaterials`** | **无上限，全文直拼** | 单份 6000 / 合计 14000，按行截断 |
  | **历史消息** | **无窗口，全量传** | 最近 12 条 + 12000 字符预算 |

  - `web/src/lib/contextWindow.ts` + 20 例测试。
  - 实测效果：44009 字符简历削减至受控上限；4 份超长资料叠加从 ~176K 压到预算内；
    60 条历史（36350 字符）→ 保留 12 条（7272 字符，**-80%**）。
  - **system 消息不占窗口配额** —— 它们承载角色设定，丢了面试就变形。
  - 无换行的超长单行有硬切兜底（PDF 提取文本偶尔整段无换行，按行截断会全丢）。

  三条设计取舍：
  1. **按行截断，不按字符硬切** —— 硬切会把词/字段劈两半，模型看到半句话会错误推断。
     宁可少给，不要给错。
  2. **显式声明被截断** —— 不声明的话模型以为看到的是全文，
     基于不完整信息下判断还不自知。**这比给得少更危险。**
  3. `estimateTokens` 保留一位小数 —— 早期版本对整体 `ceil`，
     导致 `estimateTokens("中")` 和 `estimateTokens("a")` 都是 1，分辨率全丢，
     粗估失去意义。

- **面试现场评估反馈（W4-3）** —— 评估不再只留在历史页。
  - `web/src/lib/liveCoach.ts` + 18 例测试：把"何时评估""评哪一对问答"抽成纯函数。
    `findLatestQaPair()` 找最后一组完整的 面试官提问→候选人回答；
    `shouldEvaluateNow()` 按间隔控制成本。
  - `LiveCoachPanel` 侧边栏面板：**弱项优先**，展示锚点判定与引用的原文依据。
  - 每 2 轮评一次、每次只评 2 个关键维度（技术深度 + 沟通表达），
    完整 6 维留到会话结束 —— 面试中给"更好的回答"会打断心流且诱导照抄。
  - 触发**不 await**：评估要走 2 个维度的 LLM 调用，await 会让提问卡住数秒。
  - **如实显示"缺依据"与"评分失败"** —— 分数可信度取决于有没有原文支撑，
    藏起来等于给出虚假的精确感。

  两条刻意设计：
  - `shouldEvaluateNow` 在 `interval<=0` 时**退化为不评估**而非每轮都评 ——
    ADR-001 已让单次评估变成 6 个 LLM 调用，配置失误静默烧 token 是最坏结果。
  - 面试官抛出新问题但候选人未答时，`findLatestQaPair` 返回**上一组完整问答**
    而非 null —— 趁用户记忆还新评估它更有意义。

- **题库接入真实提问（W4-2）** —— 前三轮的资产在这一轮开始产生价值。
  - `web/src/lib/examFocus.ts` + 12 例测试：把一道题变成注入 system prompt 的**知识锚点**。
    只给 `keyPoints`（考察方向），**不给题面全文**（给模型就会照读，用户背得出题库），
    并明确要求"改写成你自然的面试口吻"。
  - 追问边界：自由追问，但每条必须落在给定方向内，禁止临时开辟新方向。
    依据 Campion 15 成分：「同题」证据 ★★★，而「限制追问」证据 ☆☆☆（几乎为零）——
    结构化的价值在"同题"不在"限制追问"，实务惯例是
    *Probing is allowed and necessary; improvising new questions because you're curious is not.*
  - 换题节奏：**每 2 轮用户回答换一道题**。每轮都换会把对话打散成互不相干的问答，
    失去模拟价值；真实面试是"围绕一个点深挖若干轮再换方向"。
  - `contextInjector.buildSystemPrompt` 新增 `examFocus` 选项，插在「行为约束」之前（先给方向，再给纪律）。
  - 抽题后立即 `markQuestionAsked` 落库，同场不重复。
  - 题库不可用 / 未设行业 → 注入"不限定方向"的降级块，**不阻断面试**。
- `web/scripts/e2e-exam-focus.mjs`：**W4-2 端到端回归**（14 项断言）。
  单测只验证 `buildExamFocusBlock` 这个纯函数，证明不了
  "服务端真的返回了题、真的被注入、真的没泄漏参考答案"。
  若有人把 `examFocus` 传成空串,所有单测仍全绿而题库静默失效。已接入门禁。
- `web/src/lib/positionConfig.ts` + 12 例测试：目标岗位选择的前置校验与请求体组装。
- **会话配置面板新增「目标行业 + 岗位名称」**（W3-3）：12 个行业下拉（带各行业题数）、
  岗位名输入框、难度说明文案；面板挂载时拉取题库统计。
- `startInterview` 在**开跑之前**校验目标行业，避免用户答完几轮才发现题库用不上。

### Changed
- **题库不可用时降级放行，不阻断面试**。
  这是本轮修正的一处设计错误：初版把"题库未就绪"做成硬拦截，
  等于让新 clone（默认没跑过 `export:questionbank`）的用户**完全无法使用面试功能** ——
  把可选增强变成了硬门槛。
  现在只拦截一种情况：题库明明可用，用户却选了一个**确实没有题**的行业（明确的配置错误）。
  题库未就绪时放行 + 面板上给非阻断提示，提问侧按 `needsIndustry` 走 LLM 自由发挥，与 W3-1 之前一致。

### Added（续）
- `web/src/lib/questionPlanner.ts` + 13 例测试：**提问编排的纯函数层**。
  `planNextQuestion()` 返回四种明确语义：`ask` / `needsIndustry` / `noQuestions` / `exhausted`。
  **不猜岗位**：会话未设行业时返回 `needsIndustry` 而非随便找个行业出题 ——
  问错岗位的题比不问更糟，用户会以为自己在练技术面。
  计划中**绝不含 `referenceAnswer`**（那是评估基准，不是提问素材）。
- `server/scripts/e2e-session-position.mjs`：W3-2 端到端回归（8 项断言），
  覆盖岗位落库、已问题目记录/去重/幂等、参数校验、以及列表接口不泄漏参考答案。已接入门禁。
- `GET/POST /api/sessions/:id/asked-questions`：记录与查询本场已问题目。
- `api.listAskedQuestions()` / `api.markQuestionAsked()`：前端对应的两个方法。

### Changed
- **会话支持目标岗位（W3-2）**：`sessions` 新增 `industry` / `position`，
  `messages` 新增 `question_id` / `q_source`，新增 `asked_questions` 表（避免同场重复出题）。
  全部通过既有幂等迁移机制，老库自动升级。
- **`SessionSchema` 补 `industry` / `position`**。这是个隐蔽的坑：
  白名单式 schema 会**静默剥离**未声明字段，漏加这两个会让前端传了却存不进去、且**不报任何错**。
  已补 4 条回归测试锁定该行为。

### Fixed
- **E2E 探活窗口过短导致间歇性失败**：15 秒（60×250ms）在冷启动（含 DB 备份）
  或高负载机器上会误判"后端未就绪"。放宽到 60 秒（120×500ms）。
  这类 flaky 比确定性 bug 更难查 —— 单独复跑三次全绿、门禁跑却红，
  说明是时序问题而非代码问题。**教训：偶发失败先怀疑时序，且要能稳定复现才算查清。**

- **题库从前端静态 import 改为服务端加载（W3-1）**。
  题库 917 KB 此前在 `web/src/data/questionBank.*.ts`，全部打进 Vite 主 bundle，
  即使用户从不打开题库页也要下载。数据源移到仓库根 `data/questionbank-src/`
  （**在前端源码树之外**），由 `npm run export:questionbank` 生成
  `server/data/questionbank.json`（服务端权威副本）与 `web/public/questionbank.json`（前端兜底）。
  - 新增 `GET /api/questionbank/stats` 与 `GET /api/questionbank`（按行业/难度/题型/排除集/简历标签检索）
  - 🔴 **列表接口一律剔除 `referenceAnswer`** —— 它是"正确答案"，
    暴露给前端等于让用户背答案，评估随即失去意义。仅 `getReferenceForScoring()` 在服务端内部使用时才带上。
  - 题库详情页不再展示参考答案，改为说明"仅在评估时由服务端注入为满分参考示例"。
  - 导出脚本新增完整性校验：字段完整性、id 唯一性、`keyPoints` 非空（它是检索加权的核心依据），不通过即中止导出。
- **`vite.config.ts` 增加 `manualChunks`**：charts(recharts) / icons(lucide-react) 拆出独立 chunk。
  **主 chunk 783.76 kB → 233.65 kB（-70%）**。

  ⚠️ 更正一处此前的错误判断：此前记录"主 chunk 783 kB 是题库造成的"是**错的**。
  题库迁走后主 chunk 大小未变；实测主 chunk 的主要构成是 recharts + lucide-react。
  拆包的真实价值是让这些依赖不被 HTML 阻塞下载，与题库无关。

### Fixed
- **E2E 守卫的 TDZ 错误**：上一轮加入的 `cleanup()` 守卫中 `let cleaned` 声明在文件末尾，
  而前部已有 `cleanup()` 调用，触发 `ReferenceError: Cannot access 'cleaned' before initialization`。
  → 守卫整体前移到所有依赖声明之前。
  **教训：改动共享/全局作用域的代码后必须复跑全部 E2E，不能只跑改动相关的那条。**
- **E2E 残留孤儿进程导致门禁随机失败**。`( cd server && node index.js ) &` 起的是子 shell，
  `$!` 拿到子 shell 的 pid，node 是其孙进程；kill 子 shell 后 node 被 init 收养(PPID=1)
  继续运行并占住端口，表现为后续 E2E「后端未就绪」但日志为空。
  修法：用 `exec` 让 node 替换子 shell，pid 才对得上；并加 SIGTERM→宽限→SIGKILL→wait 序列。
  连跑三轮验证零残留。
- E2E 脚本在 fetch/网络异常路径下遗留子进程（此前只有少数几条退出路径调 `child.kill()`）。

### Changed
- `CONTRIBUTING.md` 与 issue / PR 模板。
- README 首屏重写：一句话差异化定位、对比表、Docker 一键启动、界面截图占位。
- SSE 事件解析器 `web/src/lib/sseParser.ts`（纯函数，可测），`api/client.ts` 流式循环改为调用它。
- `web/src/lib/piiPlaceholder.test.ts`（14 例）与 `web/src/lib/sseParser.test.ts`（14 例）。
- `server/scripts/e2e-pii-mapping.mjs`：起真实后端 + mock LLM 上游，断言 `pii_mapping` 真实出现在 SSE 流中。已接入 CI（`npm run test:e2e:pii`），作为 R11 的回归防护。
- `web/scripts/e2e-isolated-scoring.mjs`：**ADR-001 的回归防护**。
  单元测试只能验证纯函数，无法验证"调用方真的独立发了 6 次请求"——
  若有人把 `scoreAllDimensions` 改回单次调用，单测仍全绿而 ADR-001 的问题静默回归。
  本脚本用 esbuild 打包后实跑，断言：请求数 == 维度数、每个 prompt 只含本维度锚点、
  无 prompt 索取总分或引用其他维度得分、部分失败时总分不虚高。已接入门禁与 CI。
- `aggregateScores()` 与 `scoreWithRetry()`（含 14 例测试）。
- 解析失败与网络异常均自动重试一次；重试耗尽返回 null，由聚合层按 0 分计入并标记，
  不让单个维度的失败拖垮整批评估。
- **行为锚定量表（BARS）**：`EVALUATION_DIMENSIONS` 六个维度各增加 1 分与 5 分两端的行为锚点；新增降序字母量表 `ANCHOR_IDS`(A..E) 与 `anchorIdToScore()`；新增 `buildRubricBlock()` 生成单维度评分标准块（含长度偏见防护与中间档插值说明）。

### Changed
- **评估接入独立评分引擎（W2-3）**：`HistoryPage` 的评估流程从"一次调用输出 6 个维度 + 总分"
  改为"每维度一次互相不可见的独立调用，总分由 6 个独立分数确定性推导"。
  总分不再由 LLM 直接输出 —— 否则锚定偏见（d=0.71）会从后门回来。
  评估报告改为可解释形式：汇总 + 逐维度锚点判定 + 引用的原文依据。
  缺失维度按 0 分计入并标记 `missingCount`，不静默平均掉（否则"只评出 3 个且都是 5 分"
  会显示成满分）。
- **删除 HistoryPage 内的 `createLimit` 副本**，统一到 `@/lib/limit`。
  旧副本缺少两个保护：并发数 <= 0 归一化（防死锁）、任务抛错时释放槽位。
  一次异常会让旧实现永久卡死队列，整批评估静默挂起。
- 评估维度从形容词量表改为行为锚定量表。
  **为什么**：形容词量表的致命缺陷是两个评分者打"4 分"时心里想的完全不是一回事。
  **只锚两端而非摊到 1/3/5 档**：Choi et al. 2025（*Journal of AI in Education*）的定量对照显示，
  只锚两端时人机一致性 QWK = 0.59，优于摊到 1/3/6 档的 0.39；且每档 1 个锚点 ≈ 每档 3 个。
  **量表用 0-5 而非 1-10/1-100**：arXiv:2601.03444 实测 ICC 0.853 vs 0.805/0.840。
  **降序排列**：arXiv:2506.22316 指出随机打乱量表顺序会全面拉低准确率。
  ⚠️ 独立评分引擎（每次调用只评一个维度）尚未接入，本轮只交付锚点数据与渲染。
  接入后不得再把多个维度塞进同一次调用——arXiv:2608.14684 实测联合评估的一致性问题。

- SSE 事件解析器 `web/src/lib/sseParser.ts`（纯函数，可测），`api/client.ts` 流式循环改为调用它。
- `web/src/lib/piiPlaceholder.test.ts`（14 例）与 `web/src/lib/sseParser.test.ts`（14 例）。
- `server/scripts/e2e-pii-mapping.mjs`：起真实后端 + mock LLM 上游，断言 `pii_mapping` 真实出现在 SSE 流中。已接入 CI（`npm run test:e2e:pii`），作为 R11 的回归防护。
- `web/scripts/e2e-isolated-scoring.mjs`：**ADR-001 的回归防护**。
  单元测试只能验证纯函数，无法验证"调用方真的独立发了 6 次请求"——
  若有人把 `scoreAllDimensions` 改回单次调用，单测仍全绿而 ADR-001 的问题静默回归。
  本脚本用 esbuild 打包后实跑，断言：请求数 == 维度数、每个 prompt 只含本维度锚点、
  无 prompt 索取总分或引用其他维度得分、部分失败时总分不虚高。已接入门禁与 CI。
- `aggregateScores()` 与 `scoreWithRetry()`（含 14 例测试）。
- 解析失败与网络异常均自动重试一次；重试耗尽返回 null，由聚合层按 0 分计入并标记，
  不让单个维度的失败拖垮整批评估。

### Fixed
- **流式 PII 占位符未还原（V4 闭环）**：W1 只打通了后端一半，前端存在三段断路——
  ① `client.ts` 的 SSE 解析只识别 `error`/`choices`/`usage`，`pii_mapping` 事件被解析后静默丢弃；
  ② `ChatResult` 缺 `piiMapping` 字段；
  ③ `MessageBubble` 渲染层未还原占位符。
  现三处均已接通，面试中 AI 复述简历里的手机号/邮箱时显示明文而非 `[PHONE_xxxxxxxx]`。
- **R11 根因修复**：SSE 解析原先内联在 `client.ts` 流式循环里，任何新增元数据事件
  （`pii_mapping`、未来的 `stage_status` / `coverage`）都会被静默丢弃且难以察觉。
  现已抽为纯函数并保留 `raw` 字段，新增事件只需在该函数内加字段，不改调用方。

## [1.0.0] - 2026-07-22

首次公开发布。

### 新增

#### 面试会话
- 5 档难度系统(简单/普通/困难/极难/地狱),难度注入面试官 prompt
- 多面试官协同,按阶段(stage)切换,模拟"技术面 → HR 面 → CEO 面"全流程
- 自定义阶段流程:可改名、增删阶段,或套用预设模板(技术面/行为面/综合面)
- 资料上下文:勾选简历/JD 等资料作为面试官上下文注入
- 面试方向补充文本,注入系统提示

#### 群面模拟
- 多面试官 + 多 AI 候选人同场,会议室可视化视图
- 发言者高亮脉冲动画
- 实时/加速两种节奏切换
- 候选人画像定制(aggressive/calm/leader 等)
- 点击气泡指定回复,@某位发言者

#### Agent 工作台
- 8 个内置模板:6 个 HR(温和/压力型/外企/初创/资深总监/行为专家)+ 严苛技术官 + 毒舌 CEO
- 版本管理:每次改 prompt 存为新版本,可回滚
- 自定义头像(emoji/预设/上传图片)
- 专注领域、语气、难度配置
- 为 Agent 绑定专属供应商

#### 资料中心
- 上传 PDF/DOCX/MD/TXT,或直接粘贴文本
- 资料"添加到面试"作为上下文注入
- 4 份内置资料:使用说明/STAR 法则答题指南/简历优化指南/高频技术面试题汇编
- 简历-JD 匹配分析(基础技能匹配 + LLM 深化)

#### 历史记录
- 所有会话自动存档,按时间倒序
- 会话分组(如"秋招批次""某公司"),生成分组进度归纳
- 单场 STAR 评估 + 整场综合回顾
- 跨会话进步曲线:评分趋势和弱项分布

#### 多模型支持
- 4 个内置供应商:DeepSeek/OpenAI/智谱 GLM/Ollama 本地
- 模型热切换,API Key 通过 AES-256-GCM 加密存储
- 故障转移队列:主模型失败自动切换备用

#### 安全
- SSRF 防护(IP 白名单/DNS 校验/重定向阻断)
- PII 脱敏(手机号/邮箱/身份证入库前自动脱敏)
- 访问令牌认证(可选)
- 日 token 预算限制

#### 国际化
- 10 种语言:简中/繁中/英/日/韩/法/德/俄/阿/印地

#### 终端风格 UI
- GitHub Dark 深黑背景 + 终端绿配色
- 全站等宽字体(JetBrains Mono/Cascadia Code)
- 终端流式消息样式(●/>/# 前缀)
- 终端方块光标 + blink 动画

### 技术栈
- 前端:React 18 + TypeScript + Vite + Tailwind CSS
- 后端:Node.js + Express + better-sqlite3
- 数据库:SQLite(本地文件,零配置)

## [1.1.0] - 2026-08-24

### Added
- 语音答题链路：本地 Whisper 转写（`server/services/whisper.js`）+ 浏览器 ASR 降级。
- 逐题反馈（`POST /api/sessions/:id/answers/score`）：LLM 单题评估 + 错题标记。
- 简历 / JD 押题（`POST /api/analysis/predict-questions`）。
- 流程编辑器（FlowEditor）：可视化编排面试流程。
- 前端可观测性（`web/src/lib/observability.ts`）：错误捕获 + Web Vitals 上报。
- 社区分享格式：Agent / 面经导出导入（`.ix-agent.json` / `.ix-experience.json`）。
- 面试官市场（12 个模板）与面经广场（20 条）。
- 第三方集成适配器（Obsidian Local REST API / Webhook）。

### Changed
- SSRF 防护升级为 undici `connect.lookup` 连接期 IP 校验，关闭 DNS rebinding 的 TOCTOU 窗口。
- PII 占位符随机化（8 位 hex），防止攻击者构造可预测占位符触发他人 PII 还原。
- 新增多个数据库索引（sessions / agents / evaluations / materials / providers 等）。
- 内置供应商从 4 个扩展（Anthropic / 豆包 / Kimi / 通义等图标与适配）。

### Fixed
- LLM 代理统一使用 undici fetch（此前 Node 原生 fetch 无法识别外部 Agent 的 dispatcher，导致 SSRF 防护静默失效、请求全部 fetch failed）。
- Anthropic `connect.lookup` 回调改为传地址数组（此前传单地址导致所有域名类 provider 报 "Invalid IP address"）。
- 阶段自动推进、群面调度空数组保护、Monaco 编辑器内存泄漏等。

---

Docker 部署方案现内置于本仓库 `docker/` 目录,一键 `docker compose up` 部署。
