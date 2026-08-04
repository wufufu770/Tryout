# Tryout

> 终端风格的本地优先 AI 面试模拟平台

[![CI](https://github.com/wufufu770/tryout/actions/workflows/ci.yml/badge.svg)](https://github.com/wufufu770/tryout/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![GitHub stars](https://img.shields.io/github/stars/wufufu770/tryout?style=social)](https://github.com/wufufu770/tryout/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/wufufu770/tryout?style=social)](https://github.com/wufufu770/tryout/network/members)

**版本:v1.0.0**

> 如果这个项目对你有帮助,请点个 ⭐ Star 支持一下,谢谢!

Tryout 是一个本地优先(Local-First)的 AI 面试模拟工具。所有数据存储在你自己的机器上,不依赖云端账号。它支持多 Agent 协同面试、群面模拟、STAR 评估和成长追踪,界面采用终端风格(深黑 + 绿色 + 等宽字体)。

## 功能特性

### 面试会话
- **5 档难度**:简单 / 普通 / 困难 / 极难 / 地狱,难度注入面试官 prompt
- **多面试官协同**:可挂载多个 Agent,按阶段(stage)切换,模拟"技术面 → HR 面 → CEO 面"全流程
- **自定义阶段流程**:可改名、增删阶段,或套用预设模板(技术面 / 行为面 / 综合面)
- **资料上下文**:勾选简历 / JD 等资料作为面试上下文,面试官会基于资料提问
- **面试方向**:支持输入补充文本,注入系统提示

### 群面模拟
- 多面试官 + 多 AI 候选人同场,会议室可视化视图,发言者高亮脉冲
- 支持实时 / 加速两种节奏,候选人画像可定制(aggressive / calm / leader 等)
- 点击任意气泡可指定回复,支持 @ 某位发言者

### Agent 工作台
- **8 个内置模板**:6 个 HR(温和 / 压力型 / 外企 / 初创 / 资深总监 / 行为专家)+ 严苛技术官 + 毒舌 CEO
- 支持版本管理:每次改 prompt 存为新版本,可回滚
- 自定义头像(emoji / 预设 / 上传图片)、专注领域、语气、难度
- 可为 Agent 绑定专属供应商(如技术官用 GPT,HR 用国产模型)

### 资料中心
- 上传 PDF / DOCX / MD / TXT,或直接粘贴文本
- 资料可"添加到面试",作为面试官的上下文注入
- **4 份内置资料**:使用说明 / STAR 法则答题指南 / 简历优化指南 / 高频技术面试题汇编

### 历史记录
- 所有会话自动存档,按时间倒序排列
- 支持会话分组(如"秋招批次""某公司"),生成分组进度归纳
- 单场可生成 STAR 评估;整场可生成综合回顾(优势 / 不足 / 改进 / 下次重点)
- 跨会话进步曲线:追踪整体评分趋势和弱项分布

### 多模型支持
- 内置 4 个供应商:DeepSeek / OpenAI / 智谱 GLM / Ollama 本地
- 支持模型热切换,API Key 通过本地 SQLite 加密存储
- 没有 API Key?用 Ollama 本地模型,完全免费离线

## 快速开始

### 环境要求

- **Node.js v20+**(必需,用于运行后端和构建前端)
- **npm**(随 Node.js 一起安装)

### 安装 Node.js

如果尚未安装 Node.js,请从以下任一途径安装:

- **官方下载**:[https://nodejs.org/](https://nodejs.org/)(推荐 LTS 版本)
- **Windows(winget)**:`winget install OpenJS.NodeJS.LTS`
- **macOS(Homebrew)**:`brew install node`
- **Linux(nvm)**:`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && nvm install --lts`

安装完成后验证:
```bash
node --version   # 应输出 v20.x.x 或更高
npm --version
```

### 启动方式

#### 方式一:一键启动脚本(Windows)

```powershell
.\start.ps1
```

脚本会自动完成:
1. 检测 Node.js 是否已安装(未安装则提示)
2. 安装 server 和 web 依赖(首次运行)
3. 下载 better-sqlite3 预编译二进制(首次运行,跳过 C++ 编译)
4. 启动后端 `http://localhost:3001` + 前端 `http://localhost:5173`

后续运行直接启动,无需等待。

#### 方式二:手动启动(所有平台)

```bash
# 安装后端依赖
cd server
npm install --ignore-scripts

# 安装前端依赖
cd ../web
npm install

# 分别在两个终端启动
cd ../server && node index.js     # 后端
cd ../web && npm run dev          # 前端
```

启动后访问 `http://localhost:5173`。

> **Windows 用户注意**:better-sqlite3 需要 C++ 编译工具链,或使用预编译二进制。start.ps1 会自动下载预编译二进制;手动安装若失败,可从 [better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases) 手动下载对应版本。

### 配置模型

1. 进入「设置」页
2. 在供应商卡片填入 API Key(支持 DeepSeek / OpenAI / 智谱 GLM / Ollama)
3. 点"设为当前",底部状态栏会显示当前模型

## 快捷键

| 快捷键 | 功能 |
|---|---|
| Ctrl+Shift+N | 新建面试会话 |
| Ctrl+Enter | 发送消息 |
| Ctrl+M | 切换模型 |

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS |
| 后端 | Node.js + Express + better-sqlite3 |
| 数据库 | SQLite(本地文件,零配置) |
| 部署 | 本地 Node.js |
| LLM | DeepSeek / OpenAI / 智谱 GLM / Ollama(OpenAI 兼容协议) |

## 目录结构

```
Tryout/
├── server/              # 后端
│   ├── db.js            # SQLite 数据访问层
│   ├── index.js         # Express 路由 + 种子注入
│   ├── seed.js          # 6 HR 模板 + 4 内置资料 + 4 供应商
│   ├── llm.js           # 多模型 LLM 适配器
│   ├── auth.js          # 访问令牌认证
│   ├── crypto.js        # API Key AES-256-GCM 加密
│   ├── pii.js           # PII 脱敏(手机号/邮箱/身份证)
│   ├── ssrf-shared.js   # SSRF 防护(IP 白名单/DNS 校验)
│   └── package.json
├── web/                 # 前端
│   ├── src/
│   │   ├── pages/       # 10 个页面(面试/群面/Agent/资料/历史/设置等)
│   │   ├── components/  # 组件(IdeLayout/MeetingRoomView 等)
│   │   ├── lib/         # 工具库(群面引擎/STAR 评估/上下文注入)
│   │   ├── stores/      # Zustand 状态管理
│   │   ├── i18n/        # 10 种语言国际化
│   │   ├── index.css    # 终端风格样式
│   │   └── shared.ts    # 难度配置 + 共享工具
│   ├── tailwind.config.js  # 终端配色系统
│   └── vite.config.ts      # Vite 配置(proxy /api → 3001)
├── .github/workflows/   # CI(GitHub Actions)
├── .githooks/           # Git pre-commit hook
├── .env.example         # 环境变量示例
├── start.ps1            # Windows 一键启动脚本
└── README.md
```

## 数据与隐私

- **本地优先**:所有数据存在本地 `data/` 目录,不上传任何外部服务器
- **PII 脱敏**:消息和资料入库前自动脱敏(手机号 / 邮箱 / 身份证)
- **直连模型**:LLM 调用直接从浏览器 → 后端 → 模型供应商,不经过第三方
- **清理数据**:可在设置页删除会话 / 资料,或直接删除 `data/` 目录重置

## 终端风格

界面采用终端风格设计:

- **配色**:GitHub Dark 深黑背景(`#0d1117`)+ 终端绿(`#7ee787`)
- **字体**:全站等宽字体(JetBrains Mono / Cascadia Code)
- **消息**:终端流式样式
  - AI 消息:`●` 前缀 + 绿色左色条 + 无圆角
  - 用户消息:`>` 前缀 + 绿字 + 淡绿背景
  - 系统消息:`#` 前缀 + 灰色斜体
- **光标**:终端方块 `█` + blink 动画
- **状态栏**:黑底 + 绿色高亮点
- **圆角**:全站无圆角(仅头像保留 `rounded-full`)

## 开发

```bash
# 安装依赖
cd server && npm install --ignore-scripts
cd ../web && npm install

# 开发模式(分别开两个终端)
cd server && npm run dev          # 后端(--watch 热重载)
cd web && npm run dev             # 前端(Vite HMR)

# 运行测试
cd server && npm test             # 后端测试
cd web && npm test                # 前端测试

# 构建前端
cd web && npm run build
```

## 配置

复制 `.env.example` 为 `.env` 并按需修改:

- `PORT`:后端监听端口(默认 3001)
- `HOST`:监听地址(默认 127.0.0.1)
- `DB_DIR`:数据目录(默认 ./data)
- `INTERVIEWX_API_TOKEN`:访问令牌(不设则首次启动自动生成)
- `OLLAMA_URL`:Ollama 本地模型地址(默认 http://localhost:11434/v1)
- `DAILY_TOKEN_BUDGET`:日 token 预算(默认 50 万)

详见 `.env.example` 注释。

## License

[MIT](LICENSE)
