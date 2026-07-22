import { create } from "zustand";
import type { SessionDifficulty, StageAgentBinding } from "@/types/session";
import type { Session } from "@/api/types";
import type { Message } from "@/components/interview/MessageBubble";
import type { Material } from "@/lib/contextInjector";

interface SessionState {
  currentSession: Session | null;
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
  materials: Material[];

  // v5:多 Agent 协同
  agentTeam: string[]; // 选中的 Agent ID 列表
  stageAgentMap: Record<number, StageAgentBinding[]>; // 阶段索引 → 绑定列表
  activeAgentId: string | null; // 当前发言 Agent
  // v5:会话难度
  difficulty: SessionDifficulty;

  setSession: (session: Session | null) => void;
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (delta: string) => void;
  resetStreaming: () => void;
  setError: (err: string | null) => void;
  addMaterial: (material: Material) => void;
  removeMaterial: (id: string) => void;
  clearMaterials: () => void;

  // v5:多 Agent 操作
  setAgentTeam: (ids: string[]) => void;
  setStageAgentMap: (map: Record<number, StageAgentBinding[]>) => void;
  updateStageBindings: (stageIndex: number, bindings: StageAgentBinding[]) => void;
  setActiveAgent: (id: string | null) => void;
  setDifficulty: (d: SessionDifficulty) => void;
  resetTeam: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  currentSession: null,
  messages: [],
  isStreaming: false,
  streamingContent: "",
  error: null,
  materials: [],

  // v5
  agentTeam: [],
  stageAgentMap: {},
  activeAgentId: null,
  difficulty: "normal",

  setSession: (session) => set({
    currentSession: session,
    messages: [],
    streamingContent: "",
    isStreaming: false,
    error: null,
    // materials 不清空,因为可能跨会话使用
  }),

  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),

  setMessages: (messages) => set({ messages }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setStreamingContent: (content) => set({ streamingContent: content }),

  appendStreamingContent: (delta) =>
    set((s) => ({ streamingContent: s.streamingContent + delta })),

  resetStreaming: () => set({ streamingContent: "", isStreaming: false }),

  setError: (err) => set({ error: err }),

  addMaterial: (material) =>
    set((s) => ({ materials: [...s.materials, material] })),

  removeMaterial: (id) =>
    set((s) => ({ materials: s.materials.filter((m) => m.id !== id) })),

  clearMaterials: () => set({ materials: [] }),

  // v5
  setAgentTeam: (ids) => set({ agentTeam: ids }),
  setStageAgentMap: (map) => set({ stageAgentMap: map }),
  updateStageBindings: (stageIndex, bindings) =>
    set((s) => ({ stageAgentMap: { ...s.stageAgentMap, [stageIndex]: bindings } })),
  setActiveAgent: (id) => set({ activeAgentId: id }),
  setDifficulty: (d) => set({ difficulty: d }),
  resetTeam: () => set({ agentTeam: [], stageAgentMap: {}, activeAgentId: null, difficulty: "normal" }),
}));
