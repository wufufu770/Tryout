import type { SessionDifficulty } from "@/types/session";

export const cn = (...args: any[]) => args.filter(Boolean).join(" ");

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export const FLOW_TEMPLATES: Record<string, { name: string; stages: string[] }> = {
  tech: { name: "技术面试流", stages: ["自我介绍", "项目提问", "代码题", "系统设计", "反问环节"] },
  behavioral: { name: "行为面试流", stages: ["自我介绍", "团队协作", "冲突处理", "领导力", "反问环节"] },
  mixed: { name: "综合面试流", stages: ["自我介绍", "项目深挖", "技术追问", "行为问题", "反问环节"] },
};

// v5:会话难度档位配置
// v6:新增 icon(单图标)和 color,替代重复星级显示
export interface DifficultyLevel {
  value: string;
  label: string;
  stars: number;
  icon: string; // lucide 图标名
  color: string; // 主色(hex)
  scenario: string;
  features: string;
  prompt: string;
}

export const DIFFICULTY_LEVELS: DifficultyLevel[] = [
  {
    value: "easy",
    label: "简单",
    stars: 1,
    icon: "Leaf",
    color: "var(--ide-success)",
    scenario: "校招实习生面试 / 转岗试水",
    features: "基础概念为主,1-2 个应用题",
    prompt: `# 面试整体基调(简单 · 校招实习生面试)
- 题目以基础概念为主,不超过 2 个应用题
- 候选人若说"我需要想想",给予 10 秒思考时间
- 每题最多追问 1 次,答错时给予引导而非直接否定
- 不考察深度原理与系统设计
- 语气友善,鼓励为主`,
  },
  {
    value: "normal",
    label: "普通",
    stars: 2,
    icon: "CircleCheck",
    color: "var(--ide-info)",
    scenario: "应届校招 / 初级岗",
    features: "概念+应用,1 个项目深挖",
    prompt: `# 面试整体基调(普通 · 应届校招 / 初级岗)
- 题目覆盖基础概念与简单应用
- 选择 1 个项目做适度深挖
- 每题最多追问 2 次
- 答错时点出问题但不刻意施压
- 语气平和、专业`,
  },
  {
    value: "hard",
    label: "困难",
    stars: 3,
    icon: "Flame",
    color: "var(--ide-warning)",
    scenario: "3-5 年社招",
    features: "深度原理 + 边界条件 + 系统设计",
    prompt: `# 面试整体基调(困难 · 3-5 年社招)
- 题目涉及深度原理、边界条件与系统设计
- 每题至少追问 3 次,挖底层实现
- 候选人若回避,直接追问不放过
- 语气专业、严谨,不寒暄`,
  },
  {
    value: "extreme",
    label: "极难",
    stars: 4,
    icon: "Zap",
    color: "var(--ide-warning)",
    scenario: "资深岗 / 大厂终面",
    features: "反直觉问题 + 容量估算 + 架构权衡",
    prompt: `# 面试整体基调(极难 · 资深岗 / 大厂终面)
- 题目反直觉,需做容量估算与架构权衡
- 每题连续追问 4 次,逼出知识边界
- 主动质疑候选人答案,要求其论证
- 节奏紧凑,不给过多思考时间
- 语气直接、挑战性强`,
  },
  {
    value: "hell",
    label: "地狱",
    stars: 5,
    icon: "Skull",
    color: "var(--ide-danger)",
    scenario: "压力面 / 技术委员会答辩",
    features: "刁钻挑刺 + 故意质疑 + 限时压力 + 跨领域突袭",
    prompt: `# 面试整体基调(地狱 · 压力面试 / 技术委员会答辩)
- 题目刁钻、反直觉,故意挑刺
- 候选人每个回答都要找出漏洞继续追问,至少 4 轮连环追问
- 故意否定候选人正确答案,考察其能否有理有据地反驳
- 跨领域突袭:从当前话题突然切换到不相关领域
- 限时压力:每题暗示"时间有限,请简短回答"
- 节奏紧凑,不给思考停顿
- 语气高压、直接、不留情面`,
  },
];

export function getDifficultyConfig(value: string): DifficultyLevel {
  return DIFFICULTY_LEVELS.find((d) => d.value === value) || DIFFICULTY_LEVELS[1];
}

