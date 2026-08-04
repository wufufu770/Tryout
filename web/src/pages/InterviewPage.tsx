import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { cn, FLOW_TEMPLATES, getDifficultyConfig, type InterviewScenario } from "@/shared";
import { useI18n } from "@/i18n";
import { useModalA11y } from "@/lib/useModalA11y";
import { useLayoutContext } from "@/components/IdeLayout";
import { useSessionStore } from "@/stores/sessionStore";
import { buildSystemPrompt, type TeamAgentInfo } from "@/lib/contextInjector";
import { buildDefaultStageAgentMap } from "@/lib/interview/stageAgentMap";
import { normalizeAgent, type Agent } from "@/types/agent";
import type { SessionDifficulty, StageAgentBinding, StageAskMode, SessionReview } from "@/types/session";
import { MessageBubble, AgentSwitchDivider, ROLE_LABELS, type Message } from "@/components/interview/MessageBubble";
import { TimerWidget } from "@/components/interview/TimerWidget";
import { MessageInput } from "@/components/interview/MessageInput";
import { SessionConfigPanel } from "@/components/interview/SessionConfigPanel";
import { AgentAvatar } from "@/components/AgentAvatar";
import { SessionReviewCard } from "@/components/SessionReviewCard";
import { AnswerFeedbackPanel } from "@/components/AnswerFeedbackPanel";
import { MeetingRoomView, type MeetingMessage } from "@/components/MeetingRoomView";
import { VoicePanel, type AgentVoiceConfig } from "@/components/VoicePanel";
import { EmptyStateHome } from "@/components/EmptyStateHome";
import { voiceManager } from "@/lib/voiceManager";
import { registerLocalWhisper, setWhisperContext } from "@/lib/asr/localWhisper";
import { buildReviewPrompt, parseReviewResult } from "@/lib/reviewGenerator";
import {
  Loader2, AlertCircle, Paperclip, X, RotateCcw, BookOpen,
  StopCircle, Sparkles,
} from "lucide-react";

interface Provider {
  id: string;
  name?: string;
  dataFlow?: string;
  models?: { id: string; name: string }[];
}

// FLOW_TEMPLATES 中文阶段名 → i18n key 映射
// 仅用于 UI 显示层翻译;数据层(currentStageName 传入 system prompt)保持中文原值
// customStages 用户输入的阶段名不在映射中,helper 会原样返回
const STAGE_I18N_KEYS: Record<string, string> = {
  "自我介绍": "flow.stage.introduction",
  "项目提问": "flow.stage.project",
  "代码题": "flow.stage.coding",
  "系统设计": "flow.stage.systemDesign",
  "反问环节": "flow.stage.qa",
  "团队协作": "flow.stage.teamwork",
  "冲突处理": "flow.stage.conflictResolution",
  "领导力": "flow.stage.leadership",
  "项目深挖": "flow.stage.projectDeepDive",
  "技术追问": "flow.stage.techFollowUp",
  "行为问题": "flow.stage.behavioralQuestion",
  "需求澄清": "flow.stage.requirementClarification",
  "容量估算": "flow.stage.capacityEstimation",
  "高层设计": "flow.stage.highLevelDesign",
  "详细设计": "flow.stage.detailedDesign",
  "扩展与容灾": "flow.stage.scalabilityAndDisasterRecovery",
};

// 安全 P0:?focus= prompt injection 防御
// 仅允许中文、字母、数字、空格、常见标点(，。、、；：""''！？()-_),长度 ≤ 200
// 含危险关键词(忽略/ignore/system prompt/系统提示/instruction 等)直接清空
const FOCUS_DANGEROUS_KEYWORDS = [
  "忽略", "ignore", "system prompt", "系统提示", "instruction", "instructions",
  "disregard", "override", "new instruction", "above instructions", "previous instructions",
];
const FOCUS_ALLOWED_RE = /^[\u4e00-\u9fa5a-zA-Z0-9\s，。、；：""''！？()\-_]*$/;
function sanitizeFocus(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  // 危险关键词:直接清空
  for (const kw of FOCUS_DANGEROUS_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return "";
  }
  // 过滤非法字符
  const filtered = raw.split("").filter((ch) => FOCUS_ALLOWED_RE.test(ch)).join("");
  // 长度截断
  return filtered.slice(0, 200);
}

