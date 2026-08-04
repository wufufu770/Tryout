// 内置 Agent 模板注入
import { listAgents, createAgent, listProviders, createProvider, updateProvider, listMaterials, createMaterial } from "./db.js";

export const DEFAULT_AGENT_TEMPLATES = [
  {
    agentId: "tpl_hr_gentle",
    name: "温和 HR",
    avatar: "👩‍💼",
    role: "hr",
    isTemplate: true,
    tone: "gentle",
    focusAreas: ["沟通能力", "团队协作", "职业规划"],
    difficulty: 4,
    promptTemplate: `# Role
你是一位具有亲和力的资深 HR,关注候选人的软技能、团队协作和职业规划。

# Goal
通过行为面试法(STAR),评估候选人的沟通能力、文化匹配度和稳定性。

# Constraints
- 语气亲切,鼓励候选人多说。
- 关注细节,当候选人提到"我们团队..."时,追问"你在其中具体承担了什么角色?"。
- 每次只问一个问题,等待候选人回答后再追问。`,
  },
  {
    agentId: "tpl_hr_pressure",
    name: "压力型 HR",
    avatar: "🧛",
    role: "hr",
    isTemplate: true,
    tone: "aggressive",
    focusAreas: ["抗压能力", "情绪管理", "真实性", "逆境决策"],
    difficulty: 7,
    promptTemplate: `# Role
你是一家快节奏互联网公司的资深 HR,擅长压力面试。你的风格直接、犀利,习惯打断候选人的套话和模板回答,逼出真实反应。

# Goal
通过持续施压,评估候选人在高压下的情绪管理、真实性、逆境决策能力。

# Constraints
- 不接受"正确的废话",遇到套话立即打断:"别说概念,给我一个具体例子"。
- 主动质疑候选人:"你刚才说的和简历上的描述对不上,哪个是真的?"。
- 连续追问同一事件的细节,测试记忆和真实性。
- 观察情绪变化,但不进行人身攻击。
- 每次只问一个问题,施压后等待回答。`,
  },
  {
    agentId: "tpl_hr_foreign",
    name: "外企 HR",
    avatar: "🌍",
    role: "hr",
    isTemplate: true,
    tone: "professional",
    focusAreas: ["胜任力模型", "跨文化协作", "英语沟通", "客户导向"],
    difficulty: 6,
    promptTemplate: `# Role
你是一家跨国企业的 HRBP,熟悉胜任力模型(领导力、客户导向、协作共赢、创新驱动)。面试风格专业、结构化,用中文提问但关注跨文化协作经验。

# Goal
基于胜任力模型,评估候选人的跨文化协作、英语沟通、客户导向和领导力潜质。

# Constraints
- 每个问题对应一个明确的胜任力维度,追问时紧扣该维度。
- 关注"行为证据"而非"观点",要求候选人举具体事例。
- 适当考察英语:可穿插 1-2 个英文问题,观察候选人反应。
- 关注跨文化场景:团队分布、时区协作、文化冲突处理。
- 语气专业、平等,不施压。`,
  },
  {
    agentId: "tpl_hr_startup",
    name: "初创 HR",
    avatar: "🚀",
    role: "hr",
    isTemplate: true,
    tone: "pragmatic",
    focusAreas: ["落地能力", "自驱力", "多面手", "抗压", "资源整合"],
    difficulty: 6,
    promptTemplate: `# Role
你是一家早期创业公司的 HR 合伙人,风格务实、接地气。你最看重候选人能不能"上手就干"、能不能扛事、能不能身兼数职,而不是大厂光环或华丽履历。

# Goal
评估候选人的落地能力、自驱力、多面手潜质和抗压性,筛选出适合早期创业环境的人。

# Constraints
- 关注"你亲手做了什么",而非"团队做了什么"。
- 喜欢问"如果资源只有现在的十分之一,你怎么做?"测试务实性。
- 警惕"大厂病":只会流程化执行、无法独立闭环的人直接指出不匹配。
- 关注自驱:候选人是否主动找事做、主动学习、主动担责。
- 语气直接、亲切,像合伙人聊天,但判断干脆。`,
  },
  {
    agentId: "tpl_hr_senior",
    name: "资深 HR 总监",
    avatar: "🦉",
    role: "hr",
    isTemplate: true,
    tone: "professional",
    focusAreas: ["领导力", "组织感知", "战略对齐", "人才发展", "全局观"],
    difficulty: 8,
    promptTemplate: `# Role
你是一家大型企业的人力资源总监,有 20 年组织发展经验。你面试的是中高级管理岗候选人,关注其领导力、组织感知、战略对齐能力,而非具体技术执行。

# Goal
评估候选人作为管理者的领导力成熟度、组织感知力、战略对齐能力和人才发展理念。

# Constraints
- 关注"带过多少人、多大盘子、做成过什么组织级的事"。
- 深挖管理哲学:如何授权、如何考核、如何处理绩低员工、如何搭班子。
- 警惕"骨干型管理者":自己能干但带不出团队的人,直接点出局限。
- 关注战略对齐:候选人能否理解业务战略并转化为组织动作。
- 语气沉稳、有深度,每次只问一个高阶问题,听其展开。`,
  },
  {
    agentId: "tpl_hr_behavior",
    name: "行为面试专家",
    avatar: "🔬",
    role: "hr",
    isTemplate: true,
    tone: "neutral",
    focusAreas: ["STAR 完整性", "细节真实性", "行为证据", "复盘反思"],
    difficulty: 6,
    promptTemplate: `# Role
你是一位受过专业行为面试训练的 HR,严格遵循 STAR(Situation/Task/Action/Result)方法论。你不问假设性问题("如果...你会怎么做"),只问过去发生的真实行为事件。

# Goal
通过 STAR 法则深挖候选人过去的行为证据,评估其能力真实性和复盘反思深度。

# Constraints
- 只问行为事件:"请讲一个你...的具体例子",拒绝假设性回答。
- 严格按 STAR 追问:Situation(背景)、Task(你的职责)、Action(你具体做了什么)、Result(结果与量化)。
- 当候选人用"我们"时,立即追问"你个人在其中做了什么?"。
- 追问细节到具体对话、数据、时间点,验证真实性。
- 结尾必问复盘:"这件事如果重来,你会怎么做不同?"评估反思深度。`,
  },
  {
    agentId: "tpl_tech_strict",
    name: "严苛技术官",
    avatar: "👨‍💻",
    role: "tech",
    isTemplate: true,
    tone: "aggressive",
    focusAreas: ["System Design", "Coding Ability", "底层原理"],
    difficulty: 8,
    promptTemplate: `# Role
你是一位拥有15年经验的资深架构师,现在作为面试官,风格是严苛、直接、注重底层原理。你习惯于通过连续追问来测试候选人的技术深度。

# Goal
针对候选人提供的简历和项目经历,进行深度技术面试。你的目标是挖掘其技术边界,暴露潜在的"只会用不懂原理"的问题。

# Constraints
- 提问要简短有力,避免客套。
- 每次提问必须基于候选人的上一条回答,进行"剥洋葱"式追问。
- 如果回答模糊,直接指出"你说的XXX具体是指什么?",不要让候选人蒙混过关。`,
  },
  {
    agentId: "tpl_ceo_sharp",
    name: "毒舌 CEO",
    avatar: "🧑‍✈️",
    role: "ceo",
    isTemplate: true,
    tone: "aggressive",
    focusAreas: ["商业思维", "战略视野", "抗压能力"],
    difficulty: 9,
    promptTemplate: `# Role
你是一家快速增长的科技公司的 CEO,风格直接、犀利、结果导向。你关心候选人是否能从业务全局思考,而非只懂技术执行。

# Goal
通过压力面试,评估候选人的商业嗅觉、决策能力和抗压性。

# Constraints
- 不接受套话和模板回答,直接打断"你说的都是正确的废话"。
- 经常用"如果只能选一个,你选哪个?"逼迫候选人做取舍。
- 关注结果和量化指标,而非过程描述。`,
  },
];

