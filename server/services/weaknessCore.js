// 弱项分析核心逻辑
//
// R25:从 Express 路由里抽出为纯函数。
// 原因:这段逻辑会**直接给用户"该练什么"的建议**,
// 内联在路由里无法单测 —— 而统计口径错了就是在给错误建议。
//
// 已确认并保留的原有正确行为:
//   - 无评估数据 → hasData:false + 说明,**不编造建议**
//
// R25 新增:维度样本量门槛。
//   1 次评估得 3 分可能是运气(题目恰好不熟),10 次均分 3 分才是真弱项。
//   此前所有维度一视同仁进入"建议加强练习",等于用 1 个样本下结论。

const DEFAULT_MIN_SAMPLES = 3;

/**
 * @param {any[]} evaluations 评估列表
 * @param {{minSamples?: number}} [opts]
 */
export function analyzeWeaknessCore(evaluations, opts = {}) {
  const minSamples = opts.minSamples ?? DEFAULT_MIN_SAMPLES;
  const all = Array.isArray(evaluations) ? evaluations : [];

  if (all.length === 0) {
    return { hasData: false, message: "暂无评估数据,完成一次面试后再来查看" };
  }

  // ---- 维度聚合 ----
  const buckets = new Map();
  for (const e of all) {
    for (const d of (e?.dimensions || [])) {
      const score = Number(d?.score);
      // 非法分数跳过,不按 0 计入均值
      if (!Number.isFinite(score)) continue;
      const name = d.dimensionName;
      if (!name) continue;
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(score);
    }
  }

  const dimensionStats = [...buckets.entries()]
    .map(([dimensionName, scores]) => ({
      dimensionName,
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      count: scores.length,
      lowConfidence: scores.length < minSamples,
    }))
    .sort((a, b) => a.avgScore - b.avgScore);

  // ---- 弱项:只取达到样本量门槛的 ----
  const eligible = dimensionStats.filter((d) => !d.lowConfidence);
  const weakest = eligible.slice(0, 2);

  let advice = "";
  if (dimensionStats.length === 0) {
    // 有评估但没有任何维度数据
    advice = "本次评估未包含维度明细,暂时无法定位弱项。";
  } else if (eligible.length === 0) {
    // ⚠️ 不编造:只说样本不够,不说"该练什么"
    const need = minSamples - Math.min(...dimensionStats.map((d) => d.count));
    advice = `各维度样本还不够(每个维度至少需要 ${minSamples} 次评估,还差约 ${Math.max(0, need)} 次),暂时无法给出可靠的练习建议。`;
  } else {
    advice = `建议加强练习【${weakest.map((w) => w.dimensionName).join("】和【")}】方向的题目。`;
  }

  return {
    hasData: true,
    totalEvaluations: all.length,
    dimensionStats,
    weakestDimensions: weakest,
    advice,
    // 最近分数按时间倒序
    recentScores: [...all]
      .sort((a, b) => new Date(b?.generatedAt || 0).getTime() - new Date(a?.generatedAt || 0).getTime())
      .map((e) => ({ score: e?.overallScore, date: e?.generatedAt, sessionId: e?.sessionId })),
  };
}
