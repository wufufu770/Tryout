// 阶段推进决策 —— 纯函数
//
// 背景(W5-2):`InterviewPage.tsx:936` 原为
//   `Math.floor(totalMessages / 6)` —— **不管聊的是什么,每 6 条消息跳一个阶段**。
// 真实面试里,面试官判断"这块问够了"才换方向;且各阶段深度差异极大
// (自我介绍 3 轮足够,项目深挖可能 10 轮),固定 3 轮既可能太快也可能太慢。
//
// 为什么不让 LLM 独占决策权:
//   1. 阶段判断每轮都做,让 LLM 独立判断 = 每轮多一次 LLM 调用(成本翻倍)
//   2. LLM 判断会抖 —— 同一段对话两次运行可能给出不同结论,而练习需要可复现
//
// 所以采用**混合策略**:
//   LLM 只给"建议信号"([STAGE_STATUS] / [COVERAGE]),**覆盖规则兜底**。
//   信号缺失或解析失败 → 退回轮数规则,行为可预期。
//   明确的 continue → 压制覆盖规则(内容判断优先于轮数)。
import { parseStageSignal, stripStageMarkers, stripThinkBlocks } from "./stageAdvanceSignal";

export { parseStageSignal, stripStageMarkers, stripThinkBlocks };
export type { StageSignal } from "./stageAdvanceSignal";

/** 各阶段默认轮数上限(覆盖规则) */
export const DEFAULT_STAGE_TURNS = 3;

export interface AdvanceParams {
  /** 本阶段已进行的问答轮数 */
  totalTurns: number;
  /** LLM 给出的信号;null = 没有信号或解析失败 */
  signal: ReturnType<typeof parseStageSignal> | null;
  stageIndex: number;
  totalStages: number;
  minTurns?: number;
  maxTurns?: number;
}

/**
 * 是否推进到下一阶段。
 *
 * 优先级(LLM 信号 > 覆盖规则):
 *   1. 最后一阶段 → 永不推进
 *   2. 轮数 < minTurns → 不推进(防止开场就跳)
 *   3. LLM 明确 continue → 不推进(内容判断优先,即使超轮数)
 *   4. LLM 明确 advance → 推进
 *   5. 轮数 >= maxTurns → 强制推进(防止卡死)
 *   6. 其余 → 不推进
 */
export function shouldAdvanceStage(p: AdvanceParams): boolean {
  const { totalTurns, signal, stageIndex, totalStages } = p || ({} as AdvanceParams);
  const minTurns = p?.minTurns ?? 1;
  const maxTurns = p?.maxTurns ?? DEFAULT_STAGE_TURNS;

  if (!Number.isFinite(totalTurns) || !Number.isFinite(stageIndex) || !Number.isFinite(totalStages)) {
    return false;
  }
  // 1) 最后一阶段
  if (stageIndex >= totalStages - 1) return false;
  // 2) 至少聊够 minTurns
  if (totalTurns < minTurns) return false;

  // 3) LLM 明确说"继续问"→ 内容判断优先,压制轮数强制
  if (signal && signal.advance === false) return false;
  // 4) LLM 说"可以换方向了"
  if (signal && signal.advance === true) return true;
  // 5) 无信号:轮数达到上限则兜底推进(非法 maxTurns 不生效)
  if (Number.isFinite(maxTurns) && maxTurns > 0 && totalTurns >= maxTurns) return true;
  // 6) 其余保持
  return false;
}