// v7:面试场景剧本(方案 1)
// 第一性原理:剧本 = 预设配置快照(title + difficulty + flow + agents + focusDirection)
// 数据为前端静态常量,无需后端改动,点击即应用配置
export interface InterviewScenario {
  id: string;
  title: string;
  category: "tech" | "hr" | "behavioral" | "group" | "campus" | "senior" | "startup" | "ceo";
  difficulty: SessionDifficulty; // 编译期校验,避免非法值静默降级
  duration: string; // 预计时长
  agentMode: "single" | "multi";
  agentIds: string[]; // 引用 seed.js 中的 agentId
  flow: "tech" | "behavioral" | "mixed" | "custom"; // 编译期校验
  customStages?: string[]; // flow=custom 时必填,运行时校验非空
  focusDirection: string;
  topic: string; // 场景主题(展示用)
  typicalQuestions: string[]; // 典型问题(展示给用户参考)
  description: string;
}

export const INTERVIEW_SCENARIOS: InterviewScenario[] = [
  {
    id: "bytedance-backend",
    title: "字节后端技术面",
    category: "tech",
    difficulty: "extreme",
    duration: "60min",
    agentMode: "single",
    agentIds: ["tpl_tech_strict"],
    flow: "tech",
    focusDirection: "Go/Java 高并发、分布式系统、中间件原理、MySQL 调优",
    topic: "字节跳动后端工程师社招技术面",
    typicalQuestions: [
      "Go GMP 调度模型与协程切换开销",
      "Redis 主从复制与哨兵机制",
      "设计一个支持亿级 DAU 的消息推送系统",
    ],
    description: "字节风格技术深挖,追问底层实现与边界条件,适合 3-5 年后端工程师备战",
  },
  {
    id: "ali-hr-behavioral",
    title: "阿里 HR 行为面",
    category: "hr",
    difficulty: "hard",
    duration: "30min",
    agentMode: "single",
    agentIds: ["tpl_hr_pressure"],
    flow: "behavioral",
    focusDirection: "阿里六脉神剑价值观、项目协作、成长复盘",
    topic: "阿里巴巴 HRG 价值观与行为面试",
    typicalQuestions: [
      "讲一个你主动承担超出职责的事情",
      "项目中遇到的最大冲突如何解决",
      "你如何看待客户第一",
    ],
    description: "阿里 HRG 风格,围绕价值观与行为案例展开,语气平和专业",
  },
  {
    id: "foreign-competency",
    title: "外企胜任力面",
    category: "behavioral",
    difficulty: "normal",
    duration: "45min",
    agentMode: "single",
    agentIds: ["tpl_hr_foreign"],
    flow: "behavioral",
    focusDirection: "Leadership / Teamwork / Communication / Problem Solving",
    topic: "外企(微软/谷歌/亚马逊)胜任力面试",
    typicalQuestions: [
      "Tell me about a time you led a team through ambiguity.",
      "Describe a situation where you had to influence without authority.",
      "Share an example of a failed project and what you learned.",
    ],
    description: "STAR 法则驱动的英文胜任力面试,适合外企 SDE/PM 候选人",
  },
  {
    id: "pressure-challenge",
    title: "压力面挑战",
    category: "behavioral",
    difficulty: "hell",
    duration: "30min",
    agentMode: "single",
    agentIds: ["tpl_hr_pressure"],
    flow: "mixed",
    focusDirection: "抗压能力、临场应变、自我认知",
    topic: "高压压力面试(咨询/投行/管培生)",
    typicalQuestions: [
      "你觉得自己最大的失败是什么,为什么",
      "如果我说你不适合这个岗位,你怎么看",
      "用 30 秒说服我录用你",
    ],
    description: "压力型 HR 连环追问,故意质疑与否定,考察抗压与应变",
  },
  {
    id: "group-panel-6",
    title: "群面模拟(多面试官)",
    category: "group",
    difficulty: "hard",
    duration: "60min",
    agentMode: "multi",
    agentIds: ["tpl_hr_senior", "tpl_tech_strict", "tpl_ceo_sharp"],
    flow: "mixed",
    focusDirection: "综合评估:技术深度 + 商业判断 + 文化匹配",
    topic: "多面试官 Panel 面试(资深岗终面)",
    typicalQuestions: [
      "HR 总监:请用 2 分钟做自我介绍",
      "技术官:你刚才提到的架构,如何做容量估算",
      "CEO:如果资源只有一半,你怎么取舍",
    ],
    description: "3 位面试官协同提问,模拟大厂 Panel 终面,考察多维能力",
  },
  {
    id: "campus-intern",
    title: "校招实习面试",
    category: "campus",
    difficulty: "easy",
    duration: "30min",
    agentMode: "single",
    agentIds: ["tpl_tech_strict"],
    flow: "tech",
    focusDirection: "基础概念、项目经历、学习意愿",
    topic: "校招实习生面试(应届/实习)",
    typicalQuestions: [
      "介绍一下你做过的一个项目",
      "HTTP 与 HTTPS 的区别",
      "你最近在学什么新技术",
    ],
    description: "友善鼓励风格,基础概念为主,适合首次面试试水",
  },
  {
    id: "senior-social",
    title: "社招高级岗",
    category: "senior",
    difficulty: "extreme",
    duration: "75min",
    agentMode: "multi",
    agentIds: ["tpl_hr_senior", "tpl_tech_strict"],
    flow: "mixed",
    focusDirection: "架构设计、技术决策、团队管理、业务理解",
    topic: "资深工程师/架构师社招面试",
    typicalQuestions: [
      "HR 总监:你带领过的最大团队规模与你的技术决策权",
      "技术官:设计一个支持 10 万 QPS 的限流系统",
      "技术官:你做过的最复杂的技术决策是什么",
    ],
    description: "HR 总监 + 严苛技术官双面,资深岗必经之路,考察架构与领导力",
  },
  {
    id: "startup-fullstack",
    title: "创业公司全栈面",
    category: "startup",
    difficulty: "normal",
    duration: "45min",
    agentMode: "single",
    agentIds: ["tpl_hr_startup"],
    flow: "tech",
    focusDirection: "全栈能力、快速落地、owner 意识、抗压",
    topic: "创业公司全栈工程师面试",
    typicalQuestions: [
      "你独立负责过从 0 到 1 的项目吗",
      "前后端如何选型,为什么",
      "如果只有你一个人,怎么排期",
    ],
    description: "初创公司风格,务实高效,考察独立交付与 owner 意识",
  },
  {
    id: "resume-deepdive",
    title: "简历深挖面",
    category: "tech",
    difficulty: "hard",
    duration: "45min",
    agentMode: "single",
    agentIds: ["tpl_tech_strict"],
    flow: "mixed",
    focusDirection: "项目细节、技术选型理由、遇到的坑与解决方案",
    topic: "简历项目深度追问面试",
    typicalQuestions: [
      "这个项目你具体负责哪部分",
      "为什么选这个技术方案,对比过哪些方案",
      "遇到的最大技术挑战是什么,怎么解决的",
    ],
    description: "严苛技术官逐行追问简历,识别简历水分,备战项目深挖",
  },
  {
    id: "system-design",
    title: "系统设计面",
    category: "tech",
    difficulty: "extreme",
    duration: "60min",
    agentMode: "single",
    agentIds: ["tpl_tech_strict"],
    flow: "custom",
    customStages: ["需求澄清", "容量估算", "高层设计", "详细设计", "扩展与容灾", "反问环节"],
    focusDirection: "分布式系统设计、容量估算、 tradeoff 分析",
    topic: "系统设计面试(资深/架构岗)",
    typicalQuestions: [
      "设计一个短链服务",
      "设计一个 Twitter/微博 feed 流",
      "设计一个分布式消息队列",
    ],
    description: "系统设计专用流程,从需求到容灾全链路考察,适合架构岗备战",
  },
  {
    id: "career-change",
    title: "转行面试",
    category: "behavioral",
    difficulty: "normal",
    duration: "40min",
    agentMode: "single",
    agentIds: ["tpl_hr_behavior"],
    flow: "behavioral",
    focusDirection: "转行动机、可迁移能力、学习能力、职业规划",
    topic: "跨行业/跨岗位转行面试",
    typicalQuestions: [
      "为什么想转行,这个决定考虑了多久",
      "你之前的能力如何迁移到新岗位",
      "你打算如何补齐新领域的知识",
    ],
    description: "行为面试专家风格,深挖转行动机与适配性,适合跨行候选人",
  },
  {
    id: "ceo-final",
    title: "终面 CEO 问答",
    category: "ceo",
    difficulty: "extreme",
    duration: "30min",
    agentMode: "single",
    agentIds: ["tpl_ceo_sharp"],
    flow: "mixed",
    focusDirection: "商业理解、战略思维、文化匹配、个人特质",
    topic: "创业公司/大厂终面 CEO 问答",
    typicalQuestions: [
      "你觉得我们公司最大的问题是什么",
      "如果给你无限资源,你会做什么",
      "三年后你希望自己在哪里",
    ],
    description: "毒舌 CEO 直击灵魂的提问,考察商业嗅觉与文化匹配度",
  },
  {
    id: "bilingual-mixed",
    title: "外企中英混合面试",
    category: "senior",
    difficulty: "hard",
    duration: "45min",
    agentMode: "single",
    agentIds: ["tpl_tech_strict"],
    flow: "mixed",
    focusDirection: "中英文交替提问,模拟外企/跨国企业面试场景",
    topic: "外企面试中常见的中英文混合提问,考察双语沟通能力",
    typicalQuestions: [
      "Please introduce yourself briefly. (请简短自我介绍)",
      "Walk me through your most challenging project. (讲一下你最有挑战的项目)",
      "你为什么想加入我们公司?(Why do you want to join us?)",
      "Describe a time when you had a conflict with your coworker. (讲一次与同事的冲突)",
      "讲一下你最自豪的技术成就。(Tell me about your proudest technical achievement.)",
      "How do you handle tight deadlines and pressure? (你如何应对紧迫的截止日期和压力?)",
      "你对我们团队的了解是什么?你希望自己在这里做什么?(What do you know about our team and what role do you see yourself playing?)",
      "Tell me about a time you failed. What did you learn? (讲一次你失败的经历,你学到了什么?)",
      "你在过去的项目中遇到的最大技术难题是什么?如何解决的?(What was the biggest technical challenge you faced, and how did you solve it?)",
      "Where do you see yourself in 5 years? (你 5 年后想成为什么样的人?)",
      "Do you have any questions for us? (你有什么问题要问我们吗?)",
    ],
    description: "适合面试外企或跨国企业的候选人,面试官会中英文交替提问,模拟真实外企面试场景。考察双语沟通能力、跨文化协作、外企常见行为面试题(STAR/Amazon LP/Google Googleyness 等),适合 3-7 年经验的中高级工程师/PM/QA 备战 Microsoft/Google/Amazon/Meta 等外企面试。",
  },
];

