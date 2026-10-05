// v5:分组归纳计算(本地数据聚合 + 可选 LLM 增强)
import { api } from "@/api/client";
import { getDifficultyConfig } from "@/shared";

export interface GroupSummary {
  totalSessions: number;
  avgScore: number;
  maxScore: number;
  minScore: number;
  dateRange: { start: string; end: string } | null;
  progressPoints: { score: number; date: string; sessionId: string; title: string }[];
  improvedDimensions: { name: string; earlyAvg: number; lateAvg: number; delta: number }[];
  weakDimensions: { name: string; avgScore: number; count: number }[];
  trend: "up" | "down" | "stable" | "insufficient";
  advice: string;
  llmAdvice?: string; // LLM 增强归纳的自然语言建议
  /**
   * R25:有评估但全部缺分的会话 id。
   * 之前这些会话会被静默丢弃,导致 totalSessions 与 progressPoints 对不上。
   */
  noScoreSessionIds?: string[];
}

// 本地聚合计算(不调用 LLM)
export function computeGroupSummaryLocal(
  sessions: any[],
  reviews: any[],
  evaluations: any[]
): GroupSummary {
  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

  // 收集带分数的会话(review 优先,无 review 用 evaluation 均分)
  const scoredPoints: { score: number; date: string; sessionId: string; title: string }[] = [];
  for (const r of reviews) {
    const sess = sessionMap.get(r.sessionId);
    if (r.overallScore != null && (r.generatedAt || sess?.createdAt)) {
      scoredPoints.push({
        score: Number(r.overallScore),
        date: r.generatedAt || sess.createdAt,
        sessionId: r.sessionId,
        title: sess?.title || "未命名",
      });
    }
  }
  // 用 evaluation 补充(review 没覆盖的会话)
  const reviewSessionIds = new Set(reviews.map((r) => r.sessionId));
  /** 有评估但无有效分数的会话 —— 显式记录,而不是让它们凭空消失 */
  const noScoreSessionIds: string[] = [];
  const evalBySession = new Map<string, any[]>();
  for (const e of evaluations) {
    if (!evalBySession.has(e.sessionId)) evalBySession.set(e.sessionId, []);
    evalBySession.get(e.sessionId)!.push(e);
  }
  for (const [sid, evals] of evalBySession) {
    if (reviewSessionIds.has(sid)) continue;
    const sess = sessionMap.get(sid);
    if (!sess) continue;
    /*
     * ⚠️ R25:此处曾有一处静默丢弃。
     * 旧写法:先对每个 overallScore 做 `|| 0` 再求平均,最后用 `avg > 0` 过滤。
     * 后果:某 session 的评估**全部缺分**时 avg 算成 0,被静默丢弃,
     * 但 `totalSessions` 仍然计入它 —— 导致两者数量对不上、趋势计算失真,
     * 而用户看到的只是一个"少了点"的分段归纳,无从察觉。
     *
     * 现在:只对**有有效分数**的评估求平均;
     * 一个有效分数都没有时,明确排除出 progressPoints,
     * 并在 noScoreSessionIds 中记下来,供 UI 说明"有 N 场未评分"。
     */
    const valid = evals
      .map((e) => Number(e?.overallScore))
      .filter((n) => Number.isFinite(n));
    if (valid.length === 0) {
      noScoreSessionIds.push(sid);
      continue;
    }
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
    scoredPoints.push({
      score: avg,
      date: sess.createdAt || evals[0]?.generatedAt,
      sessionId: sid,
      title: sess.title || "未命名",
    });
  }

  // 按时间排序
  scoredPoints.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const totalSessions = sessions.length;
  const scores = scoredPoints.map((p) => p.score);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const dateRange = scoredPoints.length > 0
    ? { start: scoredPoints[0].date, end: scoredPoints[scoredPoints.length - 1].date }
    : null;

  // 趋势:前 1/3 vs 后 1/3
  let trend: GroupSummary["trend"] = "insufficient";
  if (scoredPoints.length >= 4) {
    const third = Math.max(1, Math.floor(scoredPoints.length / 3));
    const early = scoredPoints.slice(0, third);
    const late = scoredPoints.slice(-third);
    const earlyAvg = early.reduce((a, b) => a + b.score, 0) / early.length;
    const lateAvg = late.reduce((a, b) => a + b.score, 0) / late.length;
    const delta = lateAvg - earlyAvg;
    if (delta > 0.5) trend = "up";
    else if (delta < -0.5) trend = "down";
    else trend = "stable";
  }

  // 维度分析(用 evaluation_dimensions)
  const dimScores: Record<string, { scores: number[]; dates: string[] }> = {};
  for (const e of evaluations) {
    for (const d of (e.dimensions || [])) {
      if (!dimScores[d.dimensionName]) dimScores[d.dimensionName] = { scores: [], dates: [] };
      dimScores[d.dimensionName].scores.push(Number(d.score));
      dimScores[d.dimensionName].dates.push(e.generatedAt || e.createdAt || "");
    }
  }

  // 已提升维度:早期均分 vs 晚期均分
  const improvedDimensions: { name: string; earlyAvg: number; lateAvg: number; delta: number }[] = [];
  for (const [name, data] of Object.entries(dimScores)) {
    if (data.scores.length >= 2) {
      const half = Math.max(1, Math.floor(data.scores.length / 2));
      const earlyAvg = data.scores.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const lateAvg = data.scores.slice(-half).reduce((a, b) => a + b, 0) / half;
      improvedDimensions.push({ name, earlyAvg, lateAvg, delta: lateAvg - earlyAvg });
    }
  }
  improvedDimensions.sort((a, b) => b.delta - a.delta);

  // 仍需加强维度:平均分最低的
  const weakDimensions = Object.entries(dimScores)
    .map(([name, data]) => ({
      name,
      avgScore: data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
      count: data.scores.length,
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  // 生成基础建议(规则)
  const upDims = improvedDimensions.filter((d) => d.delta > 0.3).map((d) => d.name);
  const downDims = improvedDimensions.filter((d) => d.delta < -0.3).map((d) => d.name);
  const weakest = weakDimensions.slice(0, 2).map((d) => d.name);
  let advice = "";
  if (totalSessions === 0) {
    advice = "暂无面试数据";
  } else if (scoredPoints.length === 0) {
    advice = "已完成面试但未生成评价,建议结束面试后生成整场回顾以获得分析";
  } else {
    const parts: string[] = [];
    if (upDims.length > 0) parts.push(`已提升:${upDims.join("、")}`);
    if (downDims.length > 0) parts.push(`需关注:${downDims.join("、")}出现下滑`);
    if (weakest.length > 0) parts.push(`重点训练:${weakest.join("、")}`);
    if (trend === "up") parts.push("整体呈进步趋势,继续保持");
    else if (trend === "down") parts.push("整体有下滑,建议复盘最近面试");
    advice = parts.join("。") || "数据不足以给出建议";
  }

  return {
    totalSessions,
    avgScore,
    maxScore,
    minScore,
    dateRange,
    progressPoints: scoredPoints,
    improvedDimensions,
    weakDimensions,
    trend,
    advice,
    noScoreSessionIds: noScoreSessionIds.length ? noScoreSessionIds : undefined,
  };
}

// LLM 增强归纳(可选)
export async function generateGroupSummaryLLM(
  groupId: string,
  localSummary: GroupSummary
): Promise<string> {
  // 找一个可用 provider
  const providers = (await api.listProviders()) || [];
  const active = providers.find((p: any) => p.isActive) || providers[0];
  if (!active) throw new Error("无可用模型,请先在设置中配置供应商");

  const prompt = `你是一位面试教练,请基于以下候选人的多次面试数据,生成一段自然语言的阶段性归纳建议。

分组数据:
- 总场次:${localSummary.totalSessions}
- 平均分:${localSummary.avgScore.toFixed(1)}(最高 ${localSummary.maxScore.toFixed(1)},最低 ${localSummary.minScore.toFixed(1)})
- 趋势:${localSummary.trend}
- 已提升维度:${localSummary.improvedDimensions.filter((d) => d.delta > 0.3).map((d) => `${d.name}(+${d.delta.toFixed(1)})`).join(", ") || "无"}
- 仍需加强维度:${localSummary.weakDimensions.slice(0, 3).map((d) => `${d.name}(${d.avgScore.toFixed(1)})`).join(", ") || "无"}

进步曲线(按时间顺序):${localSummary.progressPoints.map((p) => `${p.score.toFixed(1)}`).join(" → ") || "无"}

请输出 200-300 字的归纳,包含:整体表现、明显进步、仍需加强、下阶段建议。不要用 JSON,直接输出文本。`;

  let acc = "";
  const result = (await api.chat(active.id, { messages: [{ role: "user", content: prompt }] }, (t) => {
    acc += t;
  })) as any;
  return result?.content || acc;
}

// 判断归纳是否需要刷新(7 天缓存)
export function shouldRefreshSummary(summaryGeneratedAt?: string): boolean {
  if (!summaryGeneratedAt) return true;
  const age = Date.now() - new Date(summaryGeneratedAt).getTime();
  return age > 7 * 24 * 60 * 60 * 1000;
}

// 难度档位描述(用于归纳卡片显示)
export function describeDifficulty(difficulty?: string): string {
  if (!difficulty) return "未指定";
  return getDifficultyConfig(difficulty).label;
}
