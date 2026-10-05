// 面试现场教练 —— 纯逻辑层
//
// 背景(W4-3):评估目前只在历史页手动触发,用户答完当场零反馈。
// 但"每答一句就评一次"同样糟糕:
//   - 成本爆炸(ADR-001 已让单次评估变成 6 个 LLM 调用)
//   - 打断心流(用户还在想下一题,却弹出评分)
//
// 所以把"何时评估""评哪一对问答"两件事抽成纯函数并锁死,
// 让成本/节奏的取舍是显式的、可测的、可调的 —— 而不是散落在组件里。

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  messageId?: string;
  [k: string]: unknown;
}

export interface QaPair {
  /** 面试官问的内容 */
  question: string;
  /** 候选人的回答 */
  answer: string;
  /** 回答对应的 messageId,用于把评估落库关联到消息 */
  messageId?: string;
  /** 回答轮次(第几次用户发言),用于节奏控制 */
  round: number;
}

const BLANK = /^\s*$/;

/**
 * 找出"最后一组完整的 面试官提问 → 候选人回答"。
 * 最后一组还没答完时返回 null —— 不对半截对话做评估。
 */
export function findLatestQaPair(messages: ChatMessage[]): QaPair | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  // 从后往前找最后一个非空回答
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    // 空的/纯空白的用户消息直接跳过,继续往前找
    // ⚠️ 不能在这里 return null:消息列表里可能夹着"输入框回车产生的空 user 消息",
    //    遇到就退出会让后面明明有完整问答的场景拿不到评估机会。
    if (BLANK.test(m.content || "")) continue;

    // 往前找最近的一条非空面试官提问
    for (let j = i - 1; j >= 0; j--) {
      const q = messages[j];
      if (!q || q.role !== "assistant") continue;
      if (BLANK.test(q.content || "")) continue;

      // 回答轮次 = 该回答之前 user 消息的条数
      let round = 0;
      for (let k = 0; k <= i; k++) {
        const mm = messages[k];
        if (mm && mm.role === "user" && !BLANK.test(mm.content || "")) round++;
      }
      return {
        question: q.content,
        answer: m.content,
        messageId: m.messageId,
        round,
      };
    }
    // 前面没有面试官提问(例如开场白),不算一对
    return null;
  }
  return null;
}

export interface EvalTiming {
  /** 已完成的回答轮数 */
  answeredRounds: number;
  /** 上次评估时的 answeredRounds(0 = 从未评估) */
  lastEvaluatedRound: number;
  /** 评估间隔(每 N 轮评一次) */
  interval: number;
}

/**
 * 是否此刻该评估。
 *
 * 几条硬规则(都有测试锁定):
 *   - answeredRounds <= lastEvaluatedRound → 已评过或切了会话,不评
 *   - interval <= 0 → 非法配置,退化为"不评估"而不是"每轮都评"
 *     (后者会在配置失误时静默烧掉大量 token)
 *   - 距上次评估不足 interval 轮 → 不评
 */
export function shouldEvaluateNow(t: EvalTiming): boolean {
  const { answeredRounds, lastEvaluatedRound, interval } = t || ({} as EvalTiming);
  if (!Number.isFinite(answeredRounds) || answeredRounds <= 0) return false;
  // 轮数倒退 = 换了会话
  if (answeredRounds <= lastEvaluatedRound) return false;
  if (!Number.isFinite(interval) || interval <= 0) return false;
  return answeredRounds - lastEvaluatedRound >= interval;
}

// ---- R32(ISSUE-038):题目级评分基准的接线决策 ----

/** 与 scoringEngine.QuestionReference 同构 —— 这里只声明用到的字段 */
export interface ScoringReference {
  keyPoints: string[];
  referenceAnswer: string;
  questionType?: string;
}

export interface ResolvedReference {
  /** 传给 scoreWithRetry 的第 4 个参数;拿不到时是 undefined(明确降级) */
  reference: ScoringReference | undefined;
  /**
   * UI 据此渲染 liveCoach.bankBased / liveCoach.freeBased ——
   * 即"这次评分有没有客观基准"。10 种语言都拿它当事实陈述给用户看。
   */
  bankReferenced: boolean;
}

/**
 * 决定这次评估用不用题目级判据,以及能不能对用户说"用了题库作基准"。
 *
 * ## 为什么要抽成函数而不是在组件里写 `bankReferenced: !!reference`
 * R32 之前的代码是 `bankReferenced: !!currentQuestion`:
 * 判据是"抽到了题库题",而**实际有没有把参考答案喂给评分器**是另一件事。
 * 两者一旦分叉,UI 就会对用户声称用了基准而实际没��� ——
 * 这比单纯缺个参数更糟,它连"这个产品的分数可不可信"一起赔进去。
 *
 * 抽出来之后,`reference` 与 `bankReferenced` 由**同一次求值**产生,
 * 结构上不可能再分叉;且判据本身可被单测钉住。
 *
 * ## 降级原则
 * `rawRef` 为 null(题不存在 / 题库未生成 / 网络失败 / keyPoints 为空)时:
 * 评估照常进行(不因为取不到基准就中断),但 bankReferenced 必须是 false。
 */
export function resolveScoringReference(
  rawRef: { referenceAnswer: string; keyPoints: string[]; type?: string } | null | undefined
): ResolvedReference {
  const kp = Array.isArray(rawRef?.keyPoints)
    ? rawRef.keyPoints
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
    : [];
  const answer = typeof rawRef?.referenceAnswer === "string" ? rawRef.referenceAnswer.trim() : "";
  // 两个字段任一为空,buildReferenceBlock 都会退化成一段没有实质判据的提示,
  // 那和不给基准没有区别 —— 反而会让 UI 谎称有基准。判为无基准。
  if (!rawRef || kp.length === 0 || !answer) {
    return { reference: undefined, bankReferenced: false };
  }
  return {
    reference: {
      keyPoints: kp,
      referenceAnswer: answer,
      questionType: rawRef.type,
    },
    // 与 reference 由同一次求值产生,无法分叉
    bankReferenced: true,
  };
}
