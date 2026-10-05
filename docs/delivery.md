# Tryout 交付文档

> 本地优先的 AI 面试模拟平台 · MIT 开源
> 对应版本：v1.1.0 + W1–W5 全部改进

---

## 1. 五分钟理解 Tryout

**Tryout 解决什么问题**

多数 AI 面试工具告诉你"你表达清晰、语速适中、填充词不多"，但**音调容易评，正确性不能评**。它会夸一个根本不可扩展的系统设计"结构清晰、有信心"。

Tryout 内置 **808 道题的参考答案**（V7 抽样核对 24/24 技术正确），把它当作技术正确性的客观基准——**评你答得对不对，而不只是答得流畅**。

**三句话**

- 808 道题，覆盖 12 个技术行业，参考答案只用于评估、不对外公开
- 数据 0 字节离开本机，可全离线跑 Ollama
- 多 Agent 协同面试 + 群面模拟 + 现场评估反馈

---

## 2. 构建

### 方式一：Docker（推荐）

前置：Docker + Docker Compose

```bash
git clone https://github.com/wufufu770/Tryout.git
cd Tryout/docker
cp .env.example .env      # 按需修改(Ollama 地址、CORS 等)
docker compose up -d --build
```

打开 **http://localhost:9090**

镜像也自动发布到 GHCR：`ghcr.io/wufufu770/tryout-server` / `tryout-web`

### 方式二：本地开发

前置：Node.js ≥ 20、npm

```bash
git clone https://github.com/wufufu770/Tryout.git
cd Tryout

# 后端 → http://localhost:3001
cd server && npm install --ignore-scripts && node index.js

# 前端 → http://localhost:5173（另开终端）
cd web && npm install && npm run dev
```

> Windows 用户直接运行 `.\start.ps1` 即可（自动装依赖、下载 better-sqlite3 预编译包、启动两端）。

---

## 3. 配置

首次启动后进入「设置」页填 API Key，支持 DeepSeek / OpenAI / 智谱 GLM / Ollama 等。

