import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { cn, formatTime } from "@/shared";
import { generateEvaluationPrompt, parseEvaluationResult, PEER_BENCHMARK } from "@/lib/evaluation/starEvaluator";
import { scoreExpression } from "@/lib/evaluation/expressionScorer";
import { analyzeWeakness, type WeaknessResult } from "@/lib/analysis/weaknessAnalyzer";
import { computeGroupSummaryLocal, type GroupSummary } from "@/lib/groupSummary";
import { exportSessionAsMarkdown, exportSessionAsJSON, exportSessionAsPDF } from "@/lib/exporter";
import { ProgressCurve } from "@/components/charts/ProgressCurve";
import { EvaluationRadar } from "@/components/charts/EvaluationRadar";
import { SessionReviewCard } from "@/components/SessionReviewCard";
import { WeaknessRecommendCard } from "@/components/WeaknessRecommendCard";
import { GroupSummaryCard } from "@/components/GroupSummaryCard";
import { InfoTip } from "@/components/InfoTip";
import { Heatmap } from "@/components/Heatmap";
import { SessionGroupSidebar } from "@/components/SessionGroupSidebar";
import { ReviewDiscussion } from "@/components/ReviewDiscussion";
import { useGroupStore } from "@/stores/groupStore";
import { useI18n } from "@/i18n";
import { buildHeatmapData } from "@/lib/heatmapData";
import { normalizeAgent, type Agent } from "@/types/agent";
import type { SessionInfo, SessionReview } from "@/types/session";
import { Sparkles, Loader2, AlertCircle, Star, TrendingUp, AlertTriangle, FolderOpen, Flame, MessagesSquare, Download, FileJson, FileText } from "lucide-react";

interface Message {
  id?: string;
  messageId?: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt?: string;
}

interface Evaluation {
  evaluationId: string;
  sessionId?: string;
  messageId?: string;
  overallScore?: number;
  report?: string;
  improvementAdvice?: string;
  betterAnswerSample?: string;
  dimensions?: { dimensionName: string; score: number; comment: string }[];
  generatedAt?: string;
  createdAt?: string;
  // API 可能返回 snake_case 字段(兼容后端直返)
  created_at?: string;
  id?: string;
}

// 工程 P0:手写信号量(p-limit 风格),用于 LLM 调用并发限流,避免 N+1 串行
function createLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency) return;
    const fn = queue.shift();
    if (fn) {
      active++;
      fn();
    }
  };
  return <T,>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        task().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      };
      queue.push(run);
      next();
    });
}

