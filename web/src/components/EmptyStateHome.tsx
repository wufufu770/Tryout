// 首屏空状态:推荐剧本 + 最近练习 + 能力雷达
// v10:把"工具"变"产品",新用户进来就有事可做,价值前置
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/i18n";
import { INTERVIEW_SCENARIOS, type InterviewScenario } from "@/shared";
import { EvaluationRadar } from "@/components/charts/EvaluationRadar";
import { ArrowRight, Clock, TrendingUp, Sparkles, Target } from "lucide-react";
import { cn } from "@/shared";

interface Props {
  onPickScenario: (s: InterviewScenario) => void;
  recentSessions?: Array<{
    sessionId: string;
    title: string;
    updatedAt?: string;
    difficulty?: string;
    modelId?: string;
  }>;
  evaluations?: Array<{
    dimensions?: { dimensionName: string; score: number; weight?: number }[];
    overallScore: number;
    generatedAt?: string;
    sessionId: string;
  }>;
}

const CATEGORY_COLORS: Record<string, string> = {
  tech: "border-l-blue-500",
  hr: "border-l-green-500",
  behavioral: "border-l-purple-500",
  group: "border-l-orange-500",
  campus: "border-l-cyan-500",
  senior: "border-l-red-500",
  startup: "border-l-yellow-500",
  ceo: "border-l-pink-500",
};

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  tech: "scenario.category.tech",
  hr: "scenario.category.hr",
  behavioral: "scenario.category.behavioral",
  group: "scenario.category.group",
  campus: "scenario.category.campus",
  senior: "scenario.category.senior",
  startup: "scenario.category.startup",
  ceo: "scenario.category.ceo",
};

export function EmptyStateHome({ onPickScenario, recentSessions = [], evaluations = [] }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();

  // 推荐剧本:精选 6 个高价值场景(覆盖技术/行为/HR/系统设计)
  const featuredScenarios = useMemo(() => {
    const featuredIds = ["bytedance-backend", "alibaba-p7-system-design", "hr-behavior-general", "behavioral-star", "campus-tech", "ceo-strategic"];
    const byId = new Map(INTERVIEW_SCENARIOS.map(s => [s.id, s]));
    const picked: InterviewScenario[] = [];
    for (const id of featuredIds) {
      const s = byId.get(id);
      if (s) picked.push(s);
    }
    // 不足 6 个则从 INTERVIEW_SCENARIOS 补齐
    if (picked.length < 6) {
      for (const s of INTERVIEW_SCENARIOS) {
        if (picked.length >= 6) break;
        if (!picked.some(p => p.id === s.id)) picked.push(s);
      }
    }
    return picked.slice(0, 6);
  }, []);

  // 跨场能力雷达:聚合所有 evaluations 的 dimensions
  const radarData = useMemo(() => {
    const byDim = new Map<string, { sum: number; weight: number }>();
    for (const e of evaluations) {
      for (const d of e.dimensions || []) {
        const cur = byDim.get(d.dimensionName) || { sum: 0, weight: 0 };
        cur.sum += d.score * (d.weight || 1);
        cur.weight += d.weight || 1;
        byDim.set(d.dimensionName, cur);
      }
    }
    return Array.from(byDim.entries()).map(([name, v]) => ({
      dimensionName: name,
      score: v.weight > 0 ? Number((v.sum / v.weight).toFixed(2)) : 0,
    }));
  }, [evaluations]);

  const recentTop3 = recentSessions.slice(0, 3);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* === Hero === */}
        <div className="mb-8 text-center">
          <div className="mb-2 inline-flex items-center gap-2 font-mono text-2xl font-bold">
            <Sparkles size={20} className="text-ide-accent" />
            <span className="text-ide-fg">{t("empty.hero.title")}</span>
          </div>
          <p className="text-sm text-ide-fg-muted">{t("empty.hero.subtitle")}</p>
        </div>

        {/* === 快速开始:推荐剧本 === */}
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ide-fg-muted">
            <Sparkles size={14} className="text-ide-accent" />
            <span>{t("empty.featured.title")}</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featuredScenarios.map((s) => {
              const colorClass = CATEGORY_COLORS[s.category] || "border-l-ide-border";
              return (
                <button
                  key={s.id}
                  onClick={() => onPickScenario(s)}
                  className={cn(
                    "group border border-ide-border border-l-4 bg-ide-bg-alt p-4 text-left transition-all hover:border-ide-border-active hover:shadow-md",
                    colorClass,
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-ide-fg-muted">{t(CATEGORY_LABEL_KEYS[s.category] || "scenario.category.tech")}</span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-ide-fg-muted">
                      <Clock size={10} />{s.duration}
                    </span>
                  </div>
                  <div className="mb-2 text-sm font-semibold text-ide-fg group-hover:text-ide-accent">
                    {s.title}
                  </div>
                  <div className="line-clamp-2 text-xs text-ide-fg-muted">
                    {s.topic}
                  </div>
                  <div className="mt-2 inline-flex items-center gap-1 text-xs text-ide-accent opacity-0 transition-opacity group-hover:opacity-100">
                    {t("empty.startPractice")} <ArrowRight size={12} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* === 最近练习 === */}
        {recentTop3.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ide-fg-muted">
              <Clock size={14} className="text-ide-accent" />
              <span>{t("empty.recent.title")}</span>
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {recentTop3.map((s) => (
                <button
                  key={s.sessionId}
                  onClick={() => navigate(`/interview?session=${s.sessionId}`)}
                  className="group border border-ide-border bg-ide-bg-alt p-3 text-left transition-colors hover:border-ide-border-active"
                >
                  <div className="truncate text-sm font-medium text-ide-fg group-hover:text-ide-accent">
                    {s.title}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-ide-fg-muted">
                    <span>{s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "-"}</span>
                    {s.difficulty && (
                      <span className="rounded px-1.5 py-0.5 bg-ide-bg-active">{s.difficulty}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* === 能力雷达 === */}
        {radarData.length >= 3 ? (
          <section className="mb-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ide-fg-muted">
              <TrendingUp size={14} className="text-ide-accent" />
              <span>{t("empty.radar.title")}</span>
            </h2>
            <div className="border border-ide-border bg-ide-bg-alt p-4">
              <EvaluationRadar dimensions={radarData} />
              <p className="mt-2 text-center text-xs text-ide-fg-muted">
                {t("empty.radar.hint", { count: evaluations.length })}
              </p>
            </div>
          </section>
        ) : (
          <section className="mb-4">
            <div className="border border-dashed border-ide-border bg-ide-bg-alt/50 p-6 text-center">
              <Target size={28} className="mx-auto mb-2 text-ide-fg-muted" />
              <p className="text-sm text-ide-fg">{t("empty.radar.empty.title")}</p>
              <p className="mt-1 text-xs text-ide-fg-muted">{t("empty.radar.empty.hint")}</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
