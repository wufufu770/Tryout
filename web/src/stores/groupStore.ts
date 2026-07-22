// v5:会话分组状态管理
import { create } from "zustand";
import { api } from "@/api/client";
import type { SessionGroup } from "@/types/session";

interface GroupState {
  groups: SessionGroup[];
  loading: boolean;
  error: string | null;

  loadGroups: () => Promise<void>;
  createGroup: (data: { name: string; description?: string; color?: string }) => Promise<SessionGroup>;
  updateGroup: (id: string, data: Partial<SessionGroup>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  refreshSummary: (id: string, summary: string) => void;
  setError: (err: string | null) => void;
}

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  loading: false,
  error: null,

  loadGroups: async () => {
    set({ loading: true, error: null });
    try {
      const list = (await api.listSessionGroups()) || [];
      set({ groups: list, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || "加载分组失败" });
    }
  },

  createGroup: async (data) => {
    const g = await api.createSessionGroup(data);
    set((s) => ({ groups: [...s.groups, g] }));
    return g;
  },

  updateGroup: async (id, data) => {
    const updated = await api.updateSessionGroup(id, data);
    set((s) => ({ groups: s.groups.map((g) => (g.groupId === id ? updated : g)) }));
  },

  deleteGroup: async (id) => {
    await api.deleteSessionGroup(id);
    set((s) => ({ groups: s.groups.filter((g) => g.groupId !== id) }));
  },

  refreshSummary: (id, summary) => {
    set((s) => ({
      groups: s.groups.map((g) =>
        g.groupId === id ? { ...g, summary, summaryGeneratedAt: new Date().toISOString() } : g
      ),
    }));
  },

  setError: (err) => set({ error: err }),
}));
