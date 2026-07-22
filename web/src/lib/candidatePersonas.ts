// v6:候选人画像定义
// 用于群面中 AI 候选人的行为风格
import type { CandidatePersona } from "@/types/agent";
import {
  Flame, Brain, Crown, Smile, Swords, BarChart3,
} from "lucide-react";
import type { ComponentType, CSSProperties } from "react";

export interface PersonaMeta {
  value: CandidatePersona;
  label: string;
  desc: string;
  // 行为权重:决定调度引擎的概率选择
  weights: {
    speakProb: number;      // 主动发言概率(0-1)
    interruptProb: number;  // 抢话/打断概率
    agreeProb: number;      // 附和别人概率
    leadProb: number;       // 主动推进流程概率
    dataOriented: number;   // 使用数据/框架倾向(0-1)
    conflictLevel: number;  // 制造冲突倾向(0-1)
  };
  // 用于 system prompt 的画像说明
  prompt: string;
  icon: ComponentType<{ size?: number | string; className?: string; style?: CSSProperties }>;
  color: string;
}

export const CANDIDATE_PERSONAS: PersonaMeta[] = [
  {
    value: "aggressive",
    label: "激进抢话型",
    desc: "频繁打断、抢话语权,语速快,急于表达",
    weights: {
      speakProb: 0.85,
      interruptProb: 0.55,
      agreeProb: 0.1,
      leadProb: 0.4,
      dataOriented: 0.3,
      conflictLevel: 0.5,
    },
    prompt: `你的发言风格:激进、抢话。
- 经常主动抢先发言,不等别人说完就接话
- 语速快,观点鲜明直接
- 喜欢质疑别人的观点,制造思维碰撞
- 偶尔会打断别人(但保持礼貌底线)
- 倾向主导讨论节奏,但不是真正的领导者`,
    icon: Flame,
    color: "#ef4444",
  },
  {
    value: "calm",
    label: "沉稳思考型",
    desc: "慢热、深度发言,先思考再开口",
    weights: {
      speakProb: 0.45,
      interruptProb: 0.05,
      agreeProb: 0.3,
      leadProb: 0.35,
      dataOriented: 0.7,
      conflictLevel: 0.1,
    },
    prompt: `你的发言风格:沉稳、深度。
- 不急于发言,先听别人说完,经过思考再开口
- 发言虽少但有深度,常提出关键性观点
- 喜欢用"我补充一点..."、"换个角度看..."等温和句式
- 不主动抢话,但被点名时给出有质量的回答
- 数据/逻辑导向,但表达含蓄`,
    icon: Brain,
    color: "#3b82f6",
  },
  {
    value: "leader",
    label: "自然领导型",
    desc: "主动推进流程、分配话语,有领导气场",
    weights: {
      speakProb: 0.7,
      interruptProb: 0.2,
      agreeProb: 0.2,
      leadProb: 0.9,
      dataOriented: 0.6,
      conflictLevel: 0.2,
    },
    prompt: `你的发言风格:自然领导。
- 主动推进讨论流程:"我们先用 5 分钟梳理思路..."
- 善于归纳他人观点,做小结:"刚才 A 和 B 提到...,我建议..."
- 主动分配话语权:"XX 还没发言,我们听听他的看法"
- 在分歧时主动协调,推动达成共识
- 不强势压迫,但话语有分量`,
    icon: Crown,
    color: "#f59e0b",
  },
  {
    value: "follower",
    label: "跟随附和型",
    desc: "附和别人、少主动提观点,容易随大流",
    weights: {
      speakProb: 0.5,
      interruptProb: 0.05,
      agreeProb: 0.8,
      leadProb: 0.1,
      dataOriented: 0.3,
      conflictLevel: 0.05,
    },
    prompt: `你的发言风格:跟随、附和。
- 倾向附和别人的观点:"我同意 A 的看法,补充一点..."
- 较少主动提出原创观点
- 被点名时会回答,但内容偏浅
- 不抢话,不主动推进流程
- 容易受强势候选人影响,随大流`,
    icon: Smile,
    color: "#10b981",
  },
  {
    value: "challenger",
    label: "搅局挑战型",
    desc: "故意反对、制造冲突,考察他人应变",
    weights: {
      speakProb: 0.65,
      interruptProb: 0.4,
      agreeProb: 0.05,
      leadProb: 0.3,
      dataOriented: 0.5,
      conflictLevel: 0.85,
    },
    prompt: `你的发言风格:搅局、挑战。
- 故意反对主流观点:"我不太同意,我觉得这个方案有问题..."
- 喜欢挑别人逻辑漏洞,提出尖锐问题
- 制造分歧和冲突,考察他人应变
- 但保持职业底线,不人身攻击
- 偶尔会提出反常规视角,引发重新思考`,
    icon: Swords,
    color: "#8b5cf6",
  },
  {
    value: "data_driven",
    label: "数据控型",
    desc: "喜欢用数据/框架支撑观点,逻辑严密",
    weights: {
      speakProb: 0.6,
      interruptProb: 0.1,
      agreeProb: 0.3,
      leadProb: 0.45,
      dataOriented: 0.95,
      conflictLevel: 0.2,
    },
    prompt: `你的发言风格:数据/框架导向。
- 喜欢用数据、模型、框架支撑观点:"根据 AARRR 模型..."
- 经典框架:SWOT / 4P / MECE / 金字塔原理 / ROI 估算
- 逻辑严密,论证有结构
- 倾向把模糊问题量化
- 偶尔显得过于理性,缺少感性表达`,
    icon: BarChart3,
    color: "#06b6d4",
  },
];

