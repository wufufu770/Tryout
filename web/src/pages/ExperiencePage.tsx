// ExperiencePage:面经广场页面 + 题库(双 tab)
// 顶部标题栏 + Tab 切换(面经广场 / 题库)
// 面经广场:筛选区(公司/岗位/轮次/难度/结果/搜索),卡片网格,问答弹窗,社区分享
// 题库:筛选区(行业/题型/难度/搜索),题目卡片,题目详情弹窗(参考答案 + 关键要点 + 模拟此题)
// 社区分享:支持从 GitHub URL/文件导入 .ix-experience.json,导出当前面经为社区分享文件
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Newspaper, Search, Star, Clock, X, Play, ChevronDown, Link2, Github, Download, BookOpen, Tag, Lightbulb, Timer, CheckCircle2 } from "lucide-react";
import { cn } from "@/shared";
import { InfoTip } from "@/components/InfoTip";
import { useI18n } from "@/i18n";
import {
  EXPERIENCES,
  COMPANIES,
  POSITIONS,
  ROUNDS,
  RESULTS,
  type Experience,
} from "@/data/experiences";
import {
  fetchJsonFromUrl,
  readJsonFile,
  validateExperience,
  downloadJson,
  type ShareableExperience,
} from "@/lib/community";
import {
  QUESTION_BANK,
  INDUSTRIES,
  QUESTION_TYPES,
  DIFFICULTIES,
  filterQuestions,
  type Question,
} from "@/data/questionBank";
import { useModalA11y } from "@/lib/useModalA11y";

// 将内置 Experience 转换为社区分享格式 ShareableExperience
function experienceToShareable(exp: Experience): ShareableExperience {
  return {
    kind: "interviewx-experience",
    version: 1,
    company: exp.company,
    position: exp.position,
    round: exp.round,
    result: exp.result,
    difficulty: exp.difficulty,
    tags: exp.tags,
    duration: String(exp.duration),
    questions: exp.questions.map((q) => ({
      question: q.q,
      category: "unknown",
      myAnswer: q.a,
    })),
    summary: exp.summary,
  };
}

// 将社区分享格式转换回内置 Experience 用于本地展示
function shareableToExperience(data: ShareableExperience, idx: number): Experience {
  return {
    id: `community_${Date.now()}_${idx}`,
    company: data.company,
    position: typeof data.position === "string" ? data.position : "未知",
    round: typeof data.round === "string" ? data.round : "一面",
    difficulty: typeof data.difficulty === "number" && data.difficulty >= 1 && data.difficulty <= 5
      ? data.difficulty : 3,
    result: typeof data.result === "string" ? data.result : "待定",
    date: new Date().toISOString().slice(0, 7),
    tags: Array.isArray(data.tags) ? data.tags.filter((t: any) => typeof t === "string") : [],
    questions: Array.isArray(data.questions)
      ? data.questions
          .filter((q: any): q is Record<string, unknown> => !!q && typeof q === "object")
          .map((q) => ({
            q: typeof q.question === "string" ? q.question : "",
            a: typeof (q.myAnswer ?? q.feedback) === "string" ? (q.myAnswer as string) ?? (q.feedback as string) ?? "" : "",
          }))
      : [],
    summary: typeof data.summary === "string" ? data.summary : "(社区分享面经)",
    duration: (() => {
      const n = Number(data.duration);
      return Number.isFinite(n) && n > 0 ? n : 60;
    })(),
  };
}

// 公司徽章配色(用固定 hex,避免被主题覆盖公司辨识度)
const COMPANY_BADGE: Record<string, { bg: string; fg: string }> = {
  字节: { bg: "#325ab9", fg: "#ffffff" },
  阿里: { bg: "#ff6a00", fg: "#ffffff" },
  腾讯: { bg: "#1296db", fg: "#ffffff" },
  美团: { bg: "#ffc300", fg: "#1a1a1a" },
  拼多多: { bg: "#e02020", fg: "#ffffff" },
  百度: { bg: "#2932e1", fg: "#ffffff" },
  华为: { bg: "#cf0a2c", fg: "#ffffff" },
  微软: { bg: "#0078d4", fg: "#ffffff" },
  亚马逊: { bg: "#ff9900", fg: "#1a1a1a" },
  高盛: { bg: "#7399c4", fg: "#ffffff" },
};

function getCompanyBadge(company: string) {
  return COMPANY_BADGE[company] || { bg: "var(--ide-fg-muted)", fg: "var(--ide-fg)" };
}

