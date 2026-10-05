import { create } from "zustand";
import { api } from "@/api/client";
import { normalizeAgent, type Agent } from "@/types/agent";

interface AgentState {
  agents: Agent[];
  currentAgent: Agent | null;
  loading: boolean;
  error: string | null;

  // v6:支持按 kind 过滤(interviewer / candidate),不传则加载全部
  loadAgents: (kind?: "interviewer" | "candidate") => Promise<void>;
  addAgent: (data: any) => Promise<Agent>;
  updateAgent: (id: string, basic: any, version: any) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  selectAgent: (agent: Agent | null) => void;
  setError: (err: string | null) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  currentAgent: null,
  loading: false,
  error: null,

  loadAgents: async (kind) => {
    set({ loading: true, error: null });
    try {
      const list = await api.listAgents(kind);
      const agents = (list || []).map(normalizeAgent);
      set({ agents, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || "加载 Agent 列表失败" });
    }
  },

  addAgent: async (data) => {
    set({ error: null });
    const raw = await api.createAgent(data);
    const agent = normalizeAgent(raw);
    set((s) => ({ agents: [...s.agents, agent] }));
    return agent;
  },

  updateAgent: async (id, basic, version) => {
    set({ error: null });
    // R32(ISSUE-065):改为**一次请求**。
    // 此前是 await updateAgentBasic() → await createAgentVersion() 两步,
    // 第二步失败时第一步已落库:后端半状态 + 版本链断裂,而前端 set() 从未执行,
    // 仍显示旧值 —— 用户看到"保存失败",刷新后才发现基本信息其实改了。
    // 现在由服务端在一个事务里完成,失败则两边都不变。
    const rawVersion = await api.updateAgent(id, basic, version);
    const updated = normalizeAgent({
      ...(rawVersion || {}),
      agentId: id,
      name: basic.name,
      avatar: basic.avatar,
      role: basic.role,
      currentVersion: version,
      // rawVersion 是 AgentVersion(后端返回 agent_versions 表行),versionId 是其主键
      currentVersionId: rawVersion?.versionId,
      // v5:保留头像与默认模型字段
      iconType: basic.iconType,
      iconValue: basic.iconValue,
      preferredProviderId: basic.preferredProviderId,
      // v6:保留 agent 种类与候选人画像
      agentKind: basic.agentKind,
      candidatePersona: basic.candidatePersona,
    });
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? updated : a)),
      currentAgent: s.currentAgent?.id === id ? updated : s.currentAgent,
    }));
  },

  deleteAgent: async (id) => {
    set({ error: null });
    await api.deleteAgent(id);
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
      currentAgent: s.currentAgent?.id === id ? null : s.currentAgent,
    }));
  },

  selectAgent: (agent) => set({ currentAgent: agent }),

  setError: (err) => set({ error: err }),
}));
