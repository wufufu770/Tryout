// v6:群面会话配置组件
// 在会话创建/配置时使用,收集 GroupSessionConfig
import { useState, useEffect } from "react";
import { cn } from "@/shared";
import { useI18n } from "@/i18n";
import { CANDIDATE_PERSONAS, PRESET_TOPICS, getPersonaMeta, PERSONA_I18N_KEYS, TOPIC_CATEGORY_I18N_KEYS, topicI18nKey } from "@/lib/candidatePersonas";
import type { Agent } from "@/types/agent";
import type { GroupSessionConfig, CandidatePersona, SessionDifficulty } from "@/types/session";
import { DifficultySelector } from "@/components/DifficultySelector";
import { AgentAvatar } from "@/components/AgentAvatar";
import { InfoTip } from "@/components/InfoTip";
import { Users, Clock, Zap, Calendar, FileText } from "lucide-react";

interface Props {
  interviewers: Agent[];      // 可选的面试官 agent
  candidates: Agent[];        // 可选的候选人 agent
  config: GroupSessionConfig;
  difficulty: SessionDifficulty;
  onChange: (config: GroupSessionConfig) => void;
  onDifficultyChange: (d: SessionDifficulty) => void;
}

const DURATION_OPTIONS = [30, 45, 60];

export function GroupSessionConfigPanel({
  interviewers, candidates, config, difficulty, onChange, onDifficultyChange,
}: Props) {
  const { t } = useI18n();
  const update = (patch: Partial<GroupSessionConfig>) => onChange({ ...config, ...patch });

  // i18n helper:优先查 i18n,查不到回退到原值
  const personaLabel = (value: CandidatePersona | null | undefined, fallback?: string): string => {
    if (!value) return fallback || "";
    const k = PERSONA_I18N_KEYS[value]?.labelKey;
    if (!k) return fallback || "";
    const v = t(k);
    return v === k ? (fallback || "") : v;
  };
  const personaDesc = (value: CandidatePersona | null | undefined, fallback?: string): string => {
    if (!value) return fallback || "";
    const k = PERSONA_I18N_KEYS[value]?.descKey;
    if (!k) return fallback || "";
    const v = t(k);
    return v === k ? (fallback || "") : v;
  };
  const topicCategoryLabel = (c: string, fallback: string): string => {
    const k = (TOPIC_CATEGORY_I18N_KEYS as any)[c];
    if (!k) return fallback;
    const v = t(k);
    return v === k ? fallback : v;
  };
  const topicTitle = (id: string, fallback: string): string => {
    const k = topicI18nKey(id);
    const v = t(k);
    return v === k ? fallback : v;
  };

  // 面试官多选(1-2)
  const toggleInterviewer = (id: string) => {
    const cur = config.interviewerAgentIds || [];
    if (cur.includes(id)) {
      update({ interviewerAgentIds: cur.filter((x) => x !== id) });
    } else {
      if (cur.length >= 2) return;
      update({ interviewerAgentIds: [...cur, id] });
    }
  };

  // 候选人 agent 多选(用户自定义,1-8)
  const toggleCandidateAgent = (id: string) => {
    const cur = config.candidateAgentIds || [];
    if (cur.includes(id)) {
      update({ candidateAgentIds: cur.filter((x) => x !== id) });
    } else {
      if (cur.length >= 8) return;
      update({ candidateAgentIds: [...cur, id] });
    }
  };

  // 画像多选(当选了 candidateAgentIds 时,画像仅作辅助)
  const togglePersona = (p: CandidatePersona) => {
    const cur = config.personas || [];
    if (cur.includes(p)) {
      update({ personas: cur.filter((x) => x !== p) });
    } else {
      update({ personas: [...cur, p] });
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      {/* 面试官选择 */}
      <Section title={t("groupSessionConfig.interviewers.title")} icon={<Users size={12} />} tip={t("groupSessionConfig.interviewers.tip")}>
        <div className="grid grid-cols-2 gap-1.5">
          {interviewers.length === 0 && (
            <div className="col-span-2 text-ide-fg-muted">{t("groupSessionConfig.interviewers.empty")}</div>
          )}
          {interviewers.map((a) => {
            const selected = (config.interviewerAgentIds || []).includes(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggleInterviewer(a.id)}
                className={cn(
                  "flex items-center gap-1.5 border px-2 py-1.5 text-left",
                  selected ? "border-ide-accent bg-ide-accent/10" : "border-ide-border bg-ide-bg hover:bg-ide-bg-active"
                )}
              >
                <AgentAvatar agent={a} size={18} />
                <span className="flex-1 truncate">{a.name}</span>
              </button>
            );
          })}
        </div>
        {(config.interviewerAgentIds || []).length === 0 && (
          <div className="mt-1 text-[10px] text-ide-warning">{t("groupSessionConfig.interviewers.required")}</div>
        )}
      </Section>

      {/* 候选人选择:自定义 agent + 画像辅助 */}
      <Section title={t("groupSessionConfig.candidates.title")} icon={<Users size={12} />} tip={t("groupSessionConfig.candidates.tip")}>
        <div className="grid grid-cols-2 gap-1.5">
          {candidates.length === 0 && (
            <div className="col-span-2 text-ide-fg-muted">
              {t("groupSessionConfig.candidates.empty")}
            </div>
          )}
          {candidates.map((a) => {
            const selected = (config.candidateAgentIds || []).includes(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggleCandidateAgent(a.id)}
                className={cn(
                  "flex items-center gap-1.5 border px-2 py-1.5 text-left",
                  selected ? "border-ide-accent bg-ide-accent/10" : "border-ide-border bg-ide-bg hover:bg-ide-bg-active"
                )}
              >
                <AgentAvatar agent={a} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{a.name}</div>
                  {a.candidatePersona && (
                    <div className="truncate text-[9px] text-ide-fg-muted">
                      {personaLabel(a.candidatePersona, getPersonaMeta(a.candidatePersona)?.label)}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {(config.candidateAgentIds || []).length === 0 && (
          <>
            <div className="mb-1 mt-3 text-[10px] text-ide-fg-muted">
              {t("groupSessionConfig.candidates.usePersona")}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {CANDIDATE_PERSONAS.map((p) => {
                const PersonaIcon = p.icon;
                const selected = (config.personas || []).includes(p.value);
                return (
                  <button
                    key={p.value}
                    onClick={() => togglePersona(p.value)}
                    title={personaDesc(p.value, p.desc)}
                    className={cn(
                      "flex items-center gap-1 border px-1.5 py-1 text-[10px]",
                      selected ? "border-ide-accent bg-ide-accent/10" : "border-ide-border bg-ide-bg hover:bg-ide-bg-active"
                    )}
                  >
                    <PersonaIcon size={11} style={{ color: p.color }} />
                    <span className="truncate">{personaLabel(p.value, p.label)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-2 flex items-center gap-2">
          <span className="text-ide-fg-muted">{t("groupSessionConfig.candidates.count", { n: config.candidateCount + 1 })}</span>
          <input
            type="range"
            min={1}
            max={8}
            value={config.candidateCount}
            onChange={(e) => update({ candidateCount: Number(e.target.value) })}
            className="flex-1 accent-ide-accent"
          />
          <span className="w-6 text-center text-ide-accent">{config.candidateCount}</span>
        </div>
      </Section>

      {/* 讨论话题 */}
      <Section title={t("groupSessionConfig.topic.title")} icon={<FileText size={12} />} tip={t("groupSessionConfig.topic.tip")}>
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => update({ topicType: "preset" })}
            className={cn(
              "border px-2 py-0.5",
              config.topicType === "preset" ? "border-ide-accent bg-ide-accent/10 text-ide-fg" : "border-ide-border text-ide-fg-muted"
            )}
          >
            {t("groupSessionConfig.topic.preset")}
          </button>
          <button
            onClick={() => update({ topicType: "custom" })}
            className={cn(
              "border px-2 py-0.5",
              config.topicType === "custom" ? "border-ide-accent bg-ide-accent/10 text-ide-fg" : "border-ide-border text-ide-fg-muted"
            )}
          >
            {t("groupSessionConfig.topic.custom")}
          </button>
        </div>
        {config.topicType === "preset" ? (
          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_TOPICS.map((t_topic) => {
              const selected = config.topic === t_topic.content;
              return (
                <button
                  key={t_topic.id}
                  onClick={() => update({ topic: t_topic.content })}
                  className={cn(
                    "border p-2 text-left text-[10px]",
                    selected ? "border-ide-accent bg-ide-accent/10" : "border-ide-border bg-ide-bg hover:bg-ide-bg-active"
                  )}
                >
                  <div className="flex items-center gap-1">
                    <span className="bg-ide-bg-active px-1 text-[9px] text-ide-fg-muted">{topicCategoryLabel(t_topic.category, t_topic.category)}</span>
                    <span className="truncate font-medium text-ide-fg">{topicTitle(t_topic.id, t_topic.title)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <textarea
            value={config.topic}
            onChange={(e) => update({ topic: e.target.value })}
            placeholder={t("groupSessionConfig.topic.placeholder")}
            rows={4}
            className="w-full resize-none border border-ide-border bg-ide-bg px-2 py-1 text-ide-fg outline-none focus:border-ide-accent"
          />
        )}
      </Section>

      {/* 时长与加速 */}
      <Section title={t("groupSessionConfig.duration.title")} icon={<Clock size={12} />} tip={t("groupSessionConfig.duration.tip")}>
        <div className="flex items-center gap-2">
          {DURATION_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => update({ durationMin: d })}
              className={cn(
                "flex items-center gap-1 border px-2 py-1",
                config.durationMin === d ? "border-ide-accent bg-ide-accent/10 text-ide-fg" : "border-ide-border text-ide-fg-muted hover:bg-ide-bg-active"
              )}
            >
              <Calendar size={10} /> {t("groupSessionConfig.duration.minutes", { n: d })}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-ide-fg-muted">
            <input
              type="checkbox"
              checked={config.accelerated}
              onChange={(e) => update({ accelerated: e.target.checked })}
              className="accent-ide-accent"
            />
            <Zap size={10} /> {t("groupSessionConfig.duration.accelerated")}
          </label>
        </div>
      </Section>

      {/* 难度 */}
      <Section title={t("groupSessionConfig.difficulty.title")} icon={<FileText size={12} />} tip={t("groupSessionConfig.difficulty.tip")}>
        <DifficultySelector value={difficulty} onChange={onDifficultyChange} size="sm" />
      </Section>
    </div>
  );
}

function Section({ title, icon, tip, children }: { title: string; icon: React.ReactNode; tip?: string; children: React.ReactNode }) {
  return (
    <div className="border border-ide-border p-2">
      <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-ide-fg">
        {icon}
        {title}
        {tip && <InfoTip text={tip} />}
      </div>
      {children}
    </div>
  );
}

// 默认配置
export function defaultGroupConfig(): GroupSessionConfig {
  return {
    candidateCount: 3,
    personas: ["calm", "leader", "challenger"],
    candidateAgentIds: [],
    topic: PRESET_TOPICS[0].content,
    topicType: "preset",
    durationMin: 30,
    accelerated: true,
    interviewerCount: 1,
    interviewerAgentIds: [],
  };
}