export function HistoryPage() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [review, setReview] = useState<SessionReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // 工程 P0:STAR 评估并发进度反馈
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // 方案 5:复盘群聊覆盖层
  const [showReviewDiscussion, setShowReviewDiscussion] = useState(false);
  const [reviewAgents, setReviewAgents] = useState<Agent[]>([]);

  // 全局分析数据
  const [progressData, setProgressData] = useState<{ score: number; date: string; sessionId: string }[]>([]);
  const [weakness, setWeakness] = useState<WeaknessResult | null>(null);
  const [weaknessLoading, setWeaknessLoading] = useState(false);

  // 分组归纳数据
  const [allReviews, setAllReviews] = useState<any[]>([]);
  const [allEvals, setAllEvals] = useState<Evaluation[]>([]);
  const [groupSummary, setGroupSummary] = useState<GroupSummary | null>(null);

  // 成长热力图数据(基于全局评估聚合最近 26 周活跃度)
  const heatmapData = useMemo(() => buildHeatmapData(allEvals as any[]), [allEvals]);

  // C4:跨场能力雷达 - 聚合所有评估的 dimensions,展示综合能力分布
  const crossFieldRadar = useMemo(() => {
    const byDim = new Map<string, { sum: number; weight: number }>();
    let evalCount = 0;
    for (const e of allEvals) {
      if (!e.dimensions || e.dimensions.length === 0) continue;
      evalCount++;
      for (const d of e.dimensions) {
        const cur = byDim.get(d.dimensionName) || { sum: 0, weight: 0 };
        cur.sum += d.score;
        cur.weight += 1;
        byDim.set(d.dimensionName, cur);
      }
    }
    return {
      dimensions: Array.from(byDim.entries()).map(([name, v]) => ({
        dimensionName: name,
        score: v.weight > 0 ? Number((v.sum / v.weight).toFixed(2)) : 0,
      })),
      evalCount,
    };
  }, [allEvals]);

  // C4 P2.3:维度演进历史 - 每个维度的历史得分序列(按时间排序)
  // 用于 ProgressCurve 真正的演进曲线(每维度一条 Line)
  const dimensionHistory = useMemo(() => {
    // 按 createdAt 升序排序(最早的在最前面)
    const sorted = [...allEvals].sort((a, b) =>
      new Date(a.createdAt || a.created_at || 0).getTime() - new Date(b.createdAt || b.created_at || 0).getTime()
    );
    // 收集所有维度名
    const dimNames = new Set<string>();
    for (const e of sorted) {
      if (e.dimensions) {
        for (const d of e.dimensions) dimNames.add(d.dimensionName);
      }
    }
    // 每个维度提取历史得分序列
    return Array.from(dimNames).map(dimName => ({
      dimensionName: dimName,
      points: sorted
        .filter(e => e.dimensions && e.dimensions.some(d => d.dimensionName === dimName))
        .map(e => {
          const d = e.dimensions?.find((x) => x.dimensionName === dimName);
          if (!d) return null;
          return {
            score: d.score,
            date: e.createdAt || e.created_at || "",
            evaluationId: e.evaluationId || e.id || "",
          };
        })
        .filter((p): p is { score: number; date: string; evaluationId: string } => p !== null),
    }));
  }, [allEvals]);

  // 分组 store
  const groups = useGroupStore((s) => s.groups);
  const loadGroups = useGroupStore((s) => s.loadGroups);
  const createGroup = useGroupStore((s) => s.createGroup);
  const updateGroup = useGroupStore((s) => s.updateGroup);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);

  const loadSessions = useCallback(async () => {
    try {
      const list = (await api.listSessions()) || [];
      setSessions(list as SessionInfo[]);
      if (list.length > 0 && !selectedId) setSelectedId(list[0].sessionId);
    } catch (e: any) {
      setError(t("history.loadSessionsFailed", { msg: e.message }));
    }
  }, [selectedId, t]);

  // 加载全局评估数据(进步曲线 + 弱项分析 + 所有评价/评估供分组归纳用)
  const loadGlobalAnalysis = useCallback(async () => {
    try {
      const [allE, allR] = await Promise.all([
        api.listAllEvaluations(),
        api.listAllReviews().catch(() => []),
      ]);
      const evals = (allE as any[]) || [];
      const reviews = (allR as any[]) || [];
      setAllEvals(evals);
      setAllReviews(reviews);

      const points = evals
        .filter((e) => e.overallScore != null && (e.generatedAt || e.createdAt))
        .map((e) => ({
          score: e.overallScore,
          date: e.generatedAt || e.createdAt,
          sessionId: e.sessionId || "",
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setProgressData(points);
    } catch {
      // 静默失败
    }

    setWeaknessLoading(true);
    try {
      const result = await analyzeWeakness(10);
      setWeakness(result);
    } catch {
      // 静默失败
    } finally {
      setWeaknessLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadGlobalAnalysis();
    loadGroups();
  }, [loadSessions, loadGlobalAnalysis, loadGroups]);

  // 选中会话后加载详情(消息 + 评估 + 整场评价)
  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const [msgs, evals, rv] = await Promise.all([
        api.listMessages(selectedId),
        api.listEvaluations(selectedId),
        api.getSessionReview(selectedId).catch(() => null),
      ]);
      setMessages((msgs as any[]) || []);
      setEvaluations((evals as any[]) || []);
      setReview((rv as SessionReview | null) || null);
    } catch (e: any) {
      setError(t("history.loadDetailFailed", { msg: e.message }));
    } finally {
      setLoading(false);
    }
  }, [selectedId, t]);

  useEffect(() => {
    if (selectedId) loadDetail();
  }, [loadDetail]);

  // 选中分组时计算归纳
  useEffect(() => {
    if (!selectedGroupId) {
      setGroupSummary(null);
      return;
    }
    const groupSessions = sessions.filter((s) => s.groupId === selectedGroupId);
    const groupSessionIds = new Set(groupSessions.map((s) => s.sessionId));
    const groupReviews = allReviews.filter((r: any) => groupSessionIds.has(r.sessionId));
    const groupEvals = allEvals.filter((e) => e.sessionId && groupSessionIds.has(e.sessionId));
    const summary = computeGroupSummaryLocal(groupSessions as any[], groupReviews, groupEvals as any[]);
    setGroupSummary(summary);
  }, [selectedGroupId, sessions, allReviews, allEvals]);

  const selected = sessions.find((s) => s.sessionId === selectedId);
  const selectedGroup = groups.find((g) => g.groupId === selectedGroupId);

  // 生成 STAR 评估
  const handleGenerateStar = async () => {
    if (!selected) return;
    setError(null);
    setGenerating(true);
    setProgress({ done: 0, total: 0 });
    try {
      const providers = (await api.listProviders()) || [];
      const providerId = selected.modelId || providers[0]?.id;
      if (!providerId) {
        setError(t("history.noModelAvailable"));
        setGenerating(false);
        setProgress(null);
        return;
      }

      const pairs: { question: string; answer: string; messageId?: string }[] = [];
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === "assistant") {
          const next = messages[i + 1];
          if (next && next.role === "user") {
            pairs.push({ question: m.content, answer: next.content, messageId: next.messageId || next.id });
          }
        }
      }

      if (pairs.length === 0) {
        setError(t("history.noQaPairs"));
        setGenerating(false);
        setProgress(null);
        return;
      }

      setProgress({ done: 0, total: pairs.length });
      // 工程 P0:串行 N+1 LLM 改并发(信号量限流 3 并发),每个 pair 完成后立即写 DB
      const limit = createLimit(3);
      let successCount = 0;
      let doneCount = 0;

      const evaluatePair = async (pair: { question: string; answer: string; messageId?: string }) => {
        try {
          // P1-3:使用 6 维度 + STAR + 薄弱点 prompt(替代旧版 4 维度 STAR_PROMPT)
          const prompt = generateEvaluationPrompt(pair.question, pair.answer);
          let acc = "";
          const result = (await api.chat(providerId, { messages: [{ role: "user", content: prompt }] }, (t) => {
            acc += t;
          })) as any;
          const text = result?.content || acc;
          const parsed = parseEvaluationResult(text);
          if (!parsed) return;
          // P1-1:接入表达能力评分(纯文本分析,零 LLM 调用)
          const expr = scoreExpression(pair.answer);
          const speedLabel = expr.speedLevel === "slow" ? t("history.speedSlow") : expr.speedLevel === "fast" ? t("history.speedFast") : t("history.speedNormal");
          const exprLine = t("history.expressionLine", {
            score: expr.expressionScore,
            speed: expr.speakingSpeed,
            speedLabel,
            fillerCount: expr.fillerCount,
            fillerFreq: expr.fillerFrequency,
            avgLen: expr.avgSentenceLength,
            connectorCount: expr.connectorCount,
          });
          const fullReport = parsed.report + exprLine;
          // 每个 pair 完成后立即写入 DB,不等全部完成
          await api.createEvaluation({
            sessionId: selected.sessionId,
            messageId: pair.messageId,
            overallScore: parsed.overallScore,
            report: fullReport,
            improvementAdvice: parsed.improvementAdvice,
            betterAnswerSample: parsed.betterAnswerSample,
            dimensions: parsed.dimensions,
          });
          successCount++;
        } catch (e) {
          // 单个 pair 失败不阻塞其他 pair;记录日志便于排查
          console.warn("[HistoryPage] evaluatePair 失败", e);
        } finally {
          doneCount++;
          setProgress({ done: doneCount, total: pairs.length });
        }
      };

      await Promise.all(pairs.map((p) => limit(() => evaluatePair(p))));
      await loadDetail();
      await loadGlobalAnalysis();
      if (successCount === 0) {
        setError(t("history.parseStarFailed"));
      }
    } catch (e: any) {
      setError(t("history.generateEvalFailed", { msg: e.message }));
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  // 分组操作回调
  const handleCreateGroup = async (name: string) => {
    try {
      await createGroup({ name, color: "#4f46e5" });
    } catch (e: any) {
      setError(t("history.createGroupFailed", { msg: e.message }));
    }
  };
  const handleRenameGroup = async (id: string, name: string) => {
    try {
      const g = groups.find((x) => x.groupId === id);
      await updateGroup(id, { name, color: g?.color, description: g?.description });
    } catch (e: any) {
      setError(t("history.renameGroupFailed", { msg: e.message }));
    }
  };
  const handleDeleteGroup = async (id: string) => {
    try {
      await deleteGroup(id);
      // 该组内的会话变为未分组,本地同步 groupId
      setSessions((prev) => prev.map((s) => (s.groupId === id ? { ...s, groupId: null } : s)));
    } catch (e: any) {
      setError(t("history.deleteGroupFailed", { msg: e.message }));
    }
  };
  const handleAssignSession = async (sessionId: string, groupId: string | null) => {
    try {
      await api.setSessionGroup(sessionId, groupId);
      setSessions((prev) => prev.map((s) => (s.sessionId === sessionId ? { ...s, groupId } : s)));
    } catch (e: any) {
      setError(t("history.moveSessionFailed", { msg: e.message }));
    }
  };

  // 选中会话/分组互斥
  const handleSelectSession = (id: string) => {
    setSelectedId(id);
    setSelectedGroupId(null);
  };
  const handleSelectGroup = (gid: string | null) => {
    setSelectedGroupId(gid);
    if (gid) setSelectedId(""); // 选中分组时清空会话选中
  };

  // 导出报告(MD / JSON / PDF)
  const handleExport = (format: "md" | "json" | "pdf") => {
    if (!selected || messages.length === 0) return;
    const session = {
      title: selected.title || t("history.defaultSessionTitle"),
      difficulty: selected.difficulty,
      flowTemplate: selected.flowTemplate,
      createdAt: selected.createdAt,
    };
    if (format === "md") {
      exportSessionAsMarkdown(session, messages, evaluations as any);
    } else if (format === "json") {
      exportSessionAsJSON(session, messages, evaluations as any);
    } else {
      exportSessionAsPDF(session, messages, evaluations as any);
    }
  };

  // 方案 5:打开复盘群聊
  // 取前 3 个面试官模板参与讨论;若无模板则使用全部
  const handleOpenReviewDiscussion = async () => {
    if (!selected || messages.length === 0) return;
    try {
      const list = (await api.listAgents("interviewer")) || [];
      const normalized = list.map(normalizeAgent);
      // 优先模板(isTemplate),取前 3;不足则补全
      const templates = normalized.filter((a) => a.isTemplate);
      const picked = templates.length > 0 ? templates.slice(0, 3) : normalized.slice(0, 3);
      // 前置检查:无可用面试官模板时直接报错并返回,避免打开空白群聊
      if (picked.length === 0) {
        setError(t("history.noInterviewerAgents"));
        return;
      }
      setReviewAgents(picked);
      setShowReviewDiscussion(true);
    } catch (e: any) {
      setError(t("history.loadAgentsFailed", { msg: e.message }));
    }
  };

  // 分组归纳模式
  if (selectedGroupId && selectedGroup) {
    return (
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-ide-border bg-ide-bg-alt">
          <SessionGroupSidebar
            groups={groups}
            sessions={sessions}
            selectedSessionId={selectedId}
            selectedGroupId={selectedGroupId}
            onSelectSession={handleSelectSession}
            onSelectGroup={handleSelectGroup}
            onCreateGroup={handleCreateGroup}
            onRenameGroup={handleRenameGroup}
            onDeleteGroup={handleDeleteGroup}
            onAssignSession={handleAssignSession}
          />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ide-border bg-ide-bg-alt px-3 text-xs">
            <FolderOpen size={13} className="text-ide-accent" />
            <span className="truncate text-ide-fg">{selectedGroup.name}</span>
            <span className="text-ide-fg-muted">{t("history.groupSummary")}</span>
          </div>
          {error && (
            <div role="alert" className="flex items-center gap-2 border-b border-ide-danger/30 bg-ide-danger/10 px-3 py-2 text-xs text-ide-danger">
              <AlertCircle size={14} />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="hover:underline">{t("common.close")}</button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groupSummary ? (
              <GroupSummaryCard
                groupId={selectedGroup.groupId}
                groupName={selectedGroup.name}
                summary={groupSummary}
                cachedLlmAdvice={selectedGroup.summary}
                cachedSummaryGeneratedAt={selectedGroup.summaryGeneratedAt}
              />
            ) : (
              <div className="p-3 text-xs text-ide-fg-muted">{t("history.calculating")}</div>
            )}
          </div>
        </section>
      </div>
    );
  }

  // 会话详情模式
  return (
    <>
    <div className="flex min-h-0 flex-1">
      {/* 左栏 分组侧边栏 */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-ide-border bg-ide-bg-alt">
        <SessionGroupSidebar
          groups={groups}
          sessions={sessions}
          selectedSessionId={selectedId}
          selectedGroupId={selectedGroupId}
          onSelectSession={handleSelectSession}
          onSelectGroup={handleSelectGroup}
          onCreateGroup={handleCreateGroup}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={handleDeleteGroup}
          onAssignSession={handleAssignSession}
        />
      </aside>

      {/* 右栏 */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-ide-border bg-ide-bg-alt px-3 text-xs">
          <div className="truncate text-ide-fg">
            {selected?.title || t("history.noSessionSelected")}
          </div>
          <button
            onClick={handleGenerateStar}
            disabled={generating || !selected || messages.length === 0}
            className="flex h-6 items-center gap-1 bg-ide-accent px-2 text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {t("history.generateSTAR")}
            {generating && progress && progress.total > 0 && (
              <span className="ml-1 font-mono text-[10px] opacity-90">{progress.done}/{progress.total}</span>
            )}
          </button>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 border-b border-ide-danger/30 bg-ide-danger/10 px-3 py-2 text-xs text-ide-danger">
            <AlertCircle size={14} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="hover:underline">{t("common.close")}</button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* 整场回顾评价(顶部) */}
          {selected && (
            <div className="border-b border-ide-border p-3">
              <SessionReviewCard review={review} loading={reviewLoading} compact />
            </div>
          )}

          {/* C5:弱点闭环推荐 - 在 SessionReviewCard 下方,基于薄弱维度推荐下次练习场景 */}
          {selected && weakness && (
            <div className="border-b border-ide-border p-3">
              <WeaknessRecommendCard weakness={weakness} />
            </div>
          )}

          {/* 成长热力图 */}
          <div className="border-b border-ide-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
              <Flame size={12} />
              {t("history.growthHeatmap")}
              <InfoTip text={t("history.heatmapTip1")} />
              <InfoTip text={t("history.heatmapTip2")} />
            </div>
            <Heatmap data={heatmapData} />
          </div>

          {/* C4:跨场能力雷达 - 聚合所有评估的维度得分 */}
          <div className="border-b border-ide-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
              <Star size={12} />
              {t("history.crossFieldRadar")}
              <InfoTip text={t("history.crossFieldRadarTip")} />
              {crossFieldRadar.evalCount > 0 && (
                <span className="ml-auto text-[10px] font-normal text-ide-fg-muted">
                  {t("history.crossFieldRadarCount", { count: crossFieldRadar.evalCount })}
                </span>
              )}
            </div>
            {crossFieldRadar.dimensions.length < 3 ? (
              <div className="py-3 text-center text-xs text-ide-fg-muted">
                {t("history.crossFieldRadarEmpty")}
              </div>
            ) : (
              <EvaluationRadar
                dimensions={crossFieldRadar.dimensions}
                maxScore={5}
                benchmark={PEER_BENCHMARK}
              />
            )}
          </div>

          {/* 进步曲线 + C4 维度演进 */}
          <div className="border-b border-ide-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
              <TrendingUp size={12} />
              {t("history.progressCurve")}
              <InfoTip text={t("history.progressCurveTip")} />
            </div>
            <ProgressCurve data={progressData} dimensionHistory={dimensionHistory} />
          </div>

          {/* 弱项分析卡片 */}
          <div className="border-b border-ide-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
              <AlertTriangle size={12} />
              {t("history.weaknessAnalysis")}
              <InfoTip text={t("history.weaknessTip")} />
            </div>
            {weaknessLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-ide-fg-muted">
                <Loader2 size={12} className="animate-spin" />
                {t("history.analyzing")}
              </div>
            ) : !weakness || !weakness.hasData ? (
              <div className="py-2 text-xs text-ide-fg-muted">
                {weakness?.message || t("history.insufficientWeaknessData")}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {weakness.advice && (
                  <div className="border border-ide-border bg-ide-bg-alt p-2 text-xs text-ide-fg">
                    <div className="mb-1 text-ide-fg-muted">{t("history.advice")}</div>
                    <div className="whitespace-pre-wrap">{weakness.advice}</div>
                  </div>
                )}
                {weakness.weakestDimensions && weakness.weakestDimensions.length > 0 && (
                  <div className="border border-ide-border bg-ide-bg-alt p-2 text-xs">
                    <div className="mb-1 text-ide-fg-muted">{t("history.weakestDimensions")}</div>
                    <div className="flex flex-wrap gap-2">
                      {weakness.weakestDimensions.map((d, i) => (
                        <span
                          key={i}
                          className="flex items-center gap-1 bg-ide-danger/20 px-1.5 py-0.5 text-ide-danger"
                        >
                          {d.dimensionName}
                          <span className="font-mono">{d.avgScore.toFixed(1)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {weakness.totalEvaluations != null && (
                  <div className="text-[11px] text-ide-fg-muted">
                    {t("history.totalEvalRecords", { n: weakness.totalEvaluations })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 评估报告区 */}
          <div className="border-b border-ide-border">
            <div className="flex items-center justify-between border-b border-ide-border px-3 py-1.5 text-xs font-semibold uppercase text-ide-fg-muted">
              <div className="flex items-center gap-2">
                <Star size={12} />
                {t("history.evaluationReports", { n: evaluations.length })}
                <InfoTip text={t("history.evalReportTip")} />
              </div>
              {selected && messages.length > 0 && (
                <div className="flex items-center gap-1 normal-case">
                  <button
                    onClick={() => handleExport("md")}
                    title={t("history.exportMarkdown")}
                    className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent"
                  >
                    <Download size={12} />
                    MD
                  </button>
                  <button
                    onClick={() => handleExport("json")}
                    title={t("history.exportJSON")}
                    className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent"
                  >
                    <FileJson size={12} />
                    JSON
                  </button>
                  <button
                    onClick={() => handleExport("pdf")}
                    title={t("history.exportPDF")}
                    className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent"
                  >
                    <FileText size={12} />
                    PDF
                  </button>
                </div>
              )}
            </div>
            <div className="p-3">
              {loading ? (
                <div className="text-xs text-ide-fg-muted">{t("common.loading")}</div>
              ) : evaluations.length === 0 ? (
                <div className="text-xs text-ide-fg-muted">{t("history.noEvaluations")}</div>
              ) : (
                <div className="flex flex-col gap-3">
                  {evaluations.map((ev) => {
                    const evTime = ev.generatedAt || ev.createdAt;
                    return (
                      <div key={ev.evaluationId} className="border border-ide-border bg-ide-bg-alt p-3 text-xs">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-ide-fg-muted">{t("history.overallScore")}</span>
                            <span className="bg-ide-accent/20 px-1.5 py-0.5 font-mono text-ide-accent">
                              {ev.overallScore ?? "-"}
                            </span>
                          </div>
                          {evTime && (
                            <span className="text-[10px] text-ide-fg-muted">{formatTime(evTime)}</span>
                          )}
                        </div>
                        {ev.dimensions && ev.dimensions.length > 0 && (
                          <div className="mb-2">
                            <EvaluationRadar dimensions={ev.dimensions} maxScore={5} benchmark={PEER_BENCHMARK} />
                          </div>
                        )}
                        {ev.dimensions && ev.dimensions.length > 0 && (
                          <div className="mb-2 grid grid-cols-2 gap-1">
                            {ev.dimensions.map((d, i) => (
                              <div key={i} className="flex items-center gap-2 bg-ide-bg px-2 py-1">
                                <span className="text-ide-fg-muted">{d.dimensionName}</span>
                                <span className="font-mono text-ide-accent">{d.score}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {ev.report && (
                          <div className="mb-2">
                            <div className="text-ide-fg-muted">{t("history.report")}</div>
                            <div className="editable mt-1 whitespace-pre-wrap text-ide-fg">{ev.report}</div>
                          </div>
                        )}
                        {ev.improvementAdvice && (
                          <div className="mb-2">
                            <div className="text-ide-fg-muted">{t("history.improvementAdvice")}</div>
                            <div className="editable mt-1 whitespace-pre-wrap text-ide-fg">{ev.improvementAdvice}</div>
                          </div>
                        )}
                        {ev.betterAnswerSample && (
                          <div>
                            <div className="text-ide-fg-muted">{t("history.betterAnswerSample")}</div>
                            <div className="editable mt-1 whitespace-pre-wrap text-ide-success">{ev.betterAnswerSample}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 对话回看区 */}
          <div>
            <div className="flex items-center justify-between gap-1 border-b border-ide-border px-3 py-1.5 text-xs font-semibold uppercase text-ide-fg-muted">
              <div className="flex items-center gap-1">
                {t("history.conversationReview", { n: messages.length })}
                <InfoTip text={t("history.conversationReviewTip")} />
              </div>
              {selected && messages.length > 0 && (
                <button
                  onClick={handleOpenReviewDiscussion}
                  title={t("history.reviewDiscussionTip")}
                  className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 normal-case text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent"
                >
                  <MessagesSquare size={12} />
                  {t("history.reviewDiscussion")}
                </button>
              )}
            </div>
            <div className="p-3">
              {messages.length === 0 ? (
                <div className="text-xs text-ide-fg-muted">{t("history.noMessages")}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {messages.map((m, i) => (
                    <div
                      key={m.messageId || m.id || i}
                      className={cn(
                        "flex w-full",
                        m.role === "user" ? "justify-end" : "justify-start"
                      )}
                    >
                      <div
                        className={cn(
                          "bubble",
                          m.role === "user"
                            ? "bubble-user"
                            : m.role === "system"
                            ? "bubble-system"
                            : "bubble-assistant"
                        )}
                      >
                        <div className="mb-1 text-[10px] opacity-60">
                          {m.role === "user" ? t("history.roleUser") : m.role === "assistant" ? t("history.roleAI") : t("history.roleSystem")}
                          {m.createdAt && ` · ${formatTime(m.createdAt)}`}
                        </div>
                        {m.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>

      {/* 方案 5:复盘群聊覆盖层(z-50,与 modal 同级) */}
      {showReviewDiscussion && selected && (
        <ReviewDiscussion
          sessionId={selected.sessionId}
          messages={messages}
          evaluation={evaluations[0] || null}
          agents={reviewAgents}
          onClose={() => setShowReviewDiscussion(false)}
        />
      )}
    </>
  );
}