export function InterviewPage() {
  const { setStatusBar } = useLayoutContext();
  const { t } = useI18n();

  // sessionStore 状态
  const currentSession = useSessionStore((s) => s.currentSession);
  const messages = useSessionStore((s) => s.messages);
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const streamingContent = useSessionStore((s) => s.streamingContent);
  const error = useSessionStore((s) => s.error);
  const materials = useSessionStore((s) => s.materials);
  const difficulty = useSessionStore((s) => s.difficulty);
  const setSession = useSessionStore((s) => s.setSession);
  const addMessage = useSessionStore((s) => s.addMessage);
  const setMessages = useSessionStore((s) => s.setMessages);
  const setStreaming = useSessionStore((s) => s.setStreaming);
  const setStreamingContent = useSessionStore((s) => s.setStreamingContent);
  const appendStreamingContent = useSessionStore((s) => s.appendStreamingContent);
  const resetStreaming = useSessionStore((s) => s.resetStreaming);
  const setError = useSessionStore((s) => s.setError);
  const addMaterial = useSessionStore((s) => s.addMaterial);
  const removeMaterial = useSessionStore((s) => s.removeMaterial);
  const clearMaterials = useSessionStore((s) => s.clearMaterials);
  const setDifficulty = useSessionStore((s) => s.setDifficulty);

  // 会话配置
  const [title, setTitle] = useState("");
  const [flow, setFlow] = useState<string>("tech");
  const [customStages, setCustomStages] = useState<string[]>(["自我介绍", "项目提问", "反问环节"]);
  const [focusDirection, setFocusDirection] = useState("");
  // 面经广场"模拟此题":从 URL ?focus=xxx 预填 focusDirection
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const focus = searchParams.get("focus");
    if (!focus) return;
    // 安全 P0:sanitize 后再 setFocusDirection,防御 prompt injection
    const safe = sanitizeFocus(focus);
    setFocusDirection(safe);
    // 模拟此题=新会话语义,清空旧会话避免上下文错乱(参考 applyScenario 的清空逻辑)
    if (currentSession) {
      setSession(null);
      setMessages([]);
      setError(null);
    }
    // 同步设置会话标题为"模拟:xxx"前缀,便于用户辨识(safe 已经过滤危险内容)
    if (!title && safe) setTitle(t("interview.simulatedTitlePrefix") + (safe.length > 24 ? safe.slice(0, 24) + "…" : safe));
    // 清理 URL 参数,避免刷新重复填充
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [stageIndex, setStageIndex] = useState(0);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  // v10:首屏空状态用 - 最近会话 + 跨场评估
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [allEvaluations, setAllEvaluations] = useState<any[]>([]);

  // v5:单/多 Agent 模式
  const [agentMode, setAgentMode] = useState<"single" | "multi">("single");
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null); // 单 Agent 模式选中
  const [agentTeam, setAgentTeam] = useState<string[]>([]); // 多 Agent 模式:选中的 Agent ID 列表
  const [stageAgentMap, setStageAgentMap] = useState<Record<number, StageAgentBinding[]>>({});
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null); // 当前发言 Agent
  const [lastActiveAgentId, setLastActiveAgentId] = useState<string | null>(null); // 用于切换分隔线

  // 资料多选
  const [availableMaterials, setAvailableMaterials] = useState<any[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [extraMaterialText, setExtraMaterialText] = useState("");

  // 本地运行时
  const [input, setInput] = useState("");
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);

  // v5:整场评价
  const [reviewGenerating, setReviewGenerating] = useState(false);
  const [currentReview, setCurrentReview] = useState<SessionReview | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  // v10.2.6(D3):整场回顾评价 Modal a11y(Escape 关闭 + focus trap)
  const reviewModalRef = useModalA11y(() => setShowReviewModal(false), showReviewModal);
  // v6:视图模式 - list(默认) / room(会议室)
  const [viewMode, setViewMode] = useState<"list" | "room">("list");
  // v7:面试场景剧本
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [showScenarioPicker, setShowScenarioPicker] = useState(false);
  const [pendingScenario, setPendingScenario] = useState<InterviewScenario | null>(null);
  // v10 C2:配置面板渐进式披露 - 默认折叠高级配置(难度/流程/重点/资料/面试官)
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 方案 10:语音对话系统(L0 浏览器原生 Web Speech API)
  // autoSpeak / voiceConfigs 持久化到 localStorage,刷新后保留用户偏好
  const [autoSpeak, setAutoSpeakState] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem("tryout:voice:autoSpeak") || "false"); }
    catch { return false; }
  });
  const setAutoSpeak = useCallback((v: boolean) => {
    // 关闭时停止当前正在朗读的 utterance,避免 autoSpeak 关闭后仍在播放
    if (!v) voiceManager.stop();
    setAutoSpeakState(v);
    try { localStorage.setItem("tryout:voice:autoSpeak", JSON.stringify(v)); } catch (e) { console.warn("Failed to persist autoSpeak:", e); }
  }, []);

  const [voiceConfigs, setVoiceConfigsState] = useState<Record<string, AgentVoiceConfig>>(() => {
    try { return JSON.parse(localStorage.getItem("tryout:voice:configs") || "{}"); }
    catch { return {}; }
  });
  // 兼容直接赋值与函数式更新两种用法(setVoiceConfigs(prev => ...))
  const setVoiceConfigs = useCallback(
    (v: Record<string, AgentVoiceConfig> | ((prev: Record<string, AgentVoiceConfig>) => Record<string, AgentVoiceConfig>)) => {
      setVoiceConfigsState((prev) => {
        const next = typeof v === "function" ? (v as (p: Record<string, AgentVoiceConfig>) => Record<string, AgentVoiceConfig>)(prev) : v;
        try { localStorage.setItem("tryout:voice:configs", JSON.stringify(next)); } catch (e) { console.warn("Failed to persist voiceConfigs:", e); }
        return next;
      });
    },
    []
  );
  const lastSpokenMsgIdRef = useRef<string | null>(null);

  // v11:注册本地 whisper ASR(服务端转写)为默认识别引擎
  // 页面挂载即注册,依赖 VoicePanel 内部 asrRegistry.getDefault() 在渲染时读取
  useEffect(() => {
    registerLocalWhisper();
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserContentRef = useRef<string>("");
  const sendingRef = useRef(false);

  const isCustomFlow = flow === "custom";
  const stages = isCustomFlow ? customStages : FLOW_TEMPLATES[flow]?.stages || [];
  const currentStageName = stages[stageIndex] || stages[0] || "面试";

  // 阶段名 UI 显示层翻译:FLOW_TEMPLATES 阶段走 i18n,customStages 用户输入原样返回
  // 注:数据层(currentStageName 传入 system prompt)保持中文原值,不调用此 helper
  const stageNameI18n = (name: string): string => {
    const k = STAGE_I18N_KEYS[name];
    if (!k) return name;
    const v = t(k);
    return v === k ? name : v;
  };

  // 当前阶段的绑定(多 Agent 模式)
  const currentStageBindings = stageAgentMap[stageIndex] || [];
  const currentStageAskMode: StageAskMode = currentStageBindings[0]?.askMode || "sequential";

  // 加载 providers、agents、materials
  useEffect(() => {
    api
      .listProviders()
      .then((p) => {
        const list = p || [];
        setProviders(list);
      })
      .catch((e: any) => setError(t("interview.errors.loadProvidersFailed", { msg: String(e.message) })));

    api
      .listAgents()
      .then((a) => {
        const list = (a || []).map(normalizeAgent);
        setAgents(list);
        if (list.length > 0) setCurrentAgent(list[0]);
      })
      .catch((e: any) => setError(t("interview.errors.loadAgentsFailed", { msg: String(e.message) })));

    api
      .listMaterials()
      .then((m) => setAvailableMaterials(m || []))
      .catch((e) => console.warn("Failed to load materials list:", e));

    // v10:首屏空状态用 - 加载最近会话 + 跨场评估
    api.listSessions().then(setRecentSessions).catch((e) => console.warn("Failed to load recent sessions:", e));
    api.listAllEvaluations().then(setAllEvaluations).catch((e) => console.warn("Failed to load evaluations:", e));
  }, [setError]);

  // 解析 Agent ID → Agent 对象
  const getAgentById = useCallback((id: string | null) => agents.find((a) => a.id === id) || null, [agents]);

  // 当前发言 Agent(多 Agent 模式用 activeAgentId,单 Agent 用 currentAgent)
  const activeAgent = agentMode === "multi" ? getAgentById(activeAgentId) : currentAgent;

  // 当前发言 Agent 使用的模型(优先 Agent.preferredProviderId,回退全局 active provider)
  const resolveAgentModel = useCallback((agent: Agent | null): string => {
    if (agent?.preferredProviderId) {
      // 校验 provider 是否存在
      const exists = providers.find((p) => p.id === agent.preferredProviderId);
      if (exists) return agent.preferredProviderId;
    }
    // 回退:全局 active provider
    const active = providers.find((p) => (p as any).isActive);
    return active?.id || providers[0]?.id || "";
  }, [providers]);

  const currentModel = resolveAgentModel(activeAgent);
  const currentProvider = providers.find((p) => p.id === currentModel);

  // 方案 10:最近一条面试官消息(供 VoicePanel 手动播放 / 自动朗读)
  const lastAssistantText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as Message;
      if (m.role === "assistant") {
        // 多 Agent 组合消息:拼接各角色内容
        if (m.isMultiAgentGroup && m.groupItems) {
          return m.groupItems.map((g) => g.content).join("。");
        }
        return m.content;
      }
    }
    return "";
  }, [messages]);

  // v11:最近一轮问答(供逐题评分) - 最后一条面试官问题 + 最后一条用户回答
  const lastExchangeForScore = useMemo<{ question: string; answer: string } | null>(() => {
    let question = "";
    let answer = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as Message;
      const content = m.isMultiAgentGroup && m.groupItems
        ? m.groupItems.map((g) => g.content).join("。")
        : m.content;
      if (!answer && m.role === "user" && content.trim()) {
        answer = content;
      } else if (!question && m.role === "assistant" && content.trim()) {
        question = content;
      }
      if (answer && question) break;
    }
    return answer && question ? { question, answer } : null;
  }, [messages]);

  // v11:同步语音上下文(当前会话 + 最新面试官提问)供 whisper 转写入库
  useEffect(() => {
    setWhisperContext(currentSession?.sessionId || null, lastAssistantText);
  }, [currentSession, lastAssistantText]);

  // 同步状态栏
  // 注:t 加入依赖,切换语言后状态栏文字也会更新
  useEffect(() => {
    setStatusBar({
      sessionLabel: currentSession?.title || title || t("interview.unnamedSession"),
      modelLabel: currentProvider?.name || currentModel,
      reasoning: false,
    });
  }, [currentSession, title, currentProvider, currentModel, setStatusBar, t]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // 方案 10:自动朗读面试官消息(autoSpeak 开启时,新 assistant 消息到达即朗读)
  useEffect(() => {
    if (!autoSpeak) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant") as Message | undefined;
    if (!last) return;
    // 无 messageId/id 时(如 addMessage 失败回退的本地消息)用内容前缀 hash 作为去重 key,避免静默跳过
    const msgId = last.messageId || last.id || `content-${last.content.slice(0, 32)}`;
    if (lastSpokenMsgIdRef.current === msgId) return;
    lastSpokenMsgIdRef.current = msgId;
    const text = last.isMultiAgentGroup && last.groupItems
      ? last.groupItems.map((g) => g.content).join("。")
      : last.content;
    const cfg = (last.agentId && voiceConfigs[last.agentId]) || {};
    voiceManager.speak(text, { voiceURI: cfg.voiceURI, rate: cfg.rate, pitch: cfg.pitch });
  }, [messages, autoSpeak, voiceConfigs]);

  // 构建团队信息(用于 system prompt)
  const buildTeamInfo = useCallback((speakerAgent: Agent): { active: TeamAgentInfo; team: TeamAgentInfo[] } => {
    if (agentMode !== "multi" || agentTeam.length <= 1) {
      return {
        active: { id: speakerAgent.id, name: speakerAgent.name, role: ROLE_LABELS[speakerAgent.role] || speakerAgent.role, isSelf: true },
        team: [{ id: speakerAgent.id, name: speakerAgent.name, role: ROLE_LABELS[speakerAgent.role] || speakerAgent.role, isSelf: true }],
      };
    }
    const team: TeamAgentInfo[] = agentTeam.map((id) => {
      const a = getAgentById(id);
      return {
        id,
        name: a?.name || t("common.unknown"),
        role: ROLE_LABELS[a?.role || "custom"] || a?.role || t("common.custom"),
        isSelf: id === speakerAgent.id,
      };
    });
    return {
      active: team.find((t) => t.isSelf)!,
      team,
    };
  }, [agentMode, agentTeam, getAgentById]);

  const getSystemPrompt = useCallback((speakerAgent: Agent, askMode?: StageAskMode) => {
    const tpl = speakerAgent.config?.promptTemplate || t("interview.prompts.defaultInterviewer");
    const { active, team } = buildTeamInfo(speakerAgent);
    const diffCfg = getDifficultyConfig(difficulty);
    return buildSystemPrompt(tpl, currentStageName, materials, focusDirection, {
      activeAgent: active,
      teamAgents: team,
      difficultyPrompt: diffCfg.prompt,
      askMode: askMode || currentStageAskMode,
    });
  }, [buildTeamInfo, currentStageName, materials, focusDirection, difficulty, currentStageAskMode]);

  // 资料勾选:加载内容并注入
  const handleToggleMaterial = useCallback(async (matId: string) => {
    if (selectedMaterialIds.includes(matId)) {
      setSelectedMaterialIds((prev) => prev.filter((id) => id !== matId));
      removeMaterial(matId);
    } else {
      try {
        const mat = availableMaterials.find((m) => (m.materialId || m.id) === matId);
        const resp = await api.getMaterialContent(matId);
        const content = typeof resp === "string" ? resp : resp?.rawText || resp?.content || "";
        addMaterial({ id: matId, type: mat?.type || "text", title: mat?.title || t("common.material"), content });
        setSelectedMaterialIds((prev) => [...prev, matId]);
      } catch (e: any) {
        setError(t("interview.errors.loadMaterialContentFailed", { msg: String(e.message) }));
      }
    }
  }, [selectedMaterialIds, availableMaterials, addMaterial, removeMaterial, setError]);

  // 自定义阶段编辑
  const handleStageChange = (i: number, value: string) => {
    setCustomStages((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  };
  const handleAddStage = () => setCustomStages((prev) => [...prev, "新阶段"]);
  const handleRemoveStage = (i: number) => {
    if (customStages.length <= 1) return;
    setCustomStages((prev) => prev.filter((_, idx) => idx !== i));
  };

  // v5:多 Agent 模式 - 切换 Agent 选中
  const handleToggleAgentTeam = (id: string) => {
    if (agentTeam.includes(id)) {
      const next = agentTeam.filter((x) => x !== id);
      setAgentTeam(next);
      if (activeAgentId === id) setActiveAgentId(next[0] || null);
      // 清理该 Agent 在阶段绑定中的记录
      setStageAgentMap((prev) => {
        const updated = { ...prev };
        for (const k of Object.keys(updated)) {
          updated[Number(k)] = updated[Number(k)].filter((b) => b.agentId !== id);
        }
        return updated;
      });
    } else {
      if (agentTeam.length >= 6) {
        setError(t("interview.errors.maxAgentsExceeded"));
        return;
      }
      const next = [...agentTeam, id];
      setAgentTeam(next);
      if (!activeAgentId) setActiveAgentId(id);
      // 默认绑定:把新 Agent 加到所有阶段作为 primary(若该阶段无 primary)或 assistant
      setStageAgentMap((prev) => {
        const updated = { ...prev };
        for (let i = 0; i < stages.length; i++) {
          const existing = updated[i] || [];
          if (existing.length === 0) {
            updated[i] = [{ stageIndex: i, agentId: id, roleInStage: "primary", askMode: "sequential", sortOrder: 0 }];
          }
        }
        return updated;
      });
    }
  };

  // v5:修改某阶段的 Agent 绑定
  const handleStageAgentChange = (stageIdx: number, bindingIdx: number, field: keyof StageAgentBinding, value: string) => {
    setStageAgentMap((prev) => {
      const list = [...(prev[stageIdx] || [])];
      if (list[bindingIdx]) {
        list[bindingIdx] = { ...list[bindingIdx], [field]: value } as StageAgentBinding;
      }
      return { ...prev, [stageIdx]: list };
    });
  };

  // v5:某阶段添加 Agent 绑定
  const handleAddStageAgent = (stageIdx: number) => {
    const available = agentTeam.filter((id) => !(stageAgentMap[stageIdx] || []).some((b) => b.agentId === id));
    if (available.length === 0) return;
    setStageAgentMap((prev) => {
      const list = [...(prev[stageIdx] || [])];
      list.push({ stageIndex: stageIdx, agentId: available[0], roleInStage: "assistant", askMode: list[0]?.askMode || "sequential", sortOrder: list.length });
      return { ...prev, [stageIdx]: list };
    });
  };

  // v5:某阶段移除 Agent 绑定(至少保留 1 个 primary)
  const handleRemoveStageAgent = (stageIdx: number, bindingIdx: number) => {
    setStageAgentMap((prev) => {
      const list = [...(prev[stageIdx] || [])];
      if (list.length <= 1) return prev; // 至少保留 1 个
      list.splice(bindingIdx, 1);
      // 若删的是 primary,把第一个设为 primary
      if (!list.some((b) => b.roleInStage === "primary")) {
        list[0] = { ...list[0], roleInStage: "primary" };
      }
      return { ...prev, [stageIdx]: list };
    });
  };

  // v5:切换某阶段提问模式
  const handleStageAskModeChange = (stageIdx: number, mode: StageAskMode) => {
    setStageAgentMap((prev) => {
      const list = (prev[stageIdx] || []).map((b) => ({ ...b, askMode: mode }));
      return { ...prev, [stageIdx]: list };
    });
  };

  const createSession = useCallback(async () => {
    setError(null);
    try {
      clearMaterials();
      setSelectedMaterialIds([]);

      if (extraMaterialText.trim()) {
        addMaterial({ id: "extra_text", type: "text", title: t("interview.supplementaryMaterial"), content: extraMaterialText.trim() });
      }

      for (const matId of selectedMaterialIds) {
        const mat = availableMaterials.find((m) => (m.materialId || m.id) === matId);
        if (mat) {
          try {
            const resp = await api.getMaterialContent(matId);
            const content = typeof resp === "string" ? resp : resp?.rawText || resp?.content || "";
            addMaterial({ id: matId, type: mat.type || "text", title: mat.title || t("common.material"), content });
          } catch (e) { console.warn("Failed to load material content for", matId, e); }
        }
      }

      const sess = await api.createSession({
        title: title || t("interview.unnamedSession"),
        modelId: currentModel,
        flowTemplate: isCustomFlow ? "custom" : flow,
        difficulty,
      });
      setSession(sess);

      // 注册 Agent 到会话
      const teamToRegister = agentMode === "multi" ? agentTeam : (currentAgent?.id ? [currentAgent.id] : []);
      for (const aid of teamToRegister) {
        const a = getAgentById(aid);
        if (a) {
          await api.addSessionAgent(sess.sessionId, {
            agentId: aid,
            agentVersionId: a.currentVersionId,
            roleInSession: "primary",
          });
        }
      }

      // 多 Agent 模式:保存阶段绑定
      if (agentMode === "multi") {
        for (const [k, bindings] of Object.entries(stageAgentMap)) {
          if (bindings.length > 0) {
            try {
              await api.saveStageAgents(sess.sessionId, Number(k), bindings);
            } catch (e) { console.warn("Failed to save stage agents for stage", k, e); }
          }
        }
      }

      setStageIndex(0);
      return sess;
    } catch (e: any) {
      setError(t("interview.errors.createSessionFailed", { msg: String(e.message) }));
      return null;
    }
  }, [title, flow, isCustomFlow, difficulty, agentMode, agentTeam, currentAgent, currentModel, selectedMaterialIds, availableMaterials, extraMaterialText, stageAgentMap, getAgentById, setSession, clearMaterials, addMaterial, setError]);

  // 单次 LLM 调用(供多 Agent 并行复用)
  const callLLM = useCallback(async (
    agent: Agent,
    sysPrompt: string,
    history: Array<{ role: string; content: string }>,
    starter: string,
  ): Promise<{ content: string; agent: Agent }> => {
    const modelId = resolveAgentModel(agent);
    const reqMessages = [
      { role: "system", content: sysPrompt },
      ...history,
      { role: "user", content: starter },
    ];
    const result = (await api.chat(modelId, { messages: reqMessages })) as any;
    return { content: result?.content || "", agent };
  }, [resolveAgentModel]);

  const startInterview = useCallback(async () => {
    if (sendingRef.current) return;
    setError(null);
    const speaker = agentMode === "multi" ? (getAgentById(activeAgentId) || getAgentById(agentTeam[0])) : currentAgent;
    if (!speaker) {
      setError(t("interview.errors.selectAgentFirst"));
      return;
    }
    if (!currentModel) {
      setError(t("interview.errors.selectModelFirst"));
      return;
    }
    let sess = currentSession;
    if (!sess) {
      sess = await createSession();
      if (!sess) return;
    }
    sendingRef.current = true;
    setStreaming(true);
    setStreamingContent("");
    setLastActiveAgentId(null);
    setActiveAgentId(speaker.id);
    try {
      const starter = t("interview.prompts.startStarter");

      // 同时提问模式:多个 Agent 并行
      if (agentMode === "multi" && currentStageAskMode === "simultaneous" && currentStageBindings.length > 1) {
        const primaryBindings = currentStageBindings;
        const tasks = primaryBindings.map((b) => {
          const a = getAgentById(b.agentId);
          if (!a) return null;
          const { active, team } = buildTeamInfo(a);
          const sysPrompt = buildSystemPrompt(
            a.config?.promptTemplate || t("interview.prompts.defaultInterviewer"),
            currentStageName, materials, focusDirection,
            { activeAgent: active, teamAgents: team, difficultyPrompt: getDifficultyConfig(difficulty).prompt, askMode: "simultaneous" },
          );
          return callLLM(a, sysPrompt, [], t("interview.prompts.simultaneousQuestion"));
        }).filter(Boolean) as Promise<{ content: string; agent: Agent }>[];

        setStreamingContent(t("interview.streaming.simultaneousAsking", { n: String(currentStageBindings.length) }));
        const results = await Promise.all(tasks);
        resetStreaming();

        const groupItems = results.filter((r) => r.content).map((r) => ({
          agentId: r.agent.id,
          agentName: r.agent.name,
          agentRole: r.agent.role,
          content: r.content,
        }));

        // 用户消息(开场)入库
        const userMsg = await api.addMessage(sess.sessionId, {
          role: "user", content: starter, modelVersion: currentModel,
          agentId: speaker.id, agentVersionId: speaker.currentVersionId, stage: stageIndex,
        });

        // 组合消息入库为一条 assistant 消息(内容拼接)
        const combinedContent = groupItems.map((g) => `【${g.agentName}】${g.content}`).join("\n\n");
        const aiMsg = await api.addMessage(sess.sessionId, {
          role: "assistant", content: combinedContent, modelVersion: currentModel,
          agentId: speaker.id, agentVersionId: speaker.currentVersionId, stage: stageIndex,
        });

        setMessages([
          { role: "user", content: starter, messageId: userMsg?.messageId, createdAt: userMsg?.createdAt },
          { role: "assistant", content: combinedContent, messageId: aiMsg?.messageId, createdAt: aiMsg?.createdAt, agentId: speaker.id, agentName: speaker.name, agentRole: speaker.role, isMultiAgentGroup: true, groupItems },
        ]);
        return;
      }

      // 顺序提问:单个 Agent
      const sysPrompt = getSystemPrompt(speaker);
      const reqMessages = [
        { role: "system", content: sysPrompt },
        { role: "user", content: starter },
      ];
      let acc = "";
      const result = (await api.chat(currentModel, { messages: reqMessages }, (t) => {
        acc += t;
        appendStreamingContent(t);
      })) as any;
      const aiContent = result?.content || acc;
      const userMsg = await api.addMessage(sess.sessionId, {
        role: "user", content: starter, modelVersion: currentModel,
        agentId: speaker.id, agentVersionId: speaker.currentVersionId, stage: stageIndex,
      });
      const aiMsg = await api.addMessage(sess.sessionId, {
        role: "assistant", content: aiContent, modelVersion: currentModel,
        agentId: speaker.id, agentVersionId: speaker.currentVersionId, stage: stageIndex,
        isDegraded: result?.degraded || false,
      });
      setMessages([
        { role: "user", content: starter, messageId: userMsg?.messageId, createdAt: userMsg?.createdAt },
        { role: "assistant", content: aiContent, messageId: aiMsg?.messageId, createdAt: aiMsg?.createdAt, agentId: speaker.id, agentName: speaker.name, agentRole: speaker.role },
      ]);
    } catch (e: any) {
      setError(t("interview.errors.startInterviewFailed", { msg: String(e.message) }));
    } finally {
      sendingRef.current = false;
      resetStreaming();
    }
  }, [agentMode, activeAgentId, agentTeam, currentAgent, currentModel, currentSession, createSession, currentStageAskMode, currentStageBindings, getAgentById, buildTeamInfo, currentStageName, materials, focusDirection, difficulty, getSystemPrompt, stageIndex, appendStreamingContent, resetStreaming, setMessages, setStreaming, setStreamingContent, setActiveAgentId, setLastActiveAgentId, setError]);

  const sendMessage = useCallback(async (contentOverride?: string) => {
    if (sendingRef.current) return;
    // v6-fix:支持 contentOverride,避免 room 视图 setInput+setTimeout 闭包陷阱
    const effectiveInput = contentOverride ?? input;
    if (!effectiveInput.trim() || isStreaming) return;
    setError(null);
    if (!currentSession) {
      setError(t("interview.errors.createSessionFirst"));
      return;
    }
    if (!activeAgent) {
      setError(t("interview.errors.selectAgentFirst"));
      return;
    }
    const userContent = effectiveInput.trim();
    setInput("");
    lastUserContentRef.current = userContent;

    let userMsg: any;
    try {
      userMsg = await api.addMessage(currentSession.sessionId, {
        role: "user", content: userContent, modelVersion: currentModel,
        agentId: activeAgent.id, agentVersionId: activeAgent.currentVersionId, stage: stageIndex,
      });
    } catch (e: any) {
      setError(t("interview.errors.saveMessageFailed", { msg: String(e.message) }));
      return;
    }
    const userMsgObj: Message = {
      role: "user", content: userContent, messageId: userMsg?.messageId, createdAt: userMsg?.createdAt,
    };
    const nextMessages = [...messages, userMsgObj];
    setMessages(nextMessages);

    sendingRef.current = true;
    setStreaming(true);
    setStreamingContent("");
    try {
      const history = nextMessages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));

      // 同时提问模式:多 Agent 并行
      if (agentMode === "multi" && currentStageAskMode === "simultaneous" && currentStageBindings.length > 1) {
        const tasks = currentStageBindings.map((b) => {
          const a = getAgentById(b.agentId);
          if (!a) return null;
          const { active, team } = buildTeamInfo(a);
          const sysPrompt = buildSystemPrompt(
            a.config?.promptTemplate || t("interview.prompts.defaultInterviewer"),
            currentStageName, materials, focusDirection,
            { activeAgent: active, teamAgents: team, difficultyPrompt: getDifficultyConfig(difficulty).prompt, askMode: "simultaneous" },
          );
          return callLLM(a, sysPrompt, history, t("interview.prompts.simultaneousFollowUp"));
        }).filter(Boolean) as Promise<{ content: string; agent: Agent }>[];

        setStreamingContent(t("interview.streaming.simultaneousFollowUp", { n: String(currentStageBindings.length) }));
        const results = await Promise.all(tasks);
        resetStreaming();

        const groupItems = results.filter((r) => r.content).map((r) => ({
          agentId: r.agent.id, agentName: r.agent.name, agentRole: r.agent.role, content: r.content,
        }));
        const combinedContent = groupItems.map((g) => `【${g.agentName}】${g.content}`).join("\n\n");
        const aiMsg = await api.addMessage(currentSession.sessionId, {
          role: "assistant", content: combinedContent, modelVersion: currentModel,
          agentId: activeAgent.id, agentVersionId: activeAgent.currentVersionId, stage: stageIndex,
        });
        addMessage({
          role: "assistant", content: combinedContent, messageId: aiMsg?.messageId, createdAt: aiMsg?.createdAt,
          agentId: activeAgent.id, agentName: activeAgent.name, agentRole: activeAgent.role,
          isMultiAgentGroup: true, groupItems,
        } as Message);
      } else {
        // 顺序提问
        const sysPrompt = getSystemPrompt(activeAgent);
        const reqMessages = [
          { role: "system", content: sysPrompt },
          ...history,
        ];
        let acc = "";
        const result = (await api.chat(currentModel, { messages: reqMessages }, (t) => {
          acc += t;
          appendStreamingContent(t);
        })) as any;
        const aiContent = result?.content || acc;
        const aiMsg = await api.addMessage(currentSession.sessionId, {
          role: "assistant", content: aiContent, modelVersion: currentModel,
          agentId: activeAgent.id, agentVersionId: activeAgent.currentVersionId, stage: stageIndex,
          isDegraded: result?.degraded || false,
        });
        addMessage({
          role: "assistant", content: aiContent, messageId: aiMsg?.messageId, createdAt: aiMsg?.createdAt,
          agentId: activeAgent.id, agentName: activeAgent.name, agentRole: activeAgent.role,
        } as Message);
      }

      // 阶段自动推进:每 3 轮对话(6 条消息)推进一个阶段
      const totalMessages = messages.length + 2;
      const newStage = Math.min(Math.floor(totalMessages / 6), stages.length - 1);
      if (newStage !== stageIndex && currentSession?.sessionId) {
        setStageIndex(newStage);
        // 多 Agent 模式:阶段切换时更新 activeAgent 为新阶段的 primary
        if (agentMode === "multi") {
          const newBindings = stageAgentMap[newStage] || [];
          const newPrimary = newBindings.find((b) => b.roleInStage === "primary") || newBindings[0];
          if (newPrimary) {
            setLastActiveAgentId(activeAgentId);
            setActiveAgentId(newPrimary.agentId);
          }
        }
        try {
          await api.request(`/sessions/${currentSession.sessionId}/stage`, {
            method: "PUT", body: JSON.stringify({ stage: newStage }),
          });
        } catch (e) { console.warn("Failed to update session stage:", e); }
      }
    } catch (e: any) {
      setError(t("interview.errors.aiReplyFailed", { msg: String(e.message) }));
    } finally {
      sendingRef.current = false;
      resetStreaming();
    }
  }, [input, isStreaming, currentSession, activeAgent, currentModel, agentMode, currentStageAskMode, currentStageBindings, getAgentById, buildTeamInfo, currentStageName, materials, focusDirection, difficulty, getSystemPrompt, stageIndex, stages, stageAgentMap, activeAgentId, messages, setMessages, addMessage, setStreaming, setStreamingContent, appendStreamingContent, resetStreaming, setError]);

  const handleRetry = useCallback(async () => {
    if (sendingRef.current) return;
    const retryContent = lastUserContentRef.current;
    if (!retryContent || !currentSession || !activeAgent) return;
    setError(null);

    sendingRef.current = true;
    setStreaming(true);
    setStreamingContent("");
    try {
      const sysPrompt = getSystemPrompt(activeAgent);
      const reqMessages = [
        { role: "system", content: sysPrompt },
        ...messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      ];
      let acc = "";
      const result = (await api.chat(currentModel, { messages: reqMessages }, (t) => {
        acc += t;
        appendStreamingContent(t);
      })) as any;
      const aiContent = result?.content || acc;
      const aiMsg = await api.addMessage(currentSession.sessionId, {
        role: "assistant", content: aiContent, modelVersion: currentModel,
        agentId: activeAgent.id, agentVersionId: activeAgent.currentVersionId, stage: stageIndex,
        isDegraded: result?.degraded || false,
      });
      addMessage({
        role: "assistant", content: aiContent, messageId: aiMsg?.messageId, createdAt: aiMsg?.createdAt,
        agentId: activeAgent.id, agentName: activeAgent.name, agentRole: activeAgent.role,
      } as Message);
    } catch (e: any) {
      setError(t("interview.errors.retryFailed", { msg: String(e.message) }));
    } finally {
      sendingRef.current = false;
      resetStreaming();
    }
  }, [currentSession, activeAgent, currentModel, stageIndex, getSystemPrompt, messages, addMessage, setStreaming, setStreamingContent, appendStreamingContent, resetStreaming, setError]);

  // 监听全局自定义事件
  useEffect(() => {
    const handleSend = () => sendMessage();
    const handleRetryEvent = () => handleRetry();
    const handleNewSession = () => {
      setSession(null);
      setMessages([]);
      clearMaterials();
      setSelectedMaterialIds([]);
      setExtraMaterialText("");
      setError(null);
      setInput("");
      setTitle("");
      setFlow("tech");
      setCustomStages(["自我介绍", "项目提问", "反问环节"]);
      setFocusDirection("");
      setAgentMode("single");
      setCurrentAgent(agents[0] || null);
      setStageIndex(0);
      setAgentTeam([]);
      setActiveAgentId(null);
      setLastActiveAgentId(null);
      setStageAgentMap({});
      setDifficulty("normal");
      setSelectedScenarioId(null);
      setShowScenarioPicker(false);
      setPendingScenario(null);
      lastUserContentRef.current = "";
    };
    window.addEventListener("tryout:send", handleSend);
    window.addEventListener("tryout:new-session", handleNewSession);
    window.addEventListener("tryout:retry", handleRetryEvent);
    return () => {
      window.removeEventListener("tryout:send", handleSend);
      window.removeEventListener("tryout:new-session", handleNewSession);
      window.removeEventListener("tryout:retry", handleRetryEvent);
    };
  }, [sendMessage, handleRetry, agents, setSession, setMessages, clearMaterials, setDifficulty, setError]);

  const handleAgentChange = (id: string) => {
    const a = agents.find((x) => x.id === id) || null;
    setCurrentAgent(a);
  };

  const handleModelChange = (id: string) => {
    // 单 Agent 模式:更新全局 active provider
    api.activateProvider(id).catch((e) => console.warn("Failed to activate provider:", id, e));
    if (currentSession?.sessionId) {
      api.updateSessionModel(currentSession.sessionId, id).catch((e) => console.warn("Failed to update session model:", e));
    }
  };

  // 面试中途添加资料
  const handleOpenMaterialPicker = async () => {
    setShowMaterialPicker(true);
    try {
      const list = await api.listMaterials();
      setAvailableMaterials(list || []);
    } catch (e: any) {
      setError(t("interview.errors.loadMaterialListFailed", { msg: String(e.message) }));
    }
  };

  const handleSelectMaterial = async (mat: any) => {
    try {
      const materialId = mat.materialId || mat.id;
      const resp = await api.getMaterialContent(materialId);
      const content = typeof resp === "string" ? resp : resp?.rawText || resp?.content || "";
      addMaterial({ id: materialId, type: mat.type || "text", title: mat.title, content });
      setSelectedMaterialIds((prev) => [...prev, materialId]);
      setShowMaterialPicker(false);
    } catch (e: any) {
      setError(t("interview.errors.loadMaterialContentFailed", { msg: String(e.message) }));
    }
  };

  // v5:切换发言 Agent(多 Agent 顺序模式,用户手动换人)
  const handleSwitchSpeaker = (id: string) => {
    setLastActiveAgentId(activeAgentId);
    setActiveAgentId(id);
  };

  // v7:应用面试场景剧本配置
  // 第一性原理:剧本 = 预设配置快照,点击即批量设置 title/flow/difficulty/agents/focusDirection
  // 剧本应用语义=开始新一场面试,故清空旧会话与消息,避免新旧配置割裂
  const applyScenario = useCallback((scenario: InterviewScenario) => {
    // 校验 custom 流程必须含阶段
    if (scenario.flow === "custom" && (!scenario.customStages || scenario.customStages.length === 0)) {
      setError(t("interview.errors.scenarioConfigError", { title: scenario.title }));
      return;
    }
    setSelectedScenarioId(scenario.id);
    setTitle(scenario.title);
    setFlow(scenario.flow);
    setDifficulty(scenario.difficulty);
    setFocusDirection(scenario.focusDirection);
    setAgentMode(scenario.agentMode);
    setStageIndex(0);
    setStageAgentMap({});
    if (scenario.flow === "custom" && scenario.customStages) {
      setCustomStages(scenario.customStages);
    }
    // 清空旧会话与消息(剧本=新会话语义,避免旧消息与新配置割裂)
    setSession(null);
    setMessages([]);
    clearMaterials();
    setSelectedMaterialIds([]);
    setExtraMaterialText("");
    setError(null);
    // Agent 配置:若 agents 已加载则立即应用,否则暂存等加载完成后应用
    if (agents.length > 0) {
      const matched = scenario.agentIds
        .map((id) => agents.find((a) => a.id === id))
        .filter(Boolean) as Agent[];
      if (matched.length === 0) {
        setError(t("interview.errors.scenarioAgentNotFound", { title: scenario.title }));
      } else if (matched.length < scenario.agentIds.length) {
        const missing = scenario.agentIds.filter((id) => !matched.some((m) => m.id === id));
        setError(t("interview.errors.scenarioAgentsMissing", { title: scenario.title, list: missing.join(", ") }));
      }
      if (scenario.agentMode === "multi") {
        setAgentTeam(matched.map((a) => a.id));
        setActiveAgentId(matched[0]?.id || null);
        const stagesForBinding = scenario.flow === "custom" && scenario.customStages
          ? scenario.customStages
          : (FLOW_TEMPLATES[scenario.flow]?.stages || []);
        setStageAgentMap(buildDefaultStageAgentMap(matched, stagesForBinding));
      } else {
        setCurrentAgent(matched[0] || null);
        setAgentTeam([]);
        setActiveAgentId(null);
      }
    } else {
      setPendingScenario(scenario);
    }
  }, [agents, setSession, setMessages, clearMaterials, setDifficulty, setError]);

  // v7:agents 加载完成后,应用暂存的剧本 agent 配置
  // 依赖 flow/customStages:用当前 state 而非 pendingScenario 快照,避免窗口内手动修改导致绑定错位
  useEffect(() => {
    if (!pendingScenario || agents.length === 0) return;
    const matched = pendingScenario.agentIds
      .map((id) => agents.find((a) => a.id === id))
      .filter(Boolean) as Agent[];
    if (matched.length === 0) {
      setError(t("interview.errors.scenarioAgentNotFound", { title: pendingScenario.title }));
      setPendingScenario(null);
      return;
    }
    // 用当前 state 的 flow/customStages 计算阶段(解决竞态:窗口内手动修改后绑定与实际一致)
    const stagesForBinding = flow === "custom" && customStages.length > 0
      ? customStages
      : (FLOW_TEMPLATES[flow]?.stages || []);
    if (pendingScenario.agentMode === "multi") {
      setAgentTeam(matched.map((a) => a.id));
      setActiveAgentId(matched[0]?.id || null);
      setStageAgentMap(buildDefaultStageAgentMap(matched, stagesForBinding));
    } else {
      setCurrentAgent(matched[0]);
    }
    setPendingScenario(null);
  }, [pendingScenario, agents, flow, customStages]);

  // v5:结束面试 - 生成整场回顾评价
  const handleEndInterview = useCallback(async () => {
    if (reviewGenerating) return;
    if (!currentSession) {
      setError(t("interview.errors.startInterviewBeforeEnd"));
      return;
    }
    if (messages.length === 0) {
      setError(t("interview.errors.noConversationForReview"));
      return;
    }
    setError(null);
    setReviewGenerating(true);
    setShowReviewModal(true);
    setCurrentReview(null);
    try {
      // 已存在评价则直接展示
      try {
        const existing = await api.getSessionReview(currentSession.sessionId);
        if (existing) {
          setCurrentReview(existing);
          setReviewGenerating(false);
          return;
        }
      } catch (e) { console.warn("No existing review found, will generate:", e); }

      // 构建 prompt
      const conversation = messages
        .map((m: any) => {
          const speaker = m.isMultiAgentGroup && m.groupItems
            ? m.groupItems.map((g: { agentName: string; content: string }) => `【${g.agentName}】${g.content}`).join("\n")
            : m.content;
          const roleLabel = m.role === "user" ? t("interview.candidateRole") : (m.agentName || t("interview.interviewerRole"));
          return `${roleLabel}: ${speaker}`;
        })
        .join("\n\n");

      const agentNames: string[] = agentMode === "multi"
        ? agentTeam.map((id) => getAgentById(id)?.name).filter((n): n is string => Boolean(n))
        : (currentAgent?.name ? [currentAgent.name] : []);

      const prompt = buildReviewPrompt({
        focusDirection,
        stages,
        agentNames,
        difficulty,
        conversation,
      });

      // 调用 LLM
      const result = (await api.chat(currentModel, { messages: [{ role: "user", content: prompt }] })) as any;
      const text = result?.content || "";
      const parsed = parseReviewResult(text);
      if (!parsed) {
        setError(t("interview.errors.reviewParseFailed"));
        setReviewGenerating(false);
        return;
      }

      // 持久化
      const saved = await api.createSessionReview(currentSession.sessionId, parsed);
      setCurrentReview({ ...parsed, ...saved });
    } catch (e: any) {
      setError(t("interview.errors.generateReviewFailed", { msg: String(e.message) }));
    } finally {
      setReviewGenerating(false);
    }
  }, [reviewGenerating, currentSession, messages, agentMode, agentTeam, currentAgent, getAgentById, focusDirection, stages, difficulty, currentModel, setError]);

  // 渲染分隔线:当 activeAgentId 变化且与 lastActiveAgentId 不同
  const showSwitchDivider = agentMode === "multi" && lastActiveAgentId && activeAgentId && lastActiveAgentId !== activeAgentId;
  const dividerAgent = showSwitchDivider ? getAgentById(activeAgentId) : null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left Sidebar - extracted to SessionConfigPanel */}
      <SessionConfigPanel
        title={title}
        setTitle={setTitle}
        showAdvanced={showAdvanced}
        setShowAdvanced={setShowAdvanced}
        showScenarioPicker={showScenarioPicker}
        setShowScenarioPicker={setShowScenarioPicker}
        selectedScenarioId={selectedScenarioId}
        applyScenario={applyScenario}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        flow={flow}
        setFlow={setFlow}
        isCustomFlow={isCustomFlow}
        customStages={customStages}
        handleStageChange={handleStageChange}
        handleAddStage={handleAddStage}
        handleRemoveStage={handleRemoveStage}
        stages={stages}
        stageIndex={stageIndex}
        setStageIndex={setStageIndex}
        setStageAgentMap={setStageAgentMap}
        stageNameI18n={stageNameI18n}
        focusDirection={focusDirection}
        setFocusDirection={setFocusDirection}
        availableMaterials={availableMaterials}
        selectedMaterialIds={selectedMaterialIds}
        handleToggleMaterial={handleToggleMaterial}
        extraMaterialText={extraMaterialText}
        setExtraMaterialText={setExtraMaterialText}
        agentMode={agentMode}
        setAgentMode={setAgentMode}
        currentAgent={currentAgent}
        handleAgentChange={handleAgentChange}
        agents={agents}
        agentTeam={agentTeam}
        handleToggleAgentTeam={handleToggleAgentTeam}
        stageAgentMap={stageAgentMap}
        handleStageAgentChange={handleStageAgentChange}
        handleAddStageAgent={handleAddStageAgent}
        handleRemoveStageAgent={handleRemoveStageAgent}
        handleStageAskModeChange={handleStageAskModeChange}
        getAgentById={getAgentById}
        currentProvider={currentProvider}
        currentModel={currentModel}
        createSession={createSession}
        startInterview={startInterview}
        isStreaming={isStreaming}
      />

      {/* 右栏 ChatPanel */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-ide-border bg-ide-bg-alt px-3 text-xs">
          <div className="truncate text-ide-fg">{currentSession?.title || title || t("interview.unnamedSession")}</div>
          <div className="flex items-center gap-2">
            <span className="text-ide-fg-muted">{stageNameI18n(currentStageName)}</span>
            {/* v5:当前发言 Agent 指示器 */}
            {agentMode === "multi" && activeAgent && (
              <span className="flex items-center gap-1 bg-ide-accent/10 px-1.5 py-0.5 text-[10px] text-ide-accent">
                <AgentAvatar agent={activeAgent} size={12} />
                {activeAgent.name}
              </span>
            )}
            {focusDirection && (
              <span className="bg-ide-bg-active px-1.5 py-0.5 text-[10px] text-ide-accent">
                {focusDirection.length > 12 ? focusDirection.slice(0, 12) + "..." : focusDirection}
              </span>
            )}
            <button onClick={handleOpenMaterialPicker} title={t("interview.addMaterialTip")}
              className="flex items-center gap-1 px-1.5 py-0.5 text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg">
              <Paperclip size={12} /> {t("interview.addMaterial")}
            </button>
            {/* v6:视图模式切换(仅会话开始后可用) */}
            {currentSession && messages.length > 0 && (
              <div className="flex items-center border border-ide-border">
                <button onClick={() => setViewMode("list")}
                  className={cn("px-1.5 py-0.5 text-[10px]", viewMode === "list" ? "bg-ide-accent text-ide-accent-fg" : "text-ide-fg-muted hover:text-ide-fg")}>
                  {t("interview.viewList")}
                </button>
                <button onClick={() => setViewMode("room")}
                  className={cn("px-1.5 py-0.5 text-[10px]", viewMode === "room" ? "bg-ide-accent text-ide-accent-fg" : "text-ide-fg-muted hover:text-ide-fg")}>
                  {t("interview.viewRoom")}
                </button>
              </div>
            )}
            {/* v5:结束面试 - 生成整场回顾 */}
            {currentSession && messages.length > 0 && (
              <button onClick={handleEndInterview} disabled={reviewGenerating || isStreaming}
                title={t("interview.endTip")}
                className="flex items-center gap-1 bg-ide-danger/20 px-1.5 py-0.5 text-[10px] text-ide-danger hover:bg-ide-danger/30 disabled:opacity-50">
                {reviewGenerating ? <Loader2 size={11} className="animate-spin" /> : <StopCircle size={11} />}
                {reviewGenerating ? t("interview.generating") : t("interview.end")}
              </button>
            )}
            {/* 已有评价时,允许查看 */}
            {currentSession && !reviewGenerating && (
              <button onClick={async () => {
                if (!currentSession) return;
                try {
                  const r = await api.getSessionReview(currentSession.sessionId);
                  if (r) { setCurrentReview(r); setShowReviewModal(true); }
                  else { setError(t("interview.reviewNotGenerated")); }
                } catch (e: any) { setError(t("interview.loadReviewFailed", { msg: e.message })); }
              }} title={t("interview.viewReview")}
                className="flex items-center gap-1 px-1.5 py-0.5 text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg">
                <Sparkles size={11} /> {t("interview.review")}
              </button>
            )}
          </div>
        </div>

        {/* 注入的资料列表 */}
        {materials.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-ide-border bg-ide-bg-alt px-3 py-1.5">
            <span className="text-[11px] text-ide-fg-muted"><BookOpen size={11} className="mr-1 inline" />{t("interview.injectedMaterials")}</span>
            {materials.map((m: any) => (
              <span key={m.id} className="flex items-center gap-1 bg-ide-bg-active px-1.5 py-0.5 text-[11px] text-ide-fg">
                {m.title || m.id}
                <button onClick={() => { removeMaterial(m.id); setSelectedMaterialIds((prev) => prev.filter((id) => id !== m.id)); }}
                  className="text-ide-fg-muted hover:text-ide-danger"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}

        {/* 面试中途添加资料浮层 */}
        {showMaterialPicker && (
          <div className="border-b border-ide-border bg-ide-bg-alt p-2">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-ide-fg-muted">{t("interview.selectMaterial")}</span>
              <button onClick={() => setShowMaterialPicker(false)} className="text-ide-fg-muted hover:text-ide-fg"><X size={14} /></button>
            </div>
            {availableMaterials.length === 0 ? (
              <div className="py-2 text-xs text-ide-fg-muted">{t("interview.noMaterials")}</div>
            ) : (
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                {availableMaterials.map((m) => (
                  <button key={m.materialId || m.id} onClick={() => handleSelectMaterial(m)}
                    className="flex items-center gap-2 px-2 py-1 text-left text-xs text-ide-fg hover:bg-ide-bg-active">
                    <Paperclip size={12} className="text-ide-fg-muted" />
                    <span className="flex-1 truncate">{m.title}</span>
                    <span className="text-[10px] text-ide-fg-muted">{m.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 错误条 + 重试 */}
        {error && (
          <div role="alert" className="flex items-center gap-2 border-b border-ide-danger/30 bg-ide-danger/10 px-3 py-2 text-xs text-ide-danger">
            <AlertCircle size={14} />
            <span className="flex-1">{error}</span>
            <button onClick={handleRetry} disabled={isStreaming}
              className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-ide-danger/20 disabled:opacity-50">
              <RotateCcw size={12} /> {t("common.retry")}
            </button>
            <button onClick={() => setError(null)} className="hover:underline">{t("common.close")}</button>
          </div>
        )}

        {/* v6:会议室视图模式 */}
        {viewMode === "room" && currentSession && messages.length > 0 ? (
          <MeetingRoomView
            interviewers={agentMode === "multi"
              ? agentTeam.map((id) => getAgentById(id)).filter(Boolean) as Agent[]
              : (currentAgent ? [currentAgent] : [])}
            candidates={[]}
            messages={messages.map((m: any, i: number): MeetingMessage => {
              const agent = m.agentId ? agents.find((a) => a.id === m.agentId) : undefined;
              const isMulti = m.isMultiAgentGroup && m.groupItems;
              return {
                id: m.messageId || m.id || `msg_${i}`,
                speakerId: m.role === "user" ? "user" : (m.agentId || "ai"),
                speakerKind: m.role === "user" ? "user" : "interviewer",
                speakerName: m.role === "user" ? t("common.you") : (m.agentName || agent?.name || "AI"),
                content: isMulti
                  ? (m.groupItems || []).map((g: any) => `【${g.agentName}】${g.content}`).join("\n\n")
                  : m.content,
                createdAt: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
                agentRef: agent,
              };
            })}
            activeSpeakerId={isStreaming ? (activeAgentId || currentAgent?.id || null) : null}
            onUserSend={(content) => sendMessage(content)}
            disabled={isStreaming}
            onSwitchToList={() => setViewMode("list")}
            title={currentSession.title}
            stageLabel={stageNameI18n(currentStageName)}
          />
        ) : (
          <>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
              {messages.length === 0 && !isStreaming && (
                <EmptyStateHome
                  onPickScenario={applyScenario}
                  recentSessions={recentSessions}
                  evaluations={allEvaluations}
                />
              )}
              <div className="flex flex-col gap-3">
                {messages.map((m: any, i: number) => (
                  <MessageBubble key={m.messageId || m.id || i} message={m} agents={agents} />
                ))}
                {/* Agent 切换分隔线 */}
                {showSwitchDivider && dividerAgent && (
                  <AgentSwitchDivider agent={dividerAgent} />
                )}
                {isStreaming && (
                  <div className="flex w-full justify-start">
                    <div className="bubble bubble-assistant">
                      {streamingContent ? (
                        <span>{streamingContent}<span className="prompt-cursor text-ide-accent">█</span></span>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-ide-fg-muted">
                          <Loader2 size={12} className="animate-spin" /> thinking...
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* v5:多 Agent 顺序模式 - 切换发言按钮 */}
            {agentMode === "multi" && agentTeam.length > 1 && currentStageAskMode === "sequential" && currentSession && !isStreaming && (
              <div className="flex flex-wrap items-center gap-1 border-t border-ide-border bg-ide-bg-alt px-3 py-1">
                <span className="text-[10px] text-ide-fg-muted">{t("interview.switchSpeaker")}</span>
                {agentTeam.map((id) => {
                  const a = getAgentById(id);
                  if (!a) return null;
                  return (
                    <button key={id} onClick={() => handleSwitchSpeaker(id)}
                      className={cn("flex items-center gap-1 px-1.5 py-0.5 text-[10px]",
                        activeAgentId === id ? "bg-ide-accent text-ide-accent-fg" : "bg-ide-bg-active text-ide-fg-muted hover:text-ide-fg")}>
                      <AgentAvatar agent={a} size={12} /> {a.name}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* C8:思考计时器 - 已抽出到 TimerWidget 子组件,内部管理启停与 tick */}
        <TimerWidget messages={messages} />

        {/* v11:逐题反馈面板(语音答题闭环的反馈层,展示/评分/错题) */}
        {currentSession && messages.length > 0 && (
          <AnswerFeedbackPanel
            sessionId={currentSession.sessionId}
            provider={currentModel}
            lastExchange={lastExchangeForScore}
          />
        )}

        {/* 方案 10:语音控制面板(可折叠,默认折叠) */}
        {!(viewMode === "room" && currentSession && messages.length > 0) && (
          <VoicePanel
            agentId={activeAgent?.id || currentAgent?.id || null}
            voiceConfig={(activeAgent?.id && voiceConfigs[activeAgent.id]) || (currentAgent?.id && voiceConfigs[currentAgent.id]) || {}}
            onVoiceConfigChange={(cfg) => {
              const id = activeAgent?.id || currentAgent?.id;
              if (id) setVoiceConfigs((prev) => ({ ...prev, [id]: cfg }));
            }}
            autoSpeak={autoSpeak}
            onAutoSpeakChange={setAutoSpeak}
            lastAssistantText={lastAssistantText}
            onRecognize={(text) => setInput(text)}
            onFinalRecognize={(text) => {
              // P0-3 修复:自动提交最终识别结果,sendMessage 接受 contentOverride 避免闭包陷阱
              sendMessage(text);
            }}
          />
        )}

        {/* C7:输入区 - 已抽出到 MessageInput 子组件 (room 视图时隐藏,MeetingRoomView 自带输入) */}
        {!(viewMode === "room" && currentSession && messages.length > 0) && (
          <MessageInput
            input={input}
            setInput={setInput}
            isStreaming={isStreaming}
            sendMessage={sendMessage}
          />
        )}
      </section>

      {/* v5:整场回顾评价弹窗 */}
      {showReviewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowReviewModal(false)}
        >
          <div
            ref={reviewModalRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("interview.reviewTitle")}
            tabIndex={-1}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden border border-ide-border bg-ide-bg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-ide-border bg-ide-bg-alt px-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-ide-fg">
                <Sparkles size={13} className="text-ide-accent" />
                {t("interview.reviewTitle")}
                {currentSession && <span className="text-ide-fg-muted">· {currentSession.title}</span>}
              </div>
              <button onClick={() => setShowReviewModal(false)} className="text-ide-fg-muted hover:text-ide-fg">
                <X size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SessionReviewCard review={currentReview} loading={reviewGenerating} compact />
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ide-border bg-ide-bg-alt px-3 py-2">
              {currentReview && (
                <button
                  onClick={async () => {
                    if (!currentSession) return;
                    if (!confirm(t("interview.confirmRegenerate"))) return;
                    // 删除旧的(后端 upsert,直接 POST 覆盖即可)
                    setReviewGenerating(true);
                    setCurrentReview(null);
                    try {
                      const conversation = messages.map((m: any) => {
                        const speaker = m.isMultiAgentGroup && m.groupItems
                          ? m.groupItems.map((g: { agentName: string; content: string }) => `【${g.agentName}】${g.content}`).join("\n")
                          : m.content;
                        const roleLabel = m.role === "user" ? t("interview.candidateRole") : (m.agentName || t("interview.interviewerRole"));
                        return `${roleLabel}: ${speaker}`;
                      }).join("\n\n");
                      const agentNames: string[] = agentMode === "multi"
                        ? agentTeam.map((id) => getAgentById(id)?.name).filter((n): n is string => Boolean(n))
                        : (currentAgent?.name ? [currentAgent.name] : []);
                      const prompt = buildReviewPrompt({ focusDirection, stages, agentNames, difficulty, conversation });
                      const result = (await api.chat(currentModel, { messages: [{ role: "user", content: prompt }] })) as any;
                      const parsed = parseReviewResult(result?.content || "");
                      if (parsed) {
                        const saved = await api.createSessionReview(currentSession.sessionId, parsed);
                        setCurrentReview({ ...parsed, ...saved });
                      } else {
                        setError(t("interview.errors.reviewParseFailedNoRetry"));
                      }
                    } catch (e: any) {
                      setError(t("interview.errors.regenerateFailed", { msg: String(e.message) }));
                    } finally {
                      setReviewGenerating(false);
                    }
                  }}
                  disabled={reviewGenerating}
                  className="flex h-7 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg hover:bg-ide-bg-active disabled:opacity-50"
                >
                  <RotateCcw size={11} /> {t("interview.regenerate")}
                </button>
              )}
              <button
                onClick={() => setShowReviewModal(false)}
                className="flex h-7 items-center gap-1 bg-ide-accent px-3 text-xs text-ide-accent-fg hover:bg-ide-accent-hover"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