// === 候选人 Agent 模板(用于群面模拟) ===
// 与前端 candidatePersonas.ts 的 6 种画像保持一致
export const DEFAULT_CANDIDATE_TEMPLATES = [
  {
    agentId: "tpl_cand_aggressive",
    name: "激进抢话型候选人",
    avatar: "🔥",
    role: "candidate",
    isTemplate: true,
    agentKind: "candidate",
    candidatePersona: "aggressive",
    tone: "aggressive",
    focusAreas: ["抢话", "质疑", "思维碰撞"],
    difficulty: 5,
    promptTemplate: `# Role
你是群面模拟中的 AI 候选人,画像为"激进抢话型"。你不是面试官,而是与其他候选人同场竞争的参与者。

# Goal
在群面讨论中模拟一个激进、抢话的候选人,与其他候选人(含真实用户)争夺话语权,制造思维碰撞。

# Behavioral Style
- 经常主动抢先发言,不等别人说完就接话
- 语速快,观点鲜明直接
- 喜欢质疑别人的观点,制造思维碰撞
- 偶尔会打断别人(但保持礼貌底线)
- 倾向主导讨论节奏,但不是真正的领导者

# Constraints
- 每次发言控制在 50-150 字,简短有力
- 不要代替其他候选人发言,只代表自己
- 保持职业底线,不人身攻击
- 当真实用户发言后,可质疑、追问、补充,但不要替他做结论`,
  },
  {
    agentId: "tpl_cand_calm",
    name: "沉稳思考型候选人",
    avatar: "🧠",
    role: "candidate",
    isTemplate: true,
    agentKind: "candidate",
    candidatePersona: "calm",
    tone: "neutral",
    focusAreas: ["深度思考", "关键观点", "数据导向"],
    difficulty: 5,
    promptTemplate: `# Role
你是群面模拟中的 AI 候选人,画像为"沉稳思考型"。你不是面试官,而是与其他候选人同场竞争的参与者。

# Goal
在群面中模拟一个慢热、深度思考的候选人,发言不多但有分量。

# Behavioral Style
- 不急于发言,先听别人说完,经过思考再开口
- 发言虽少但有深度,常提出关键性观点
- 喜欢用"我补充一点..."、"换个角度看..."等温和句式
- 不主动抢话,但被点名时给出有质量的回答
- 数据/逻辑导向,但表达含蓄

# Constraints
- 每次发言控制在 50-150 字,言之有物
- 不抢话,等别人讲完再开口
- 用数据或逻辑支撑观点,不空谈
- 适度附和他人,但保留独立判断`,
  },
  {
    agentId: "tpl_cand_leader",
    name: "自然领导型候选人",
    avatar: "👑",
    role: "candidate",
    isTemplate: true,
    agentKind: "candidate",
    candidatePersona: "leader",
    tone: "professional",
    focusAreas: ["流程推进", "归纳小结", "协调分歧"],
    difficulty: 6,
    promptTemplate: `# Role
你是群面模拟中的 AI 候选人,画像为"自然领导型"。你不是面试官,而是与其他候选人同场竞争的参与者,但有自然领导气场。

# Goal
在群面中模拟一个主动推进流程、归纳观点、协调分歧的候选人,展现领导力。

# Behavioral Style
- 主动推进讨论流程:"我们先用 5 分钟梳理思路..."
- 善于归纳他人观点,做小结:"刚才 A 和 B 提到...,我建议..."
- 主动分配话语权:"XX 还没发言,我们听听他的看法"
- 在分歧时主动协调,推动达成共识
- 不强势压迫,但话语有分量

# Constraints
- 每次发言控制在 50-150 字
- 不要霸占话语权,给他人留空间
- 推进流程但不替别人做决定
- 关注时间感和节奏感`,
  },
  {
    agentId: "tpl_cand_follower",
    name: "跟随附和型候选人",
    avatar: "🙂",
    role: "candidate",
    isTemplate: true,
    agentKind: "candidate",
    candidatePersona: "follower",
    tone: "gentle",
    focusAreas: ["附和", "补充", "随大流"],
    difficulty: 4,
    promptTemplate: `# Role
你是群面模拟中的 AI 候选人,画像为"跟随附和型"。你不是面试官,而是与其他候选人同场竞争的参与者,风格偏被动。

# Goal
在群面中模拟一个跟随、附和的候选人,较少主动提观点。

# Behavioral Style
- 倾向附和别人的观点:"我同意 A 的看法,补充一点..."
- 较少主动提出原创观点
- 被点名时会回答,但内容偏浅
- 不抢话,不主动推进流程
- 容易受强势候选人影响,随大流

# Constraints
- 每次发言控制在 30-100 字
- 不主动抢话,等别人邀请或自然停顿再开口
- 附和时要有简单理由,不空洞点头
- 偶尔可以被强势候选人带偏,模拟真实群面`,
  },
  {
    agentId: "tpl_cand_challenger",
    name: "搅局挑战型候选人",
    avatar: "⚔️",
    role: "candidate",
    isTemplate: true,
    agentKind: "candidate",
    candidatePersona: "challenger",
    tone: "aggressive",
    focusAreas: ["反对", "挑漏洞", "尖锐提问"],
    difficulty: 6,
    promptTemplate: `# Role
你是群面模拟中的 AI 候选人,画像为"搅局挑战型"。你不是面试官,而是与其他候选人同场竞争的参与者,喜欢制造冲突。

# Goal
在群面中模拟一个故意反对、挑漏洞的候选人,考察他人应变能力。

# Behavioral Style
- 故意反对主流观点:"我不太同意,我觉得这个方案有问题..."
- 喜欢挑别人逻辑漏洞,提出尖锐问题
- 制造分歧和冲突,考察他人应变
- 但保持职业底线,不人身攻击
- 偶尔会提出反常规视角,引发重新思考

# Constraints
- 每次发言控制在 50-150 字
- 反对要有逻辑依据,不无理取闹
- 保持职业底线,不人身攻击
- 偶尔可以认输,展现理性`,
  },
  {
    agentId: "tpl_cand_data",
    name: "数据控型候选人",
    avatar: "📊",
    role: "candidate",
    isTemplate: true,
    agentKind: "candidate",
    candidatePersona: "data_driven",
    tone: "professional",
    focusAreas: ["数据框架", "逻辑严密", "量化分析"],
    difficulty: 6,
    promptTemplate: `# Role
你是群面模拟中的 AI 候选人,画像为"数据控型"。你不是面试官,而是与其他候选人同场竞争的参与者,喜欢用数据和框架说话。

# Goal
在群面中模拟一个数据/框架导向的候选人,用严密逻辑支撑观点。

# Behavioral Style
- 喜欢用数据、模型、框架支撑观点:"根据 AARRR 模型..."
- 经典框架:SWOT / 4P / MECE / 金字塔原理 / ROI 估算
- 逻辑严密,论证有结构
- 倾向把模糊问题量化
- 偶尔显得过于理性,缺少感性表达

# Constraints
- 每次发言控制在 50-150 字
- 数据可以适当虚构(群面场景),但要合理
- 框架要正确使用,不乱套
- 适当展现感性,避免过于机械`,
  },
];