export function getPersonaMeta(value: CandidatePersona | null | undefined): PersonaMeta | null {
  if (!value) return null;
  return CANDIDATE_PERSONAS.find((p) => p.value === value) || null;
}

// 预设群面案例库
export interface PresetTopic {
  id: string;
  title: string;
  category: "排序" | "资源分配" | "两难决策" | "开放方案";
  content: string;
}

export const PRESET_TOPICS: PresetTopic[] = [
  {
    id: "topic_sort_survival",
    title: "荒岛求生物品排序",
    category: "排序",
    content: `你们小组因飞机失事,流落到一个荒岛上。救援预计 2 周后到达。
现有以下 15 件物品,请小组讨论后,按对生存的重要性从高到低排序,并给出理由。
物品清单:
1. 一把瑞士军刀  2. 一张 6 平方米塑料布  3. 一个放大镜
4. 一箱压缩饼干(7 天量)  5. 5 升淡水  6. 一盒防水火柴
7. 一块镜子  8. 一把渔具  9. 50 米尼龙绳
10. 一个急救箱  11. 一台收音机(只能接收)  12. 一个手电筒(带电池)
13. 一瓶伏特加  14. 一本《荒野求生手册》  15. 一把折叠铲
讨论时间:30 分钟。最后由一位代表汇报排序结果和理由。`,
  },
  {
    id: "topic_budget_allocation",
    title: "公司预算分配决策",
    category: "资源分配",
    content: `你们是某互联网公司管理层,今年有 1000 万预算需要在以下 5 个部门间分配:
1. 研发部 - 申请 400 万(新项目启动)
2. 市场部 - 申请 350 万(品牌升级)
3. 销售部 - 申请 300 万(团队扩张)
4. 客服部 - 申请 150 万(系统升级)
5. HR 部 - 申请 100 万(人才计划)
各部门申请总和超出预算 300 万。请小组讨论,在 30 分钟内达成一致的分配方案,并说明理由。
要求:不能简单按比例削减,要给出战略层面的优先级判断。`,
  },
  {
    id: "topic_dilemma_layoff",
    title: "裁员两难决策",
    category: "两难决策",
    content: `公司因业务调整需要裁掉 1 人,你们 5 人小组(不含用户)是决策委员会。
候选人有 3 位:
A. 张三 - 35 岁,在公司 8 年,业务熟练,但最近 1 年绩效下滑,家中有生病老人
B. 李四 - 28 岁,在公司 2 年,潜力大,但经验不足,刚结婚准备买房
C. 王五 - 40 岁,在公司 12 年,元老,但技能老化,薪资最高
请小组讨论 30 分钟,给出最终裁员建议及理由,需综合考虑业务、人本、成本、风险。`,
  },
  {
    id: "topic_open_product",
    title: "新产品方案设计",
    category: "开放方案",
    content: `公司计划面向银发族(60+ 老年人)推出一款智能硬件产品。
预算 500 万,研发周期 6 个月,目标用户量 50 万。
请小组讨论 30 分钟,产出:
1. 产品形态(硬件类型 + 核心功能)
2. 目标场景与价值主张
3. 商业模式
4. 风险点与应对
最后选一位代表做 3 分钟方案汇报。`,
  },
];

// ===== i18n key 映射 =====
// 数据层(label/desc/title/category)保留中文原值作为 fallback,
// 渲染层通过这些 key 优先查 i18n,查不到回退到原值
export const PERSONA_I18N_KEYS: Record<CandidatePersona, { labelKey: string; descKey: string }> = {
  aggressive:   { labelKey: "persona.aggressive.label",   descKey: "persona.aggressive.desc" },
  calm:         { labelKey: "persona.calm.label",         descKey: "persona.calm.desc" },
  leader:       { labelKey: "persona.leader.label",       descKey: "persona.leader.desc" },
  follower:     { labelKey: "persona.follower.label",     descKey: "persona.follower.desc" },
  challenger:   { labelKey: "persona.challenger.label",   descKey: "persona.challenger.desc" },
  data_driven:  { labelKey: "persona.data_driven.label",  descKey: "persona.data_driven.desc" },
};

export const TOPIC_CATEGORY_I18N_KEYS: Record<PresetTopic["category"], string> = {
  "排序": "topic.category.sort",
  "资源分配": "topic.category.allocation",
  "两难决策": "topic.category.dilemma",
  "开放方案": "topic.category.open",
};

export function topicI18nKey(id: string): string {
  return `topic.preset.${id}.title`;
}