// 结果徽章配色(offer 绿/挂 红/待定 黄)
const RESULT_BADGE: Record<string, { cls: string }> = {
  offer: { cls: "bg-ide-success/20 text-ide-success" },
  挂: { cls: "bg-ide-danger/20 text-ide-danger" },
  待定: { cls: "bg-ide-warning/20 text-ide-warning" },
};

// 结果字符串 → i18n key 映射(用于 resultLabel helper)
const RESULT_LABEL_KEY: Record<string, string> = {
  offer: "experience.result.offer",
  挂: "experience.result.failed",
  待定: "experience.result.pending",
};

function DifficultyStars({ value }: { value: number }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-0.5" title={t("experience.difficultyScore", { value })}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={11}
          className={cn(
            i < value ? "fill-ide-warning text-ide-warning" : "text-ide-border"
          )}
        />
      ))}
    </span>
  );
}

// 多选下拉筛选器
function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  };
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-7 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-xs",
          open ? "border-ide-accent text-ide-fg" : "text-ide-fg-muted hover:text-ide-fg"
        )}
      >
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="bg-ide-accent/20 px-1 text-[10px] text-ide-accent">{selected.length}</span>
        )}
        <ChevronDown size={11} className="opacity-60" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-40 mt-px min-w-[140px] border border-ide-border bg-ide-bg-alt py-1 shadow-xl">
            {options.map((opt) => {
              const checked = selected.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggle(opt)}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1 text-left text-xs hover:bg-ide-bg-active",
                    checked ? "text-ide-accent" : "text-ide-fg-muted"
                  )}
                >
                  <span>{opt}</span>
                  <span className={cn("text-[10px]", checked ? "opacity-100" : "opacity-0")}>✓</span>
                </button>
              );
            })}
            {selected.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="mt-1 w-full border-t border-ide-border px-3 py-1 text-left text-[11px] text-ide-fg-muted hover:text-ide-danger"
              >
                {t("experience.clear")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// 单选下拉筛选器
function SingleSelectFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-7 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-xs",
          open ? "border-ide-accent text-ide-fg" : "text-ide-fg-muted hover:text-ide-fg"
        )}
      >
        <span>{label}: </span>
        <span className={value ? "text-ide-fg" : "text-ide-fg-muted"}>
          {value || t("experience.all")}
        </span>
        <ChevronDown size={11} className="opacity-60" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-40 mt-px min-w-[120px] border border-ide-border bg-ide-bg-alt py-1 shadow-xl">
            <button
              onClick={() => { onChange(""); setOpen(false); }}
              className={cn(
                "flex w-full px-3 py-1 text-left text-xs hover:bg-ide-bg-active",
                !value ? "text-ide-accent" : "text-ide-fg-muted"
              )}
            >
              {t("experience.all")}
            </button>
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                className={cn(
                  "flex w-full px-3 py-1 text-left text-xs hover:bg-ide-bg-active",
                  value === opt ? "text-ide-accent" : "text-ide-fg-muted"
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ExperienceCard({
  exp,
  onClick,
  isCommunity = false,
}: {
  exp: Experience;
  onClick: () => void;
  isCommunity?: boolean;
}) {
  const { t } = useI18n();
  const companyBadge = getCompanyBadge(exp.company);
  const resultBadge = RESULT_BADGE[exp.result] || RESULT_BADGE["待定"];
  const resultLabel = (result: string) => t(RESULT_LABEL_KEY[result] || "experience.result.pending");
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-2 border border-ide-border bg-ide-bg-alt p-3 text-left transition-colors hover:border-ide-accent hover:bg-ide-bg-active"
    >
      {/* 头部:公司徽章 + 岗位 + 轮次 + 社区标识 */}
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 px-1.5 py-0.5 text-[11px] font-bold"
          style={{ background: companyBadge.bg, color: companyBadge.fg }}
        >
          {exp.company}
        </span>
        <span className="text-sm font-semibold text-ide-fg">{exp.position}</span>
        <span className="text-[11px] text-ide-fg-muted">· {exp.round}</span>
        {isCommunity && (
          <span className="shrink-0 border border-ide-accent/40 bg-ide-accent/10 px-1 text-[9px] text-ide-accent">
            {t("experience.community")}
          </span>
        )}
        <span className="ml-auto text-[10px] text-ide-fg-muted">{exp.date}</span>
      </div>

      {/* 难度 + 结果徽章 */}
      <div className="flex items-center gap-2">
        <DifficultyStars value={exp.difficulty} />
        <span className={cn("px-1.5 py-0.5 text-[10px] font-semibold", resultBadge.cls)}>
          {resultLabel(exp.result)}
        </span>
      </div>

      {/* summary */}
      <p className="line-clamp-2 text-xs text-ide-fg-muted">{exp.summary}</p>

      {/* tags */}
      <div className="flex flex-wrap gap-1">
        {exp.tags.map((tag) => (
          <span
            key={tag}
            className="border border-ide-border bg-ide-bg px-1.5 py-0.5 text-[10px] text-ide-fg-muted"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* 底部:时长 + 题数 */}
      <div className="mt-auto flex items-center gap-3 border-t border-ide-border pt-2 text-[10px] text-ide-fg-muted">
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {t("experience.minutes", { n: exp.duration })}
        </span>
        <span>{t("experience.questionsCount", { n: exp.questions.length })}</span>
        <span className="ml-auto text-ide-accent opacity-0 group-hover:opacity-100">{t("experience.view")}</span>
      </div>
    </button>
  );
}

function QuestionListModal({
  exp,
  onClose,
  onSimulate,
  onExport,
}: {
  exp: Experience;
  onClose: () => void;
  onSimulate: (question: string) => void;
  onExport: (exp: Experience) => void;
}) {
  const { t } = useI18n();
  const modalRef = useModalA11y(onClose);
  const resultLabel = (result: string) => t(RESULT_LABEL_KEY[result] || "experience.result.pending");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("questionBank.title")}
        tabIndex={-1}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col border border-ide-border bg-ide-bg-alt shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <header className="flex shrink-0 items-center gap-3 border-b border-ide-border bg-ide-bg px-4 py-3">
          <span
            className="px-2 py-0.5 text-xs font-bold"
            style={{ background: getCompanyBadge(exp.company).bg, color: getCompanyBadge(exp.company).fg }}
          >
            {exp.company}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ide-fg">{exp.position}</span>
              <span className="text-[11px] text-ide-fg-muted">{exp.round}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-ide-fg-muted">
              <DifficultyStars value={exp.difficulty} />
              <span className={cn("px-1 py-0.5 font-semibold", (RESULT_BADGE[exp.result] || RESULT_BADGE["待定"]).cls)}>
                {resultLabel(exp.result)}
              </span>
              <span>· {exp.date}</span>
              <span>· {t("experience.minutes", { n: exp.duration })}</span>
            </div>
          </div>
          <button
            onClick={() => onExport(exp)}
            title={t("experience.exportTip")}
            className="flex h-7 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-[11px] text-ide-fg-muted hover:border-ide-accent hover:text-ide-accent"
          >
            <Download size={12} /> {t("experience.share")}
          </button>
          <button
            onClick={onClose}
            title={t("common.close")}
            className="flex h-7 w-7 items-center justify-center text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg"
          >
            <X size={16} />
          </button>
        </header>

        {/* summary + tags */}
        <div className="shrink-0 border-b border-ide-border bg-ide-bg/40 px-4 py-2">
          <p className="text-xs text-ide-fg">{exp.summary}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {exp.tags.map((tag) => (
              <span
                key={tag}
                className="border border-ide-border bg-ide-bg px-1.5 py-0.5 text-[10px] text-ide-fg-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* 问答列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <ol className="flex flex-col gap-3">
            {exp.questions.map((item, idx) => (
              <li key={idx} className="border-l-2 border-ide-accent bg-ide-bg p-3">
                <div className="mb-2 flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-[10px] font-bold text-ide-fg-muted">
                    Q{idx + 1}
                  </span>
                  <p className="min-w-0 flex-1 text-sm text-ide-fg">{item.q}</p>
                </div>
                {item.a && (
                  <div className="ml-6 border-l border-ide-border pl-3 text-xs leading-relaxed text-ide-fg-muted">
                    <span className="font-semibold text-ide-accent">{t("experience.referenceAnswer")}</span>{" "}
                    {item.a}
                  </div>
                )}
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => onSimulate(item.q)}
                    className="flex items-center gap-1 bg-ide-accent/20 px-2 py-1 text-[11px] text-ide-accent hover:bg-ide-accent/30"
                  >
                    <Play size={10} />
                    {t("experience.simulateThis")}
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* 底部:一键导入 */}
        <footer className="shrink-0 border-t border-ide-border bg-ide-bg px-4 py-2 text-[11px] text-ide-fg-muted">
          {t("experience.modalFooterHint")}
        </footer>
      </div>
    </div>
  );
}

// ===== 题库 Tab 组件 =====

// 难度徽章配色
const Q_DIFFICULTY_BADGE: Record<string, { cls: string }> = {
  junior: { cls: "bg-ide-success/20 text-ide-success" },
  mid:    { cls: "bg-ide-warning/20 text-ide-warning" },
  senior: { cls: "bg-ide-danger/20 text-ide-danger" },
};

// 题型徽章配色
const Q_TYPE_BADGE: Record<string, { cls: string }> = {
  technical:  { cls: "bg-ide-accent/20 text-ide-accent" },
  design:     { cls: "bg-purple-500/20 text-purple-400" },
  behavioral: { cls: "bg-blue-500/20 text-blue-400" },
  coding:     { cls: "bg-emerald-500/20 text-emerald-400" },
  questions:  { cls: "bg-orange-500/20 text-orange-400" },
};

// 行业中文标签查找
function industryLabel(id: string): string {
  return INDUSTRIES.find((i) => i.id === id)?.label || id;
}

// 反向查找:label -> id(用于 SingleSelectFilter,它直接显示 option 字符串)
const INDUSTRY_ID_BY_LABEL: Record<string, string> = Object.fromEntries(INDUSTRIES.map((i) => [i.label, i.id]));
const TYPE_ID_BY_LABEL: Record<string, string> = Object.fromEntries(QUESTION_TYPES.map((tp) => [tp.label, tp.id]));
const DIFFICULTY_ID_BY_LABEL: Record<string, string> = Object.fromEntries(DIFFICULTIES.map((d) => [d.label, d.id]));
function industryLabelToId(label: string): string { return INDUSTRY_ID_BY_LABEL[label] || ""; }
function typeLabelToId(label: string): string { return TYPE_ID_BY_LABEL[label] || ""; }
function difficultyLabelToId(label: string): string { return DIFFICULTY_ID_BY_LABEL[label] || ""; }

// 题目卡片
function QuestionCard({
  q,
  onClick,
}: {
  q: Question;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const diffBadge = Q_DIFFICULTY_BADGE[q.difficulty] || Q_DIFFICULTY_BADGE.junior;
  const typeBadge = Q_TYPE_BADGE[q.type] || Q_TYPE_BADGE.technical;
  const qDifficultyLabel = (id: string) => t("questionBank.difficulty." + id);
  const qTypeLabel = (id: string) => t("questionBank.type." + id);
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-2 border border-ide-border bg-ide-bg-alt p-3 text-left transition-colors hover:border-ide-accent hover:bg-ide-bg-active"
    >
      {/* 头部:行业 + 题型 + 难度 */}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 border border-ide-border bg-ide-bg px-1.5 py-0.5 text-[10px] text-ide-fg-muted">
          {industryLabel(q.industry)}
        </span>
        <span className={cn("shrink-0 px-1.5 py-0.5 text-[10px] font-semibold", typeBadge.cls)}>
          {qTypeLabel(q.type)}
        </span>
        <span className={cn("shrink-0 px-1.5 py-0.5 text-[10px] font-semibold", diffBadge.cls)}>
          {qDifficultyLabel(q.difficulty)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-ide-fg-muted">
          <Timer size={10} /> {q.estimatedMinutes}m
        </span>
      </div>

      {/* 标题 */}
      <h3 className="line-clamp-2 text-sm font-semibold text-ide-fg">{q.title}</h3>

      {/* 内容预览 */}
      <p className="line-clamp-2 text-xs text-ide-fg-muted">{q.content}</p>

      {/* 标签 */}
      {q.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {q.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="border border-ide-border bg-ide-bg px-1.5 py-0.5 text-[10px] text-ide-fg-muted"
            >
              {tag}
            </span>
          ))}
          {q.tags.length > 4 && (
            <span className="text-[10px] text-ide-fg-muted">+{q.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* 底部:关键要点数 + hover 提示 */}
      <div className="mt-auto flex items-center gap-3 border-t border-ide-border pt-2 text-[10px] text-ide-fg-muted">
        <span className="flex items-center gap-1">
          <Lightbulb size={10} />
          {t("experience.keyPointsCount", { n: q.keyPoints.length })}
        </span>
        <span className="ml-auto text-ide-accent opacity-0 group-hover:opacity-100">{t("experience.view")}</span>
      </div>
    </button>
  );
}

// 题目详情弹窗
function QuestionDetailModal({
  q,
  onClose,
  onSimulate,
  t,
}: {
  q: Question;
  onClose: () => void;
  onSimulate: (question: string) => void;
  t: (key: string, vars?: Record<string, any>) => string;
}) {
  const diffBadge = Q_DIFFICULTY_BADGE[q.difficulty] || Q_DIFFICULTY_BADGE.junior;
  const typeBadge = Q_TYPE_BADGE[q.type] || Q_TYPE_BADGE.technical;
  const qDifficultyLabel = (id: string) => t("questionBank.difficulty." + id);
  const qTypeLabel = (id: string) => t("questionBank.type." + id);
  const modalRef = useModalA11y(onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("questionBank.referenceAnswer")}
        tabIndex={-1}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col border border-ide-border bg-ide-bg-alt shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <header className="flex shrink-0 items-center gap-3 border-b border-ide-border bg-ide-bg px-4 py-3">
          <span className="shrink-0 border border-ide-border bg-ide-bg-alt px-2 py-0.5 text-xs text-ide-fg-muted">
            {industryLabel(q.industry)}
          </span>
          <span className={cn("shrink-0 px-1.5 py-0.5 text-[10px] font-semibold", typeBadge.cls)}>
            {qTypeLabel(q.type)}
          </span>
          <span className={cn("shrink-0 px-1.5 py-0.5 text-[10px] font-semibold", diffBadge.cls)}>
            {qDifficultyLabel(q.difficulty)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-ide-fg">{q.title}</h2>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ide-fg-muted">
              <span className="flex items-center gap-1">
                <Timer size={10} /> {t("experience.minutes", { n: q.estimatedMinutes })}
              </span>
              <span>· {q.id}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            title={t("common.close")}
            className="flex h-7 w-7 items-center justify-center text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg"
          >
            <X size={16} />
          </button>
        </header>

        {/* 内容区 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* 题目描述 */}
          <section className="mb-4">
            <h3 className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase text-ide-fg-muted">
              <BookOpen size={12} /> {t("interview.question")}
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ide-fg">{q.content}</p>
          </section>

          {/* 参考答案 */}
          <section className="mb-4">
            <h3 className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase text-ide-fg-muted">
              <CheckCircle2 size={12} className="text-ide-success" /> {t("questionBank.referenceAnswer")}
            </h3>
            <div className="border-l-2 border-ide-success/40 bg-ide-success/5 px-3 py-2">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ide-fg">{q.referenceAnswer}</p>
            </div>
          </section>

          {/* 关键要点 */}
          {q.keyPoints.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase text-ide-fg-muted">
                <Lightbulb size={12} className="text-ide-warning" /> {t("questionBank.keyPoints")}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {q.keyPoints.map((kp, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 border border-ide-border bg-ide-bg px-2 py-1.5 text-xs text-ide-fg"
                  >
                    <span className="mt-0.5 shrink-0 text-[10px] font-bold text-ide-accent">{idx + 1}</span>
                    <span className="min-w-0 flex-1">{kp}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 标签 */}
          {q.tags.length > 0 && (
            <section>
              <h3 className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase text-ide-fg-muted">
                <Tag size={12} /> {t("experience.tags")}
              </h3>
              <div className="flex flex-wrap gap-1">
                {q.tags.map((tag) => (
                  <span
                    key={tag}
                    className="border border-ide-border bg-ide-bg px-1.5 py-0.5 text-[10px] text-ide-fg-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* 底部:模拟此题 */}
        <footer className="shrink-0 border-t border-ide-border bg-ide-bg px-4 py-2">
          <button
            onClick={() => onSimulate(q.title)}
            className="flex items-center gap-1 bg-ide-accent px-3 py-1.5 text-xs text-ide-accent-fg hover:bg-ide-accent-hover"
          >
            <Play size={12} /> {t("experience.simulate")}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function ExperiencePage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  // Tab 切换:面经广场 / 题库
  const [tab, setTab] = useState<"experiences" | "questions">("experiences");

  // ===== 面经广场 state =====
  const [query, setQuery] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [round, setRound] = useState("");
  const [difficulty, setDifficulty] = useState<number | "">("");
  const [result, setResult] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 社区导入:在内存中保存用户从 URL/文件导入的面经(刷新后清空)
  const [communityExps, setCommunityExps] = useState<Experience[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importModalRef = useModalA11y(() => setImportDialogOpen(false), importDialogOpen);

  // 合并内置 + 社区面经
  const allExperiences = useMemo(() => [...communityExps, ...EXPERIENCES], [communityExps]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allExperiences.filter((exp) => {
      if (companies.length && !companies.includes(exp.company)) return false;
      if (positions.length && !positions.includes(exp.position)) return false;
      if (round && exp.round !== round) return false;
      if (difficulty !== "" && exp.difficulty !== difficulty) return false;
      if (result && exp.result !== result) return false;
      if (!q) return true;
      const inTags = exp.tags.some((tg) => tg.toLowerCase().includes(q));
      const inQuestions = exp.questions.some((item) =>
        item.q.toLowerCase().includes(q) || (item.a || "").toLowerCase().includes(q)
      );
      const inSummary = exp.summary.toLowerCase().includes(q);
      const inCompany = exp.company.toLowerCase().includes(q);
      const inPosition = exp.position.toLowerCase().includes(q);
      return inTags || inQuestions || inSummary || inCompany || inPosition;
    });
  }, [query, companies, positions, round, difficulty, result, allExperiences]);

  // ===== 题库 state =====
  const [qQuery, setQQuery] = useState("");
  const [qIndustry, setQIndustry] = useState<string>("");
  const [qType, setQType] = useState<string>("");
  const [qDifficulty, setQDifficulty] = useState<string>("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);

  // 题库筛选:industry/type/difficulty + 关键词搜索(标题/内容/标签/要点)
  const filteredQuestions = useMemo(() => {
    const list = filterQuestions({
      industry: qIndustry || undefined,
      type: qType || undefined,
      difficulty: qDifficulty || undefined,
    });
    const q = qQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => {
      const inTitle = item.title.toLowerCase().includes(q);
      const inContent = item.content.toLowerCase().includes(q);
      const inTags = item.tags.some((tg) => tg.toLowerCase().includes(q));
      const inKeyPoints = item.keyPoints.some((kp) => kp.toLowerCase().includes(q));
      const inAnswer = item.referenceAnswer.toLowerCase().includes(q);
      return inTitle || inContent || inTags || inKeyPoints || inAnswer;
    });
  }, [qQuery, qIndustry, qType, qDifficulty]);

  const selectedQuestion = selectedQuestionId
    ? QUESTION_BANK.find((q) => q.id === selectedQuestionId) || null
    : null;

  const hasQuestionFilters = !!(qQuery || qIndustry || qType || qDifficulty);
  const clearQuestionFilters = () => {
    setQQuery("");
    setQIndustry("");
    setQType("");
    setQDifficulty("");
  };

  const selected = selectedId
    ? allExperiences.find((e) => e.id === selectedId) || null
    : null;

  const handleSimulate = (question: string) => {
    const focus = encodeURIComponent(question);
    navigate(`/interview?focus=${focus}`);
  };

  const handleExport = (exp: Experience) => {
    try {
      const shareable = experienceToShareable(exp);
      const filename = `${exp.company}_${exp.position}_${exp.round}.ix-experience.json`;
      downloadJson(shareable, filename);
    } catch (e: any) {
      setImportError(t("experience.exportFailed", { msg: String(e.message) }));
    }
  };

  const handleCommunityImport = async (rawData: any) => {
    const v = validateExperience(rawData);
    if (!v.valid) throw new Error(v.error || t("experience.invalidExperienceFormat"));
    const newExp = shareableToExperience(rawData as ShareableExperience, communityExps.length);
    setCommunityExps((prev) => [newExp, ...prev]);
    setImportError(null);
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const data = await fetchJsonFromUrl<any>(importUrl.trim());
      await handleCommunityImport(data);
      setImportDialogOpen(false);
      setImportUrl("");
    } catch (e: any) {
      setImportError(t("experience.importFailed", { msg: String(e.message) }));
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const data = await readJsonFile(file);
      await handleCommunityImport(data);
      setImportDialogOpen(false);
    } catch (e: any) {
      setImportError(t("experience.importFailed", { msg: String(e.message) }));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 社区导入的面经 id 前缀,用于卡片显示"社区"标识
  const communityIdSet = useMemo(() => new Set(communityExps.map((e) => e.id)), [communityExps]);

  // 是否有任何筛选条件(用于显示"清空筛选"按钮)
  const hasFilters = !!(query || companies.length || positions.length || round || difficulty !== "" || result);
  const clearFilters = () => {
    setQuery("");
    setCompanies([]);
    setPositions([]);
    setRound("");
    setDifficulty("");
    setResult("");
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ide-bg text-ide-fg">
      {/* 顶部标题栏 + Tab 切换 */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-ide-border bg-ide-bg-alt px-4">
        {/* Tab 按钮 */}
        <div className="flex shrink-0 items-center gap-px border border-ide-border bg-ide-bg">
          <button
            onClick={() => setTab("experiences")}
            className={cn(
              "flex h-8 items-center gap-1 px-3 text-xs font-medium transition-colors",
              tab === "experiences"
                ? "bg-ide-accent text-ide-accent-fg"
                : "text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg"
            )}
          >
            <Newspaper size={13} />
            {t("experience.tabExperiences")}
          </button>
          <button
            onClick={() => setTab("questions")}
            className={cn(
              "flex h-8 items-center gap-1 px-3 text-xs font-medium transition-colors",
              tab === "questions"
                ? "bg-ide-accent text-ide-accent-fg"
                : "text-ide-fg-muted hover:bg-ide-bg-active hover:text-ide-fg"
            )}
          >
            <BookOpen size={13} />
            {t("experience.tabQuestionBank")}
          </button>
        </div>

        {/* 右侧:统计 + 操作(随 tab 切换) */}
        {tab === "experiences" ? (
          <>
            <InfoTip text={t("experience.experiencesTip")} />
            <span className="ml-2 truncate text-[11px] text-ide-fg-muted">
              {t("experience.totalExperiences", { n: allExperiences.length })} · {t("experience.showingCount", { n: filtered.length })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setImportDialogOpen(true)}
                className="flex h-7 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 text-xs text-ide-fg hover:border-ide-accent hover:text-ide-accent"
                title={t("experience.importExpTip")}
              >
                <Link2 size={12} /> {t("experience.importExperience")}
              </button>
            </div>
          </>
        ) : (
          <>
            <InfoTip text={t("experience.questionBankTip")} />
            <span className="ml-2 truncate text-[11px] text-ide-fg-muted">
              {t("experience.questionsCount", { n: QUESTION_BANK.length })} · {t("experience.showingQuestions", { n: filteredQuestions.length })}
            </span>
          </>
        )}
      </header>

      {/* 导入错误提示(仅面经 tab) */}
      {tab === "experiences" && importError && (
        <div className="shrink-0 border-b border-ide-danger/30 bg-ide-danger/10 px-4 py-1.5 text-xs text-ide-danger flex items-center gap-2">
          <span>{importError}</span>
          <button onClick={() => setImportError(null)} className="ml-auto">
            <X size={12} />
          </button>
        </div>
      )}

      {/* ===== 面经广场 Tab ===== */}
      {tab === "experiences" && (
        <>
          {/* 筛选区 */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ide-border bg-ide-bg-alt px-4 py-2">
            <MultiSelectFilter
              label={t("experience.company")}
              options={COMPANIES}
              selected={companies}
              onChange={setCompanies}
            />
            <MultiSelectFilter
              label={t("experience.position")}
              options={POSITIONS}
              selected={positions}
              onChange={setPositions}
            />
            <SingleSelectFilter
              label={t("experience.round")}
              options={ROUNDS}
              value={round}
              onChange={setRound}
            />
            <SingleSelectFilter
              label={t("experience.difficulty")}
              options={["1", "2", "3", "4", "5"]}
              value={difficulty !== "" ? String(difficulty) : ""}
              onChange={(v) => setDifficulty(v === "" ? "" : Number(v))}
            />
            <SingleSelectFilter
              label={t("experience.result")}
              options={RESULTS}
              value={result}
              onChange={setResult}
            />
            <div className="relative ml-auto">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ide-fg-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("experience.searchPlaceholder")}
                className="h-7 w-64 border border-ide-border bg-ide-bg pl-7 pr-2 text-xs text-ide-fg placeholder:text-ide-fg-muted focus:border-ide-accent focus:outline-none"
              />
            </div>
            {hasFilters && (
              <button
                onClick={clearFilters}
                title={t("experience.clearFilterTip")}
                className="flex h-7 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg-muted hover:border-ide-danger hover:text-ide-danger"
              >
                <X size={12} /> {t("experience.clearFilter")}
              </button>
            )}
          </div>

          {/* 卡片网格 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-ide-fg-muted">
                {t("experience.empty")}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((exp) => (
                  <ExperienceCard
                    key={exp.id}
                    exp={exp}
                    onClick={() => setSelectedId(exp.id)}
                    isCommunity={communityIdSet.has(exp.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 社区分享区 */}
          <div className="shrink-0 border-t border-ide-border bg-ide-bg-alt px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-ide-fg-muted">
              <Github size={14} className="text-ide-accent" />
              <span className="font-medium text-ide-fg">{t("experience.openSourceCommunity")}</span>
              <span>·</span>
              <span>{t("experience.communityShareDesc")}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[11px]">
              <a
                href="https://github.com/topics/interviewx-experiences"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ide-accent hover:underline"
              >
                {t("experience.browseCommunityRepo")}
              </a>
              <span className="text-ide-fg-muted">{t("experience.communityFormatHint")}</span>
            </div>
          </div>
        </>
      )}

      {/* ===== 题库 Tab ===== */}
      {tab === "questions" && (
        <>
          {/* 题库筛选区 */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ide-border bg-ide-bg-alt px-4 py-2">
            <SingleSelectFilter
              label={t("experience.industry")}
              options={INDUSTRIES.map((i) => i.label)}
              value={INDUSTRIES.find((i) => i.id === qIndustry)?.label || ""}
              onChange={(label) => setQIndustry(industryLabelToId(label))}
            />
            <SingleSelectFilter
              label={t("experience.type")}
              options={QUESTION_TYPES.map((tp) => tp.label)}
              value={QUESTION_TYPES.find((tp) => tp.id === qType)?.label || ""}
              onChange={(label) => setQType(typeLabelToId(label))}
            />
            <SingleSelectFilter
              label={t("questionBank.difficulty")}
              options={DIFFICULTIES.map((d) => d.label)}
              value={DIFFICULTIES.find((d) => d.id === qDifficulty)?.label || ""}
              onChange={(label) => setQDifficulty(difficultyLabelToId(label))}
            />
            <div className="relative ml-auto">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ide-fg-muted" />
              <input
                type="text"
                value={qQuery}
                onChange={(e) => setQQuery(e.target.value)}
                placeholder={t("experience.searchQuestions")}
                className="h-7 w-72 border border-ide-border bg-ide-bg pl-7 pr-2 text-xs text-ide-fg placeholder:text-ide-fg-muted focus:border-ide-accent focus:outline-none"
              />
            </div>
            {hasQuestionFilters && (
              <button
                onClick={clearQuestionFilters}
                title={t("experience.clearFilter")}
                className="flex h-7 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg-muted hover:border-ide-danger hover:text-ide-danger"
              >
                <X size={12} /> {t("experience.clearFilter")}
              </button>
            )}
          </div>

          {/* 题库卡片网格 */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {filteredQuestions.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-ide-fg-muted">
                {t("experience.noQuestions")}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredQuestions.map((q) => (
                  <QuestionCard
                    key={q.id}
                    q={q}
                    onClick={() => setSelectedQuestionId(q.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* 导入对话框 */}
      {importDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setImportDialogOpen(false)}
        >
          <div
            ref={importModalRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("experience.importCommunityExp")}
            tabIndex={-1}
            className="w-96 border border-ide-border bg-ide-bg-alt shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-10 items-center justify-between border-b border-ide-border px-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-ide-fg">
                <Link2 size={14} className="text-ide-accent" /> {t("experience.importCommunityExp")}
              </div>
              <button onClick={() => setImportDialogOpen(false)} className="text-ide-fg-muted hover:text-ide-fg">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3 p-4">
              {importError && (
                <div className="border border-ide-danger/40 bg-ide-danger/10 px-2 py-1.5 text-[11px] text-ide-danger">
                  {importError}
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-ide-fg-muted">{t("experience.importFromUrl")}</label>
                <input
                  type="text"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://github.com/user/repo/blob/main/exp.json"
                  className="h-8 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg placeholder:text-ide-fg-muted focus:border-ide-accent focus:outline-none"
                />
              </div>
              <button
                onClick={handleImportUrl}
                disabled={importing || !importUrl.trim()}
                className="flex h-8 w-full items-center justify-center gap-1 bg-ide-accent text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
              >
                <Link2 size={12} />
                {importing ? t("experience.importing") : t("experience.importFromUrl")}
              </button>
              <div className="flex items-center gap-2 text-[11px] text-ide-fg-muted">
                <div className="h-px flex-1 bg-ide-border" />
                {t("experience.or")}
                <div className="h-px flex-1 bg-ide-border" />
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="flex h-8 w-full items-center justify-center gap-1 border border-ide-border bg-ide-bg text-xs text-ide-fg hover:border-ide-accent hover:text-ide-accent disabled:opacity-50"
              >
                {t("experience.selectLocalFile")}
              </button>
              <div className="text-[10px] text-ide-fg-muted">
                {t("experience.importHint")}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 面经问答弹窗 */}
      {tab === "experiences" && selected && (
        <QuestionListModal
          exp={selected}
          onClose={() => setSelectedId(null)}
          onSimulate={handleSimulate}
          onExport={handleExport}
        />
      )}

      {/* 题库详情弹窗 */}
      {tab === "questions" && selectedQuestion && (
        <QuestionDetailModal
          q={selectedQuestion}
          onClose={() => setSelectedQuestionId(null)}
          onSimulate={handleSimulate}
          t={t}
        />
      )}
    </div>
  );
}