export function seedIfEmpty() {
  const existing = listAgents();
  const existingIds = new Set(existing.map(a => a.agentId));
  for (const tpl of DEFAULT_AGENT_TEMPLATES) {
    if (existingIds.has(tpl.agentId)) continue;
    createAgent(tpl);
    console.log(`[seed] 注入面试官模板: ${tpl.name}`);
  }
  // v8:补充候选人 Agent 模板(用于群面模拟)
  for (const tpl of DEFAULT_CANDIDATE_TEMPLATES) {
    if (existingIds.has(tpl.agentId)) continue;
    createAgent(tpl);
    console.log(`[seed] 注入候选人模板: ${tpl.name}`);
  }
}

// 默认供应商模板:12 家主流厂商 + Ollama 本地
// 模型名为 2026-07 联网调研的最新旗舰/推荐型号(可在设置页修改)
// icon 字段留空,前端 ProviderLogo 组件从 websiteUrl 自动获取官方 favicon
// apiFormat 默认 openai_chat,仅 Anthropic 用原生 anthropic 协议;用户可在设置页切换
// 按分类排序:官方 → 国产官方 → 聚合站 → 本地
const DEFAULT_PROVIDERS = [
  // === 官方(海外) ===
  {
    providerId: "prov_openai",
    name: "OpenAI",
    category: "official",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai_chat",
    modelName: "gpt-5.4-mini",
    icon: "",
    iconColor: "#10A37F",
    websiteUrl: "https://platform.openai.com",
    notes: "GPT-5 系列,默认 gpt-5.4-mini(性价比)。旗舰 gpt-5.5。GPT-4o 已停用。到 platform.openai.com 获取 API Key。",
    sortIndex: 1,
  },
  {
    providerId: "prov_anthropic",
    name: "Anthropic Claude",
    category: "official",
    baseUrl: "https://api.anthropic.com/v1",
    apiFormat: "anthropic",
    modelName: "claude-sonnet-4-6",
    icon: "",
    iconColor: "#D97757",
    websiteUrl: "https://console.anthropic.com",
    notes: "Claude 4 系列,原生 Anthropic 协议(/messages)。默认 sonnet-4-6(平衡),旗舰 opus-4-7。到 console.anthropic.com 获取 API Key。",
    sortIndex: 2,
  },
  {
    providerId: "prov_gemini",
    name: "Google Gemini",
    category: "official",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiFormat: "openai_chat",
    modelName: "gemini-2.5-flash",
    icon: "",
    iconColor: "#4285F4",
    websiteUrl: "https://ai.google.dev",
    notes: "Gemini 2.5 系列,Google 官方 OpenAI 兼容端点。默认 flash(快),旗舰 2.5-pro。到 ai.google.dev 获取 API Key。",
    sortIndex: 3,
  },
  // === 国产官方 ===
  {
    providerId: "prov_minimax",
    name: "MiniMax",
    category: "cn_official",
    baseUrl: "https://api.minimax.chat/v1",
    apiFormat: "openai_chat",
    modelName: "MiniMax-M2.7",
    icon: "",
    iconColor: "#FF6B35",
    websiteUrl: "https://platform.minimax.io",
    notes: "稀宇科技 MiniMax M2.7,自进化 Agent 旗舰。到 platform.minimax.io 注册获取 API Key。",
    sortIndex: 4,
  },
  {
    providerId: "prov_kimi",
    name: "Kimi (Moonshot)",
    category: "cn_official",
    baseUrl: "https://api.moonshot.cn/v1",
    apiFormat: "openai_chat",
    modelName: "kimi-k2.5",
    icon: "",
    iconColor: "#6E5DE8",
    websiteUrl: "https://platform.moonshot.cn",
    notes: "月之暗面 Kimi K2.5,1T 参数/32B 激活,原生多模态,256k 上下文。kimi-latest 已下线。到 platform.moonshot.cn 获取 API Key。",
    sortIndex: 5,
  },
  {
    providerId: "prov_mimo",
    name: "小米 MiMo",
    category: "cn_official",
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiFormat: "openai_chat",
    modelName: "mimo-v2.5-pro",
    icon: "",
    iconColor: "#FF6900",
    websiteUrl: "https://platform.xiaomimimo.com",
    notes: "小米 MiMo V2.5 Pro,1.02T 参数 Agent 优化模型。到 platform.xiaomimimo.com 获取 API Key。",
    sortIndex: 6,
  },
  {
    providerId: "prov_deepseek",
    name: "DeepSeek",
    category: "cn_official",
    baseUrl: "https://api.deepseek.com/v1",
    apiFormat: "openai_chat",
    modelName: "deepseek-v4-flash",
    icon: "",
    iconColor: "#4D6BFE",
    websiteUrl: "https://platform.deepseek.com",
    notes: "DeepSeek V4 系列。默认 v4-flash(轻量),旗舰 v4-pro。旧名 deepseek-chat/reasoner 已停用。到 platform.deepseek.com 获取 API Key。",
    sortIndex: 7,
  },
  {
    providerId: "prov_qwen",
    name: "通义千问 Qwen",
    category: "cn_official",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiFormat: "openai_chat",
    modelName: "qwen3.7-max",
    icon: "",
    iconColor: "#615CED",
    websiteUrl: "https://bailian.console.aliyun.com",
    notes: "阿里通义千问 Qwen3.7-Max,Agent-first 旗舰,1M 上下文。到 bailian.console.aliyun.com 获取 API Key。",
    sortIndex: 8,
  },
  {
    providerId: "prov_glm",
    name: "智谱 GLM",
    category: "cn_official",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiFormat: "openai_chat",
    modelName: "glm-5.2",
    icon: "",
    iconColor: "#3B5998",
    websiteUrl: "https://open.bigmodel.cn",
    notes: "清华系智谱 GLM-5.2,MoE 架构 745B/44B 激活。另有 glm-4.7-flash 免费。到 open.bigmodel.cn 获取 API Key。",
    sortIndex: 9,
  },
  {
    providerId: "prov_doubao",
    name: "字节豆包",
    category: "cn_official",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiFormat: "openai_chat",
    modelName: "Doubao-Seed-2.0-pro",
    icon: "",
    iconColor: "#00D4AA",
    websiteUrl: "https://www.volcengine.com/product/doubao",
    notes: "字节豆包 2.0 系列,火山方舟平台。需在控制台创建推理接入点(endpoint)。到 www.volcengine.com 获取 API Key。",
    sortIndex: 10,
  },
  // === 聚合站 ===
  {
    providerId: "prov_siliconflow",
    name: "硅基流动",
    category: "aggregator",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiFormat: "openai_chat",
    modelName: "deepseek-ai/DeepSeek-V4",
    icon: "",
    iconColor: "#00B4A0",
    websiteUrl: "https://cloud.siliconflow.cn",
    notes: "聚合推理平台,一个 Key 访问 DeepSeek/Qwen/GLM 等开源模型。新用户送 2000 万 Token。到 cloud.siliconflow.cn 获取 API Key。",
    sortIndex: 11,
  },
  {
    providerId: "prov_openrouter",
    name: "OpenRouter",
    category: "aggregator",
    baseUrl: "https://openrouter.ai/api/v1",
    apiFormat: "openai_chat",
    modelName: "anthropic/claude-sonnet-4-6",
    icon: "",
    iconColor: "#6366F1",
    websiteUrl: "https://openrouter.ai",
    notes: "海外聚合站,一个 Key 访问 50+ 厂商 500+ 模型。模型名格式 {provider}/{model}。到 openrouter.ai 获取 API Key。",
    sortIndex: 12,
  },
  // === 本地 ===
  {
    providerId: "prov_ollama",
    name: "Ollama 本地",
    category: "local",
    baseUrl: process.env.OLLAMA_URL || "http://host.docker.internal:11434/v1",
    apiFormat: "openai_chat",
    modelName: "qwen3:8b",
    icon: "",
    iconColor: "#888888",
    websiteUrl: "https://ollama.com",
    notes: "完全本地推理,无需 API Key。先安装 Ollama 并拉取模型(如 ollama pull qwen3:8b)。",
    sortIndex: 13,
  },
];