**没有 API Key 也能用**：装 [Ollama](https://ollama.com/) 后拉一个模型，完全离线运行。

高级配置见 `.env.example`，常用项：

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 后端端口 | 3001 |
| `HOST` | 监听地址 | 127.0.0.1（仅本机） |
| `DB_DIR` | 数据目录 | ./data |
| `INTERVIEWX_API_TOKEN` | 访问令牌（不设则自动生成） | — |
| `OLLAMA_URL` | Ollama 地址 | http://localhost:11434/v1 |
| `DAILY_TOKEN_BUDGET` | 日 token 预算 | 500000 |

---

## 4. 使用

### 基本流程

1. **配置会话** — 选模型、选**目标行业**（决定从题库抽哪一档题）、填岗位名、调难度
2. **添加资料** — 上传简历 / JD（支持 PDF、DOCX、MD、TXT）
3. **开面** — 选面试官 Agent（可多 Agent 协同），开始
4. **现场反馈** — 每 2 轮出一次评估，弱项 + 锚点判定 + 引用的原文依据
5. **复盘** — 历史页看完整评估、进步曲线、能力雷达

### 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+Shift+N` | 新建面试会话 |
| `Ctrl+Enter` | 发送消息 |
| `Ctrl+M` | 切换模型 |

---

## 5. 导入题库

### 格式：TSV（制表符分隔）

```
单词 <TAB> 音标 <TAB> 释义
单词 <TAB> 释义            ← 两列也合法
```

**转制表符**：Excel「数据 → 从文本/CSV」→ 分隔符选 `Tab`；或用 `sed` / `awk`。
**注意**：必须是 Tab 键，不是空格。

### 导出内置题库

```bash
cd web && npm run export:questionbank
```

产出两份内容一致的 JSON：
- `server/data/questionbank.json` — 服务端权威副本（应用运行需要）
- `web/public/questionbank.json` — 前端兜底

导出前会做完整性校验：字段完整性、id 唯一性、`keyPoints` 非空，不通过即中止。

### 生成公开内容页

```bash
cd web && npm run gen:pages
```

把题库按知识点聚合成 **428 个静态页**（427 个知识点页 + 索引），输出到 `web/public/docs/questions/`。
含 schema.org FAQPage 结构化数据，可被搜索引擎与 AI 直接引用。

> 🔒 内容页**只输出题目与考察点，绝不输出 `referenceAnswer`**。它用于评估技术正确性，
> 公开后用户可以直接背答案，练习就失去意义了。

### 自定义题库

按上述 TSV 格式编写，替换 `data/questionbank-src/*.ts` 中的数据文件，然后：

```bash
cd web && npm run export:questionbank && npm run gen:pages
```

数据结构见 `web/src/data/questionMeta.ts`。

---

## 6. 门禁与测试

```bash
./build.sh all        # 全量门禁
./build.sh static     # 语法 + 类型检查
./build.sh unit       # 单元测试
./build.sh e2e        # 端到端（自动准备前置服务）
./build.sh docker     # 镜像构建（需 Docker）
```

**当前状态**

| 项 | 结果 |
|---|---|
| `./build.sh all` | **11 通过 / 0 失败 / 1 跳过**（跳过项：Docker 未安装） |
| 后端单测 | 88/88 |
| 前端单测 | 369/369 |
| E2E | 5 个全绿 |

### E2E 覆盖

| 脚本 | 验证什么 |
|---|---|
| `e2e-pii-mapping` | 流式响应的 PII 映射真实出现在 SSE 中 |
| `e2e-session-position` | 目标岗位落库 + 已问题目去重 + 参考答案不泄漏 |
| `e2e-isolated-scoring` | **ADR-001**：6 个独立请求、零跨维度泄漏 |
| `e2e-exam-focus` | 题库真正影响提问、不泄题 |
| `e2e-voice-smoke` | 语音闭环 |

---

## 7. 目录结构

```
Tryout/
├── server/                # Express 后端
│   ├── index.js           # 路由
│   ├── db.js              # SQLite + 幂等迁移
│   ├── llm.js             # LLM 代理（流式/故障转移/SSRF 防护）
│   ├── services/
│   │   ├── pdf.js         # PDF 解析（中文 CMap）
│   │   ├── whisper.js     # 本地语音转写
│   │   └── questionBank.js# 题库服务端读取
│   └── data/questionbank.json   # 题库权威副本（需执行导出生成）
├── web/
│   ├── src/lib/
│   │   ├── evaluation/    # 评估内核（评分引擎/锚定/一致性度量）
│   │   ├── questionSelector.ts   # 题库检索
│   │   ├── questionPlanner.ts    # 提问编排
│   │   ├── contextWindow.ts      # 上下文治理
│   │   └── piiPlaceholder.ts     # PII 占位符
│   ├── src/data/questionMeta.ts   # 题库元数据（行业/题型/难度，不含题库内容）
│   └── public/docs/questions/      # 生成的内容页（428 个）
├── data/questionbank-src/         # 题库数据源（13 个文件，在前端源码树之外）
├── docker/
├── build.sh               # 门禁
└── STATE.md               # 迭代状态
```

---

## 8. 设计决策（为什么这样做）

几处不显然的设计，都有理由：

| 决策 | 理由 |
|---|---|
| **每个维度独立评分，不合并调用** | 合并评分会有系统性维度干扰（联合评估一致率仅 36%），且总分由模型直接给会重新引入锚定偏见 |
| **总分由 6 个独立分数推导，不由模型给** | 模型给的总分是黑盒且不可复算；推导出来的总分可解释、可测试 |
| **题库只给模型「考察方向」，不给题面** | 给了题面模型会照读，用户背得出题库，练习失去意义 |
| **答案引用标为「满分参考示例」** | 标为"唯一正确答案"会扼杀一题多解的正确答案 |
| **题库只在服务端持有 `referenceAnswer`** | 前端拿到就等于发答案；内容页也刻意不输出 |
| **不展示「同岗位平均」基准** | 我们没有任何真实面试数据，那个数字是编的。改为用户自己的历史中位数 |
| **不给「表达综合分」** | 权重是拍脑袋的，四类性质不同的指标加权成一个数字是伪精度 |
| **上下文按行截断并显式声明** | 硬切会劈开半句让模型误判；不声明会让模型以为看到的是全文 |

---

## 9. 已知限制

| 项 | 说明 |
|---|---|
| **V6 一致率未实测** | 独立评分的跨运行一致性（目标 ≥85%）尚未在真实 LLM 上测量。测量脚本已就绪（`npm run eval:ab:real`），需配置 API Key |
| **评估成本较高** | 单次完整评估 = 6 个 LLM 调用（维度独立评分的必然代价）。面试中每 2 轮只评 2 个维度以控制成本 |
| **进度分组无 PDF 导入** | 会话分组目前手动创建 |
| **实时语音未实现** | 当前是"录音 → 转写 → 文字回复"，不是实时语音对话。纯本地实时链路需重做 ASR 层 |
| **i18n 部分语言落后** | 10 种语言，但多数只覆盖核心界面 |
| **进度数据存在本地目录** | `data/` 未加密（API Key 已 AES-256-GCM 加密） |

---

## 10. 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。最友好的入口是**题库贡献**——补题、修答案、加标签，不需要读懂整个代码库。

**建议给参考答案遵守**：控制在 500 字符内；coding 题用「判分要点 + 关键片段」而非完整实现（226 题超长问题已记录在 [V7 报告](docs/v7-question-bank-audit.md)）。

---

## 11. 许可

[MIT](LICENSE)
