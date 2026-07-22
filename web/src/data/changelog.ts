// 项目更新日志:按时间倒序排列
// type 语义:major=重大版本 / feature=新功能 / fix=缺陷修复 / refactor=重构优化

export type ChangelogType = "major" | "feature" | "fix" | "refactor";

export interface ChangelogEntry {
  version: string;
  date: string; // ISO 日期 YYYY-MM-DD
  type: ChangelogType;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "v2.1",
    date: "2026-07-17",
    type: "feature",
    title: "成长体系升级 · 全场景覆盖",
    items: [
      "多主题系统:GitHub Dark / Light / 暖色 / 赛博朋克一键切换",
      "InfoTip 提示组件:关键操作提供上下文帮助说明",
      "面试场景剧本:12 个预设剧本(大厂/外企/校招/CEO 终面)即点即用",
      "面试报告导出:Markdown / JSON / PDF 三种格式一键导出",
      "成长热力图:按日历可视化面试频次与得分趋势",
      "语音对话系统:TTS 朗读 + ASR 语音输入,真实模拟面试节奏",
      "面试官市场:12 个精选面试官模板,一键导入工作台",
      "Langflow 流程编辑器:可视化编排面试流程与多 Agent 协同",
      "第三方集成:OpenAI / Anthropic / 国产大模型统一接入管理",
      "复盘群聊:多 Agent 在群组中协同点评候选人表现",
      "面经广场:社区化面经分享与评论互动",
    ],
  },
  {
    version: "v2.0",
    date: "2026-07-15",
    type: "major",
    title: "架构重塑 · Docker 化发布",
    items: [
      "Docker 重构:前后端 + SQLite 一键容器化部署",
      "IDE 终端视觉风格:VSCode / Cursor 风格界面与等宽字体",
      "多 Agent 协同:支持多面试官同台提问与交叉追问",
      "群面模拟:Panel 面试场景,3 位面试官协同评估",
      "整场回顾评价:会话结束后生成综合复盘报告",
      "会话分组:按场景/公司/时间维度组织历史会话",
      "Agent 版本管理:面试官提示词版本快照与回滚",
    ],
  },
  {
    version: "v1.x",
    date: "2026-06-30",
    type: "feature",
    title: "奠基版本 · 核心面试能力",
    items: [
      "基础面试会话:多轮对话 + 流式输出 + 上下文记忆",
      "STAR 评估:基于 STAR 法则的 4 维度量化打分",
      "弱项分析:从历史会话挖掘候选人薄弱知识点",
      "供应商管理:多 LLM 供应商配置 + 故障转移队列",
      "资料上传:简历 / JD / 资料文档上传并注入面试上下文",
    ],
  },
];