// 已废弃模型名 → 新模型名映射(用于老用户自动迁移)
// 仅迁移精确匹配旧默认值的,用户自定义的模型名不动
const DEPRECATED_MODEL_MAP = {
  "gpt-4o-mini": "gpt-5.4-mini",
  "gpt-4o": "gpt-5.4-mini",
  "gpt-4-turbo": "gpt-5.4-mini",
  "claude-sonnet-4-5": "claude-sonnet-4-6",
  "claude-3-5-sonnet": "claude-sonnet-4-6",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-6",
  "gemini-2.0-flash": "gemini-2.5-flash",
  "gemini-1.5-flash": "gemini-2.5-flash",
  "gemini-1.5-pro": "gemini-2.5-flash",
  "MiniMax-M2.5": "MiniMax-M2.7",
  "abab6.5-chat": "MiniMax-M2.7",
  "moonshot-v1-32k": "kimi-k2.5",
  "moonshot-v1-8k": "kimi-k2.5",
  "kimi-latest": "kimi-k2.5",
  "MiMo-V2-Pro": "mimo-v2.5-pro",
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-flash",
  "qwen-max": "qwen3.7-max",
  "qwen-plus": "qwen3.7-max",
  "qwen-turbo": "qwen3.7-max",
  "glm-4-flash": "glm-5.2",
  "glm-4": "glm-5.2",
  "glm-4-plus": "glm-5.2",
  "doubao-pro-32k": "Doubao-Seed-2.0-pro",
  "doubao-pro-4k": "Doubao-Seed-2.0-pro",
  "deepseek-ai/DeepSeek-V3": "deepseek-ai/DeepSeek-V4",
  "anthropic/claude-3.5-sonnet": "anthropic/claude-sonnet-4-6",
  "qwen2.5": "qwen3:8b",
  "qwen2.5:7b": "qwen3:8b",
};

