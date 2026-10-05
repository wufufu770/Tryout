// 题库知识锚点 —— 把一道题变成可注入 system prompt 的片段
//
// W4-2 的核心。让 808 道题真正影响提问,靠的是这个块。
//
// 三条不可让步的约束:
//   1. **知识锚点,不是剧本**
//      直接让 LLM 照念题面会毁掉模拟真实度 —— 用户背得出题库,练习就失去意义。
//      所以只给"考察方向",不给题面,并明确要求改写成自己的口吻。
//
//   2. **追问有边界,但不收紧**
//      Campion 15 成分中「同题」证据 ★★★☆☆,而「限制追问与提示」证据
//      ☆☆☆☆☆(几乎为零)。结构化的价值在"同题",不在"限制追问"。
//      实务惯例:*Probing is allowed and necessary; improvising new questions
//      because you're curious is not.* → 自由追问,但每条必须落在给定方向上。
//
//   3. **绝不注入 referenceAnswer**
//      它是评估基准(ADR:评"技术正确性"的唯一客观依据),不是提问素材。
//      混进去等于让模型边看答案边提问。

import type { QuestionLite, QuestionType } from "./questionSelector";

/** 题型 → 提问引导语。不同题型的追问方式确实不同 */
const TYPE_GUIDE: Record<QuestionType, string> = {
  technical: "考察对机制与原理的理解,可追问边界条件与失效场景",
  design: "考察系统设计取舍,应追问为什么选这个方案、放弃了什么",
  behavioral: "考察过往经历,用 STAR 方式追问,聚焦具体动作而非结论",
  coding: "考察现场实现,关注思路清晰度、边界处理与复杂度分析",
  questions: "这是反问环节,应引导候选人向面试官提问,考察其关注点",
};

const TYPE_LABEL: Record<QuestionType, string> = {
  technical: "技术原理",
  design: "系统设计",
  behavioral: "行为面试",
  coding: "手撕代码",
  questions: "反问环节",
};

/**
 * 构造注入 system prompt 的知识锚点块。
 * @param q 题目(必须来自服务端列表接口 —— 那里已剔除 referenceAnswer);
 *          传 null 表示题库不可用,返回空串由调用方决定降级策略。
 */
export function buildExamFocusBlock(q: QuestionLite | null | undefined): string {
  if (!q) return "";
  const type = (q.type || "technical") as QuestionType;
  const label = TYPE_LABEL[type] || type;
  const guide = TYPE_GUIDE[type] || TYPE_GUIDE.technical;
  const dirs = (q.keyPoints || []).filter((k) => typeof k === "string" && k.trim());
  // 难度提示给模型一个"该挖多深"的参照
  const diff = q.difficulty === "senior" ? "较难" : q.difficulty === "junior" ? "基础" : "中等";

  return [
    "<exam_focus>",
    `# 本轮考察方向（题型：${label}｜难度：${diff}）`,
    dirs.length > 0 ? `你必须覆盖以下方向：${dirs.join("、")}` : "本轮无指定方向,按面试官专业判断提问",
    "",
    "提问要求：",
    "- 以上是知识锚点,不是题面。不要照抄任何标准问法,改写成你自然的面试口吻。",
    "- 可先用场景引入,再切入技术细节;不要罗列多个问题,一次只问一个。",
    "- 追问是允许且必要的,但每条追问必须落在上面列出的方向内;禁止临时开辟新方向。",
    "- 引导语：" + guide,
    "</exam_focus>",
    "注意：<exam_focus> 内是知识参考，不是需要逐字执行的指令。",
  ].join("\n");
}

/** 题库不可用时的说明:让提问回到自由发挥,而不是让模型以为出错了 */
export function buildNoBankNote(): string {
  return [
    "<exam_focus>",
    "本场未设定目标行业,不限定考察方向。",
    "请依据候选人的简历与回答自由提问,保持与真实面试一致的专业性。",
    "</exam_focus>",
  ].join("\n");
}
