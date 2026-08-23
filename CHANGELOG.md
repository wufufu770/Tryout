# Changelog

本项目所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed
- Docker 部署方案并入本仓库 `docker/` 目录（Dockerfile.server / Dockerfile.web / docker-compose.yml / nginx.conf），原独立仓库 interviewx-docker 废弃并重定向；镜像名由 tryout-server/tryout-web 统一为 interviewx-server/interviewx-web。
- CI 新增 docker-build job（构建两个镜像验证）。
- 修正 CHANGELOG 日期年份笔误（2025 → 2026，仓库实际创建于 2026-07-22）。

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

---

Docker 部署方案现内置于本仓库 `docker/` 目录,一键 `docker compose up` 部署。