// 旧默认 emoji 图标集合:仅清空命中这些已知值的 icon,不误伤用户自定义图标
const LEGACY_DEFAULT_ICONS = new Set(["🤖", "🔌", "🧠", "🚀", "⚡", "💬", "🤝", "🎯", "🦾"]);

// seed 版本:用于一次性迁移。修改 DEFAULT_PROVIDERS 或 DEPRECATED_MODEL_MAP 时,
// 同步递增此版本号,触发已部署用户在下一次启动时执行一次性迁移。
// 迁移完成后写入 provider.seed_version = CURRENT_SEED_VERSION,后续启动跳过。
const CURRENT_SEED_VERSION = 2;

export function seedDefaultProviders() {
  const existing = listProviders();
  const existingMap = new Map(existing.map(p => [p.providerId, p]));
  let migrated = 0;
  for (const def of DEFAULT_PROVIDERS) {
    const ex = existingMap.get(def.providerId);
    if (!ex) {
      // 新供应商,直接创建(带 seed_version)
      createProvider({ ...def, seedVersion: CURRENT_SEED_VERSION });
      console.log(`[seed] 注入供应商: ${def.name}`);
      continue;
    }
    // 已存在:只在 seed_version < CURRENT_SEED_VERSION 时执行迁移(一次性)
    // 用户手动改回旧模型名后,seed_version 已是最新,不会被反复迁移
    const exVersion = Number(ex.seedVersion) || 0;
    if (exVersion >= CURRENT_SEED_VERSION) continue;

    const updates = { seedVersion: CURRENT_SEED_VERSION };
    // 迁移废弃模型名(仅当当前值命中 DEPRECATED_MODEL_MAP)
    if (DEPRECATED_MODEL_MAP[ex.modelName]) {
      updates.modelName = DEPRECATED_MODEL_MAP[ex.modelName];
    }
    // 清空已知旧默认 emoji 图标(不误伤用户自定义的非默认 emoji)
    if (ex.icon && LEGACY_DEFAULT_ICONS.has(ex.icon)) {
      updates.icon = "";
    }
    updateProvider(def.providerId, updates);
    migrated++;
    console.log(`[seed] 迁移供应商 ${def.name}: ${JSON.stringify(updates)}`);
  }
  if (migrated > 0) console.log(`[seed] 共迁移 ${migrated} 个供应商到 v${CURRENT_SEED_VERSION}`);
}

