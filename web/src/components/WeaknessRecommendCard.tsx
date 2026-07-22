// C5:弱点闭环推荐
// 基于 WeaknessResult.weakestDimensions,从 INTERVIEW_SCENARIOS 中筛选匹配场景
// 点击卡片跳转到 /interview?focus=xxx 预填 focusDirection
//
// 2026-07 修复:维度名从 EVALUATION_DIMENSIONS 单一数据源取,彻底消除硬编码不一致
// 2026-07 修复:关键词匹配加入边界检查,避免"问题""解决"等过宽词召回精度低
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Lightbulb, ArrowRight } from "lucide-react";
import { INTERVIEW_SCENARIOS, getDifficultyConfig, cn } from "@/shared";
import { useI18n } from "@/i18n";
import { InfoTip } from "@/components/InfoTip";
import { EVALUATION_DIMENSIONS } from "@/lib/evaluation/starEvaluator";
import type { WeaknessResult } from "@/lib/analysis/weaknessAnalyzer";

interface Props {
  weakness: WeaknessResult | null;
}

// 维度 key → 关键词映射(用 key 不用中文名,彻底解耦)
// 关键词选择原则:具体、有区分度,避免"问题""解决"等过宽词
const DIMENSION_KEYWORDS: Record<string, string[]> = {
  technical: ["高并发", "分布式", "系统设计", "MySQL", "Go", "Java", "中间件", "架构", "Redis", "Kafka", "微服务", "技术原理"],
  communication: ["沟通", "协作", "表达", "团队", "跨部门", "汇报", "冲突"],
  logic: ["tradeoff", "设计", "分析", "决策", "拆解", "推理", "权衡"],
  problemSolving: ["故障", "排查", "坑", "方案", "落地", "优化", "瓶颈", "调优"],
  resilience: ["抗压", "应变", "压力", "临场", "紧急", "deadline", "加班"],
  culture: ["价值观", "战略", "商业", "文化", "使命", "愿景"],
};

export function WeaknessRecommendCard({ weakness }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();

  // 根据薄弱维度推荐场景
  const recommendations = useMemo(() => {
    if (!weakness?.weakestDimensions || weakness.weakestDimensions.length === 0) return [];

    // 用 EVALUATION_DIMENSIONS 把维度名转成 key,再查关键词
    const weakKeys = new Set<string>();
    for (const d of weakness.weakestDimensions) {
      const dim = EVALUATION_DIMENSIONS.find(x => x.name === d.dimensionName);
      if (dim) weakKeys.add(dim.key);
    }
    if (weakKeys.size === 0) return [];

    // 收集所有薄弱维度的关键词
    const keywords = new Set<string>();
    for (const key of weakKeys) {
      const kws = DIMENSION_KEYWORDS[key];
      if (kws) kws.forEach((k) => keywords.add(k));
    }
    if (keywords.size === 0) return [];

    // 给每个场景打分:匹配关键词的数量
    const scored = INTERVIEW_SCENARIOS.map((s) => {
      const text = `${s.focusDirection} ${s.topic} ${s.typicalQuestions.join(" ")} ${s.description}`;
      let score = 0;
      for (const kw of keywords) {
        if (text.includes(kw)) score++;
      }
      return { scenario: s, score };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return scored.map((x) => x.scenario);
  }, [weakness]);

  const handlePractice = (focusDirection: string) => {
    // 通过 URL 参数预填 focusDirection,InterviewPage 会读取 ?focus=xxx
    const focus = encodeURIComponent(focusDirection);
    navigate(`/interview?focus=${focus}`);
  };

  if (!weakness || !weakness.hasData || recommendations.length === 0) {
    return (
      <div className="border border-ide-border bg-ide-bg-alt p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
          <Lightbulb size={12} />
          {t("weakness.recommendTitle")}
          <InfoTip text={t("weakness.recommendTip")} />
        </div>
        <div className="py-2 text-xs text-ide-fg-muted">{t("weakness.noRecommend")}</div>
      </div>
    );
  }

  return (
    <div className="border border-ide-border bg-ide-bg-alt p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
        <Lightbulb size={12} />
        {t("weakness.recommendTitle")}
        <InfoTip text={t("weakness.recommendTip")} />
      </div>
      <div className="flex flex-col gap-2">
        {recommendations.map((s) => {
          const diff = getDifficultyConfig(s.difficulty);
          return (
            <button
              key={s.id}
              onClick={() => handlePractice(s.focusDirection)}
              className={cn(
                "group flex items-center gap-2 border border-ide-border bg-ide-bg p-2 text-left text-xs hover:border-ide-accent hover:bg-ide-accent/5",
              )}
            >
              <span className="shrink-0" style={{ color: diff.color }}>●</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold text-ide-fg">{s.title}</span>
                  <span className="shrink-0 text-[9px] text-ide-fg-muted">{s.duration}</span>
                </div>
                <div className="truncate text-[10px] text-ide-fg-muted">{s.topic}</div>
              </div>
              <ArrowRight
                size={12}
                className="shrink-0 text-ide-fg-muted opacity-0 transition-opacity group-hover:opacity-100"
              />
              <span className="shrink-0 text-[10px] text-ide-accent opacity-0 transition-opacity group-hover:opacity-100">
                {t("weakness.practiceNow")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