export function getScenarioById(id: string): InterviewScenario | undefined {
  return INTERVIEW_SCENARIOS.find((s) => s.id === id);
}

export const STAR_PROMPT = `请分析以下用户回答,基于 STAR 法则进行评估。

用户问题:{{question}}
用户回答:{{answer}}

请严格输出以下 JSON 格式(不要输出其他内容):
{
  "dimensions": [
    {"dimensionName": "Situation", "score": 1-5, "comment": "情境描述是否清晰具体"},
    {"dimensionName": "Task", "score": 1-5, "comment": "任务目标是否明确"},
    {"dimensionName": "Action", "score": 1-5, "comment": "行动步骤是否详实有逻辑"},
    {"dimensionName": "Result", "score": 1-5, "comment": "结果是否量化且有影响力"}
  ],
  "overallScore": 7.5,
  "report": "整体评价...",
  "improvementAdvice": "具体改进建议...",
  "betterAnswerSample": "优化后的回答示例..."
}`;

// === 全局 Toast 工具(零依赖,基于 CustomEvent) ===
// 任何地方可调用 toast(msg) / toastError(msg),无需 prop drilling
// 顶层组件(App.tsx)监听 "app:toast" 事件并渲染
export type ToastKind = "info" | "success" | "error" | "warning";
export interface ToastEvent {
  id: number;
  message: string;
  kind: ToastKind;
}
let _toastSeq = 0;
export function toast(message: string, kind: ToastKind = "info") {
  const ev: ToastEvent = { id: ++_toastSeq, message, kind };
  window.dispatchEvent(new CustomEvent<ToastEvent>("app:toast", { detail: ev }));
}
export const toastError = (msg: string) => toast(msg, "error");
export const toastSuccess = (msg: string) => toast(msg, "success");
export const toastWarning = (msg: string) => toast(msg, "warning");