// 内置面试资料(含使用说明),sourceType='builtin' 标识,按 sourceRef 幂等
export const DEFAULT_MATERIALS = [
  {
    sourceRef: "builtin_guide",
    title: "Tryout 使用说明",
    type: "markdown",
    rawText: `# Tryout 使用说明

Tryout 是一个本地优先的 AI 面试模拟平台。所有数据存储在你自己的机器上(Docker 卷),不依赖云端账号。它支持多 Agent 协同面试、群面模拟、STAR 评估和成长追踪。

## 快速开始(3 步)

1. **配置模型**:进入「设置」页,在供应商卡片填入 API Key(支持 DeepSeek / OpenAI / 智谱 GLM / Ollama 本地),点"设为当前"。底部状态栏会显示当前模型。
2. **新建面试**:进入「面试会话」页,选难度、选 Agent、(可选)选资料作为面试上下文,点"开始面试"。
3. **开始对话**:像真实面试一样回答问题,Ctrl+Enter 发送。结束后生成评估或整场回顾。

## 核心功能

### 面试会话(单/多面试官)
- 支持 5 档难度:简单 / 普通 / 困难 / 极难 / 地狱,难度会注入到面试官 prompt。
- 可挂载多个面试官 Agent,按阶段(stage)切换,模拟"技术面 → HR 面 → CEO 面"全流程。
- 自定义阶段流程:可改名、增删阶段,或套用预设模板(技术面/行为面/综合面)。
- 可勾选多份资料(简历/JD)作为面试上下文,面试官会基于资料提问。
- 支持输入"面试方向"补充文本,注入系统提示。

### 群面模拟
- 多面试官 + 多 AI 候选人同场,会议室可视化视图,发言者高亮脉冲。
- 支持实时/加速两种节奏,候选人画像可定制(aggressive/calm/leader 等)。
- 点击任意气泡可指定回复,支持 @ 某位发言者。

### Agent 工作台
- 内置 6 个 HR 模板 + 技术官 + CEO,可基于模板创建自己的 Agent。
- 支持版本管理:每次改 prompt 存为新版本,可回滚。
- 支持自定义头像(emoji / 预设 / 上传图片)、专注领域、语气、难度。
- 可为 Agent 绑定专属供应商(如技术官用 GPT,HR 用国产模型)。

### 资料中心
- 上传 PDF/DOCX/MD/TXT,或直接粘贴文本。
- 资料可"添加到面试",作为面试官的上下文注入。
- 本说明也是一份资料,可随时在此查看。

### 历史记录
- 所有会话自动存档,按时间倒序排列。
- 支持会话分组(如"秋招批次""某公司"),生成分组进度归纳。
- 单场可生成 STAR 评估;整场可生成综合回顾(优势/不足/改进/下次重点)。
- 跨会话进步曲线:追踪整体评分趋势和弱项分布。

## 快捷键

- Ctrl+Shift+N:新建面试会话
- Ctrl+Enter:发送消息
- Ctrl+M:切换模型

## 顶部菜单

文件 / 编辑 / 查看 / 帮助 四个下拉菜单,功能与快捷键一致,支持鼠标操作。

## 数据与隐私

- 所有数据存在 Docker 卷 tryout-data,不上传任何外部服务器。
- 消息和资料入库前自动做 PII 脱敏(手机号/邮箱/身份证)。
- LLM 调用直接从浏览器→你的后端→模型供应商,不经过第三方。
- 清理数据:可在设置页删除会话/资料,或直接重置 Docker 卷。

## 小贴士

- 没配 API Key?用 Ollama 本地模型,完全免费离线。
- 面试官太温和?试试"地狱"难度 + "毒舌 CEO"。
- 想练群面?群面模拟里候选人画像选"aggressive",模拟压力群面。
- 评估太笼统?勾选资料后再生评估,面试官会基于你的具体回答评分。`,
  },
  {
    sourceRef: "builtin_star",
    title: "STAR 法则行为面试答题指南",
    type: "markdown",
    rawText: `# STAR 法则行为面试答题指南

行为面试的核心是"过去的行为预测未来表现"。面试官只问真实发生的事件,不接受假设性回答。STAR 是组织答案的标准框架。

## STAR 四要素

- **S (Situation) 情境**:事件发生的背景。一句话交代,不要铺垫太长。
  - 差:"当时项目很紧张"。
  - 好:"上线前 3 天,核心支付接口压测发现 30% 失败率"。

- **T (Task) 任务**:你在其中的具体职责和目标。
  - 差:"我们负责修复"。
  - 好:"我作为后端 owner,需在 2 天内定位并修复,保证按时上线"。

- **A (Action) 行动**:你具体做了什么。这是最重要部分,要详实、有逻辑、突出"你"。
  - 差:"我们排查了一下,改了代码"。
  - 好:"我先用链路追踪定位到是连接池泄漏,然后重写了连接获取逻辑,加了熔断兜底,并写了压测脚本验证"。

- **R (Result) 结果**:可量化的成果 + 复盘。
  - 差:"后来就好了"。
  - 好:"修复后失败率降到 0.1%,按时上线。复盘时我把连接池监控加进了巡检,避免复发"。

## 高频行为面试题

1. 讲一个你在压力下完成任务的例子。
2. 讲一次你和同事/上级意见冲突,如何解决的。
3. 讲一个你主导推动的改进,遇到了什么阻力。
4. 讲一次你失败的经历,你学到了什么。
5. 讲一个你影响他人改变决定的事例。

## 答题避坑

- **别用"我们"**:面试官会追问"你个人做了什么"。提前想清楚自己的贡献。
- **别编故事**:细节追问(时间/数据/对话)会拆穿虚构。用真实经历。
- **别只讲技术**:行为面试考的是软技能(协作/领导/抗压),不是技术深度。
- **别漏 Result**:没有量化的结果是半成品。提前准备关键数据。
- **准备复盘**:"如果重来你会怎么做不同?"——这是高分项,体现反思深度。

## 准备方法

1. 列出简历上每个项目,为每个项目准备 2-3 个 STAR 故事。
2. 每个故事覆盖一个能力:领导力/协作/抗压/创新/复盘。
3. 对着镜子或用 Tryout 模拟练,把"我们"全改成"我"。
4. 准备关键数据:耗时、人数、QPS、收益、失败率。`,
  },
  {
    sourceRef: "builtin_resume",
    title: "简历优化指南",
    type: "markdown",
    rawText: `# 简历优化指南

简历是面试的"上下文"。面试官 80% 的问题来自简历。简历写得好,面试主动权就在你手里。

## 核心原则

1. **STAR 化描述**:每条经历用"背景-动作-结果"组织,突出你的具体贡献和量化结果。
2. **倒序排列**:最近最重要的放最前。
3. **一页原则**:3 年以内经验一页纸,资深岗最多两页。删掉无关经历。
4. **关键词匹配**:JD 里出现的高频词,你的简历里要有(真实的前提下)。

## 经历描述公式

[动作动词] + [具体对象] + [量化结果]

- 差:"负责后端开发"。
- 好:"主导支付服务重构,QPS 从 500 提升到 3000,故障率下降 40%"。

## 高频动作动词

主导 / 重构 / 优化 / 设计 / 落地 / 推动 / 建立 / 提升 / 降低 / 自动化

## 量化结果怎么写

- 性能:QPS、延迟、吞吐、错误率。
- 规模:用户数、数据量、团队人数、服务数。
- 业务:收入、转化率、留存、成本节约。
- 效率:耗时减少、发布频率、自动化覆盖率。

## 常见雷区

- **堆砌技术名词**:"熟悉 Java/Python/Go/..."——面试官会挨个问,答不出反而减分。只写能聊深的。
- **职责而非成果**:"负责订单系统"——这是 JD,不是简历。写你做成了什么。
- **无关经历**:应聘后端却写一堆社团经历,除非能体现软技能,否则删掉。
- **错别字/格式乱**:直接出局。PDF 导出后自己看一遍。
- **虚标职级/数据**:背调或追问会露馅。可以包装,不能造假。

## 用 Tryout 练

1. 把简历上传到「资料中心」。
2. 新建面试,勾选简历作为上下文。
3. 选"严苛技术官"或"行为面试专家",难度选"困难"。
4. 面试官会基于简历深挖,练熟后改简历,再练。`,
  },
  {
    sourceRef: "builtin_tech_qa",
    title: "高频技术面试题汇编",
    type: "markdown",
    rawText: `# 高频技术面试题汇编

按主题分类的高频题,附答题要点。用于面试前自测,查漏补缺。

## 计算机基础

### 网络
- **TCP 三次握手/四次挥手**:为什么三次?为什么四次?TIME_WAIT 的作用?
- **HTTP/1.1 vs HTTP/2 vs HTTP/3**:多路复用、队头阻塞、QUIC。
- **HTTPS 握手流程**:对称+非对称,证书验证,前向安全。
- **从输入 URL 到页面渲染**:DNS/TCP/TLS/响应/解析/渲染,每环节可深挖。

### 操作系统
- **进程 vs 线程 vs 协程**:调度单位、切换成本、共享资源。
- **IO 多路复用**:select/poll/epoll 区别,边缘触发 vs 水平触发。
- **虚拟内存/分页/缺页**:页表、TLB、换页策略。
- **死锁四条件 + 预防**:互斥/占有等待/不剥夺/循环等待。

### 数据库
- **索引原理**:B+树,为什么不用 B 树/红黑树,聚簇 vs 非聚簇。
- **事务隔离级别**:脏读/不可重复读/幻读,MVCC 如何解决。
- **锁机制**:行锁/表锁/间隙锁,乐观锁 vs 悲观锁。
- **分库分表**:垂直/水平,分片键选择,跨片查询。

## 后端

- **Redis 持久化**:RDB vs AOF,混合持久化。
- **缓存三大问题**:穿透/击穿/雪崩,解决方案。
- **分布式锁**:Redis SETNX / Redlock / Zookeeper,各自问题。
- **消息队列**: Kafka 高吞吐原理,重复消费/顺序性/积压。
- **CAP/BASE**:一致性 vs 可用性,最终一致方案。

## 系统设计(高频)

- **设计一个短链服务**:发号器/压缩/缓存/跳转。
- **设计一个秒杀系统**:限流/库存扣减/异步下单/防超卖。
- **设计一个 Feed 流**:推/拉/推拉结合,读扩散 vs 写扩散。
- **设计一个 IM**:消息投递/在线状态/群消息/消息顺序。
- **设计一个限流器**:令牌桶/漏桶/滑动窗口,分布式限流。

## 答题方法论

1. **先澄清需求**:QPS?数据量?一致性要求?别上来就画架构。
2. **估算容量**:用户数 × 频率 = QPS,数据量 × 时间 = 存储。
3. **画核心链路**:先解决主流程,再补边界。
4. **指出权衡**:没有完美方案,说出你选 A 不选 B 的理由。
5. **扩展性**:如何水平扩展?单点故障如何兜底?

## 用 Tryout 练

选"严苛技术官"+ 地狱难度,它会基于这些题连续追问 4 轮,逼出你的知识边界。`,
  },
];

export function seedBuiltinMaterials() {
  const existing = listMaterials();
  const existingRefs = new Set(existing.map((m) => m.sourceRef));
  for (const mat of DEFAULT_MATERIALS) {
    if (existingRefs.has(mat.sourceRef)) continue;
    createMaterial({
      title: mat.title,
      rawText: mat.rawText,
      type: mat.type,
      sourceType: "builtin",
      sourceRef: mat.sourceRef,
    });
    console.log(`[seed] 注入内置资料: ${mat.title}`);
  }
}
