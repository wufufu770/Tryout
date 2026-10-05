# Tryout

**A local-first mock interview trainer that scores whether your technical answers are actually correct — not just whether you speak fluently.**

本地优先的 AI 面试模拟工具：用 **808 道题的参考答案**作为客观基准，评估你的技术回答是否正确——而不只是"表达是否流畅"。

[![CI](https://github.com/wufufu770/Tryout/actions/workflows/ci.yml/badge.svg)](https://github.com/wufufu770/Tryout/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![GHCR](https://img.shields.io/badge/image-ghcr.io%2Fwufufu770%2Ftryout--server-blue)](https://github.com/wufufu770/Tryout/pkgs/container/tryout-server)

> 界面采用终端风格（深黑 + 绿色 + 等宽字体）。截图见下方「界面预览」。

## 📚 题库在线浏览（无需安装）

**427 个知识点专题页**，每页含题目、考察点、难度分布与跨题高频考点，可被搜索引擎与 AI 直接引用。

🌐 https://wufufu770.github.io/Tryout/docs/questions/

```
808 道题 · 12 个技术行业 · 5 种题型 · 3 个难度
```

> ⚠️ **本页不提供参考答案**。它用于 AI 评估技术回答的正确性，
> 公开后用户可以直接背答案，练习就失去意义了。
> 评估时参考答案由服务端注入为「满分参考示例」。

## 快速开始

```bash
git clone https://github.com/wufufu770/Tryout.git
cd Tryout/docker
cp .env.example .env        # 按需修改（Ollama 地址、CORS 等）
docker compose up -d --build
```

打开 **http://localhost:9090**。前端 Nginx + SPA 路由 + API 反代，后端在 `:3001`。

本地开发：

```bash
cd server && npm install --ignore-scripts && node index.js   # 后端 :3001
cd web && npm install && npm run dev                         # 前端 :5173
```

## 为什么和别的 AI 面试工具不同

大多数 AI 面试工具告诉你"你表达清晰、语速适中、填充词不多"。但**音调容易评，正确性不能评**——它会夸你一个根本不可扩展的系统设计"结构清晰、有信心"。

Tryout 内置 **808 道题的参考答案**，把它当作技术正确性的客观基准。

| | 多数 AI 面试工具 | Tryout |
|---|---|---|
| 反馈什么 | 表达是否流畅、语速、填充词 | **技术回答是否正确** |
| 判断依据 | 通用 LLM 主观判断 | **题库参考答案作客观基准** |
| 数据流向 | 上传到云端 | **0 字节离开本机**，可全离线跑 Ollama |
| 成本 | 订阅制，按次或按月 | **0 元**（MIT 开源） |
| 上手 | 注册账号、绑定手机号 | `docker compose up` |

## 三个数字

- **808** — 带参考答案与考察点的题库（12 个技术行业、5 种题型、3 个难度）
- **0** — 离开你本机的数据字节数（支持 Ollama 完全离线推理）
- **0 元** — 无订阅、无按次收费、无限练习

## 界面预览

> 📸 待补充：三张关键界面截图（面试会话 / 群面模拟 / 评分报告）。
> **放上截图是当前对 star 转化率影响最大的一件事** —— 纯文字 README
> 无法让人在 15 秒内判断"这值不值得我装"。
> 截完请替换本段并删除此提示。

<!-- 截图占位：请替换为真实截图（建议 1200px 宽 WebP/GIF） -->
<!-- ![面试会话](docs/screenshot-interview.png) -->
<!-- ![群面模拟](docs/screenshot-group.png) -->
<!-- ![评分报告](docs/screenshot-report.png) -->

> 📸 待补充：三张关键界面截图（面试会话 / 群面模拟 / 评分报告）。
> 放置于 `docs/`，并取消上面的注释。

## 功能特性

### 面试会话

- **5 档难度**：简单 / 普通 / 困难 / 极难 / 地狱，难度注入面试官 prompt
- **多面试官协同**：按阶段（stage）切换，模拟"技术面 → HR 面 → CEO 面"全流程
- **自定义阶段流程**：可改名、增删阶段，或套用预设模板（技术面 / 行为面 / 综合面）
- **资料上下文**：勾选简历 / JD 等资料作为面试官上下文注入
- **Monaco 代码模式 + SVG 白板**：支持技术面试现场编码

### 群面模拟

- 多面试官 + 多 AI 候选人同场，会议室可视化视图，发言者高亮脉冲
- 支持实时 / 加速两种节奏，候选人画像可定制（aggressive / calm / leader / challenger 等）
- 候选人发言由加权调度引擎决定：越久未发言权重越高，用户刚发言后 leader/challenger 更可能接话

### Agent 工作台

- **8 个内置模板**：6 个 HR（温和 / 压力型 / 外企 / 初创 / 资深总监 / 行为专家）+ 严苛技术官 + 毒舌 CEO
- 版本管理：每次改 prompt 存为新版本，可回滚
- 自定义头像（emoji / 预设 / 上传图片）、专注领域、语气、难度
- 为 Agent 绑定专属供应商（技术官用 GPT、HR 用国产模型）
- 可导入 / 导出社区分享格式（`.ix-agent.json`）

### 资料中心

- 上传 PDF / DOCX / MD / TXT，或直接粘贴文本
- 资料可"添加到面试"作为上下文注入
- 简历-JD 匹配分析（基础技能匹配 + LLM 深化）
- 4 份内置资料：使用说明 / STAR 答题指南 / 简历优化指南 / 高频技术题汇编

### 评估与成长追踪

- STAR 评估 + 6 维度能力雷达（技术深度 / 沟通表达 / 逻辑思维 / 问题解决 / 抗压能力 / 文化匹配）
- 表达能力分析：语速、填充词密度、平均句长、逻辑连接词密度
- 跨会话进步曲线、成长热力图、弱项分布
- 会话分组（如"秋招批次""某公司"）+ 分组进度归纳

### 多模型支持

- DeepSeek / OpenAI / 智谱 GLM / Ollama 本地 / Anthropic / 豆包 / Kimi / 通义 / MiniMax 等
- 主模型失败自动切换故障转移队列
- API Key 通过本地 SQLite **AES-256-GCM 加密**存储
- 无 API Key 可用 Ollama，完全免费离线

### 安全

- **SSRF 防护**：DNS 二次解析校验 + undici `connect.lookup` 连接期 IP 校验 + 3xx 阻断 + 云元数据地址拦截
- **PII 脱敏**：手机号 / 邮箱 / 身份证在调用模型前脱敏，占位符随机化防注入还原
- **访问令牌认证**（可选，默认监听 127.0.0.1）
- 日 token 预算限制

### 国际化

10 种语言：简中 / 英 / 日 / 法 / 俄 / 阿拉伯 / 印地 / 孟加拉 / 葡 / 西

> 原文此处标称「10 种」却列了 13 项(繁中 / 韩 / 德),而这三项在 `src/i18n/locales/`
> 中并无对应文件,属文档与实现不符。已按**实际实现**对齐(ISSUE-007)。
> 各语言的 key 集合由 `npm run i18n:check` 保证一致,缺 key 会让门禁变红。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS + Monaco Editor |
| 后端 | Node.js + Express |
| 数据库 | SQLite（better-sqlite3，本地文件，零配置） |
| 语音 | 本地 Whisper（@xenova/transformers）+ 浏览器 ASR 降级 |
| 部署 | Docker / Docker Compose / GHCR |
| LLM | OpenAI 兼容协议 + Anthropic 原生协议 |

## 目录结构

```
Tryout/
├── server/              # 后端
│   ├── index.js         # Express 路由
│   ├── db.js            # SQLite 数据访问层 + 幂等迁移
│   ├── seed.js          # Agent 模板 / 内置资料 / 供应商种子
│   ├── llm.js           # 多模型 LLM 代理（流式 / 故障转移 / SSRF 防护）
│   ├── auth.js          # 访问令牌认证
│   ├── crypto.js        # API Key AES-256-GCM 加密
│   ├── pii.js           # PII 脱敏与还原
│   ├── ssrf-shared.js   # SSRF 防护共享模块
│   ├── services/
│   │   ├── pdf.js       # PDF 文本提取（pdfjs-dist + 中文 CMap）
│   │   └── whisper.js   # 本地语音转写
│   └── test/            # node --test
├── web/                 # 前端
│   ├── src/pages/       # 面试 / 群面 / Agent / 资料 / 历史 / 设置
│   ├── src/components/  # 组件（MeetingRoomView / FlowEditor 等）
│   ├── src/lib/         # 群面引擎 / STAR 评估 / 上下文注入 / PII 占位符
│   ├── src/data/        # 题库（12 行业 808 题）
│   └── src/i18n/        # 10 种语言
├── docker/              # Dockerfile.server / Dockerfile.web / nginx.conf
└── .githooks/           # pre-commit（敏感文件拦截 + 语法检查）
```

## 配置

复制 `.env.example` 为 `.env` 并按需修改：

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 后端端口 | 3001 |
| `HOST` | 监听地址（局域网设为 0.0.0.0） | 127.0.0.1 |
| `DB_DIR` | 数据目录 | ./data |
| `INTERVIEWX_API_TOKEN` | 访问令牌（不设则自动生成到 `data/.api_token`） | — |
| `INTERVIEWX_MASTER_KEY` | API Key 加密主密钥 | 自动生成 |
| `OLLAMA_URL` | Ollama 地址 | http://localhost:11434/v1 |
| `LLM_TIMEOUT_MS` | LLM 请求超时 | 60000 |
| `DAILY_TOKEN_BUDGET` | 日 token 预算 | 500000 |
| `CORS_ORIGINS` | CORS 白名单（逗号分隔） | 本地开发端口 |

## 常用命令

```bash
# 后端
cd server && npm test              # node --test
# 前端
cd web && npm test                 # vitest
cd web && npm run build            # 构建
cd web && npm run export:questionbank   # 导出题库 JSON（808 题）

# 启用 pre-commit（敏感文件拦截 + JS 语法检查）
git config core.hooksPath .githooks
```

## 题库资产

题库是本项目的核心资产之一：808 道题，覆盖 12 个技术行业（后端 / 前端 / 算法 / 数据 / 产品 / 运维 / AI / 安全 / 测试 / 移动 / 项目管理 / HR），每题含参考答案、考察点、标签与预估时长。

```bash
cd web && npm run export:questionbank   # 生成 public/questionbank.json
```

导出的 JSON 同样是自定义导入格式，字段见导出文件本身。

**想参与贡献？** 补充题目或修正参考答案是最容易上手的入口——不需要读懂整个代码库，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Docker 部署

Docker 方案内置于 `docker/` 目录，镜像随 `v*` tag 自动构建到 GHCR（`ghcr.io/wufufu770/tryout-server` / `tryout-web`）。

```bash
# 直接拉取已发布镜像
docker run -d -p 3001:3001 ghcr.io/wufufu770/tryout-server:v1.1.0
```

> ⚠️ **镜像与 `main` 分支存在时间差**：GHCR 上的 `latest` / `v1.1.0` 标签对应
> 2026-08-24 的代码，而仓库主分支仍在持续改进（评估内核、题库接入、上下文治理等）。
> **想用最新代码请从源码构建**（上面的 `docker compose up --build`），
> 或等待下一次发版。

```bash
cd docker
cp .env.example .env
docker compose up -d --build
```

- 前端：http://localhost:9090（Nginx + SPA 路由 + API 反代）
- 后端：http://localhost:3001/api/health

## 贡献

欢迎贡献，尤其欢迎**题库补充与参考答案修订**。请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
