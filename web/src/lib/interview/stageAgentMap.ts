// InterviewPage 纯函数:构造多 Agent 默认阶段绑定
// 抽取为独立模块,便于单元测试与复用
// v7:首个 Agent 为 primary,其余为 assistant
import type { Agent } from "@/types/agent";
import type { StageAgentBinding } from "@/types/session";

export function buildDefaultStageAgentMap(
  matchedAgents: Agent[],
  stages: string[]
): Record<number, StageAgentBinding[]> {
  if (matchedAgents.length === 0 || stages.length === 0) return {};
  const map: Record<number, StageAgentBinding[]> = {};
  matchedAgents.forEach((agent, idx) => {
    for (let i = 0; i < stages.length; i++) {
      if (!map[i]) map[i] = [];
      if (idx === 0 && map[i].length === 0) {
        map[i].push({ stageIndex: i, agentId: agent.id, roleInStage: "primary", askMode: "sequential", sortOrder: 0 });
      } else if (!map[i].some((b) => b.agentId === agent.id)) {
        map[i].push({ stageIndex: i, agentId: agent.id, roleInStage: "assistant", askMode: "sequential", sortOrder: map[i].length });
      }
    }
  });
  return map;
}
