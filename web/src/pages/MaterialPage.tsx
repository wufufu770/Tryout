import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { cn, formatTime } from "@/shared";
import { useSessionStore } from "@/stores/sessionStore";
import { InfoTip } from "@/components/InfoTip";
import { Upload, Clipboard, Trash2, FileText, File as FileIcon, Plus, Check, Briefcase, Sparkles, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { parseResume, generateJDPrompt, parseJDMatchResult, type StructuredResume, type JDMatchResult } from "@/lib/resumeParser";
import { computeMatchScore, describeMatchQuality, type MatchResult as ScoreResult } from "@/lib/matchScore";
import { useI18n } from "@/i18n";

interface MaterialPageItem {
  materialId: string;
  title: string;
  type?: string;
  size?: number;
  addedAt?: string;
  createdAt?: string;
  content?: string;
  rawText?: string;
}

const TYPE_ICON: Record<string, typeof FileText> = {
  text: FileText,
  markdown: FileText,
  pdf: FileText,
  docx: FileText,
  doc: FileText,
  file: FileIcon,
};

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  pdf: { label: "PDF", className: "text-red-400" },
  docx: { label: "DOCX", className: "text-blue-400" },
  doc: { label: "DOC", className: "text-blue-400" },
  txt: { label: "TXT", className: "text-green-400" },
  text: { label: "TXT", className: "text-green-400" },
  md: { label: "MD", className: "text-purple-400" },
  markdown: { label: "MD", className: "text-purple-400" },
  json: { label: "JSON", className: "text-yellow-400" },
  csv: { label: "CSV", className: "text-orange-400" },
};

function getTypeBadge(type?: string) {
  if (!type) return { label: "FILE", className: "text-ide-fg-muted" };
  return TYPE_BADGE[type.toLowerCase()] || { label: type.toUpperCase(), className: "text-ide-fg-muted" };
}

export function MaterialPage() {
  const { t } = useI18n();
  const [materials, setMaterials] = useState<MaterialPageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [uploadInfo, setUploadInfo] = useState<{ name: string; charCount: number } | null>(null);
  const [addedToInterview, setAddedToInterview] = useState(false);

  // 简历解析状态
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText] = useState("");
  const [parsedResume, setParsedResume] = useState<StructuredResume | null>(null);
  const [matchResult, setMatchResult] = useState<JDMatchResult | null>(null);
  // R21:匹配度可能"无法计算"(简历技能为 0 条)—— 那不是 0 分
  const [matchScore, setMatchScore] = useState<ScoreResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeCollapsed, setResumeCollapsed] = useState(true);

  const addMaterialToInterview = useSessionStore((s) => s.addMaterial);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // v10.2.6(D5):"已添加到面试"提示定时器,组件卸载时清理
  const addedTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (addedTimerRef.current) clearTimeout(addedTimerRef.current); }, []);

  const loadMaterials = useCallback(async () => {
    try {
      const list = (await api.listMaterials()) || [];
      setMaterials(list as MaterialPageItem[]);
      if (list.length > 0 && !selectedId) setSelectedId(list[0].materialId);
    } catch (e: any) {
      setError(t("material.loadFailed", { msg: String(e.message) }));
    }
  }, [selectedId]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

  // 加载选中资料正文
  useEffect(() => {
    if (!selectedId) {
      setContent("");
      return;
    }
    setLoading(true);
    api
      .getMaterialContent(selectedId)
      .then((resp: any) => {
        setContent(typeof resp === "string" ? resp : resp?.rawText || resp?.content || "");
      })
      .catch((e: any) => setError(t("material.loadContentFailed", { msg: String(e.message) })))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadInfo(null);

    // 校验文件类型
    const ext = file.name.toLowerCase().split(".").pop() || "";
    if (!["txt", "md", "pdf", "docx", "doc", "json", "csv"].includes(ext)) {
      setError(t("material.unsupportedFileType"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    // 校验大小
    if (file.size > 20 * 1024 * 1024) {
      setError(t("material.fileSizeExceeded"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setLoading(true);
    try {
      const uploadType = ext;
      const result: any = await api.uploadFile(file, uploadType);
      // result 返回 { rawText, title, type, sourceType }
      const rawText = result?.rawText ?? result?.content ?? "";
      const title = result?.title || file.name;
      const type = result?.type || uploadType;
      // 入库
      const created: any = await api.createMaterial({
        title,
        rawText,
        type,
        sourceType: "file",
      });
      await loadMaterials();
      if (created?.materialId) setSelectedId(created.materialId);
      setUploadInfo({ name: file.name, charCount: rawText.length });
    } catch (err: any) {
      setError(t("material.uploadFailed", { msg: String(err.message) }));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePasteSubmit = async () => {
    if (!pasteText.trim()) {
      setError(t("material.contentRequired"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result: any = await api.createMaterial({
        title: pasteTitle || t("material.pasteTextDefault"),
        rawText: pasteText,
        type: "text",
        // 粘贴文本归一为 "text" 来源(MaterialSourceType = "file" | "text" | "url")
        sourceType: "text",
      });
      setUploadInfo({ name: pasteTitle || t("material.pasteTextDefault"), charCount: pasteText.length });
      setPasteText("");
      setPasteTitle("");
      setShowPaste(false);
      await loadMaterials();
      if (result?.materialId) setSelectedId(result.materialId);
    } catch (err: any) {
      setError(t("material.createFailed", { msg: String(err.message) }));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("material.deleteConfirm"))) return;
    setError(null);
    try {
      await api.deleteMaterial(id);
      if (selectedId === id) {
        setSelectedId("");
        setContent("");
      }
      await loadMaterials();
    } catch (e: any) {
      setError(t("material.deleteFailed", { msg: String(e.message) }));
    }
  };

  const handleAddToInterview = () => {
    if (!selected) return;
    addMaterialToInterview({
      id: selected.materialId,
      type: selected.type || "text",
      title: selected.title,
      content,
    });
    setAddedToInterview(true);
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = window.setTimeout(() => setAddedToInterview(false), 2000);
  };

  const handleAnalyzeMatch = async () => {
    setResumeError(null);
    if (!resumeText.trim()) {
      setResumeError(t("material.noResume"));
      return;
    }
    if (!jdText.trim()) {
      setResumeError(t("material.noJD"));
      return;
    }
    setAnalyzing(true);
    try {
      const parsed = parseResume(resumeText);
      setParsedResume(parsed);

      // 基础技能匹配(不依赖 LLM)
      const jdLower = jdText.toLowerCase();
      const resumeSkillLower = new Set(parsed.skills.map((s) => s.toLowerCase()));
      const matchedSkills = parsed.skills.filter((s) => jdLower.includes(s.toLowerCase()));
      const jdTokens = Array.from(
        new Set(
          jdText
            .split(/[\s,，、/()\n;；|·\[\]{}:：]+/)
            .map((s) => s.trim())
            .filter((s) => /^[a-zA-Z\u4e00-\u9fa5][\w.+#\-\u4e00-\u9fa5]{1,29}$/.test(s))
        )
      );
      const missingSkills = jdTokens
        .filter((tok) => !resumeSkillLower.has(tok.toLowerCase()))
        .slice(0, 12);
      /*
       * R21:此前是 `skills.length ? round(...) : 0` —— 解析失败时给 0 分,
       * 用户会以为是自己能力差。改为返回 null 并在 UI 上明确说明"无法计算"。
       */
      const scoreResult = computeMatchScore({
        skills: parsed.skills,
        matchedSkills,
        jdEmpty: !jdText.trim(),
      });
      setMatchScore(scoreResult);
      const baseScore = scoreResult.score ?? 0;
      setMatchResult({
        matchScore: baseScore,
        matchedSkills,
        missingSkills,
        strengths: [],
        weaknesses: [],
        suggestedQuestions: [],
        advice: "",
      });

      // 若有可用 provider,调用 LLM 深化匹配
      try {
        const providers = await api.listProviders();
        const providerId = providers[0]?.id;
        if (providerId) {
          const prompt = generateJDPrompt(parsed, jdText);
          let acc = "";
          const result: any = await api.chat(
            providerId,
            { messages: [{ role: "user", content: prompt }] },
            (tk) => {
              acc += tk;
            }
          );
          const text = result?.content || acc;
          const match = parseJDMatchResult(text);
          if (match) setMatchResult(match);
        }
      } catch {
        // LLM 失败时保留基础匹配结果
      }
    } catch (e: any) {
      setResumeError(`${t("material.parseError")}: ${e?.message || ""}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const selected = materials.find((m) => m.materialId === selectedId);

  return (
    <div className="flex min-h-0 flex-col flex-1">
      <div className="flex min-h-0 flex-1">
      {/* 左栏 资料列表 */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-ide-border bg-ide-bg-alt">
        <div className="border-b border-ide-border px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase text-ide-fg-muted">
            {t("material.title")}
            <InfoTip text={t("material.tip")} />
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              title={t("material.uploadTip")}
              className="flex h-7 flex-1 items-center justify-center gap-1 bg-ide-accent text-[11px] text-ide-accent-fg hover:bg-ide-accent-hover"
            >
              <Upload size={12} /> {t("material.upload")}
            </button>
            <button
              onClick={() => setShowPaste((v) => !v)}
              title={t("material.pasteTip")}
              className={cn(
                "flex h-7 flex-1 items-center justify-center gap-1 border text-[11px]",
                showPaste
                  ? "border-ide-accent bg-ide-accent/10 text-ide-accent"
                  : "border-ide-border bg-ide-bg text-ide-fg hover:border-ide-accent hover:text-ide-accent"
              )}
            >
              <Clipboard size={12} /> {t("material.paste")}
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
          accept=".txt,.md,.pdf,.docx,.doc,.json,.csv"
        />

        {showPaste && (
          <div className="flex flex-col gap-2 border-b border-ide-border p-2">
            <input
              type="text"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder={t("material.pasteTitlePlaceholder")}
              className="h-7 w-full border border-ide-border bg-ide-bg px-2 text-xs text-ide-fg outline-none focus:border-ide-accent"
            />
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={t("material.pasteContentPlaceholder")}
              rows={4}
              className="w-full resize-none border border-ide-border bg-ide-bg px-2 py-1 text-xs text-ide-fg outline-none focus:border-ide-accent"
            />
            <button
              onClick={handlePasteSubmit}
              disabled={loading}
              className="h-6 bg-ide-accent px-2 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
            >
              {t("common.save")}
            </button>
          </div>
        )}

        {/* 上传成功提示 */}
        {uploadInfo && (
          <div className="border-b border-ide-success/30 bg-ide-success/10 px-2 py-1.5 text-[11px] text-ide-success">
            <div className="flex items-center gap-1">
              <Check size={11} />
              <span className="truncate">{uploadInfo.name}</span>
            </div>
            <div className="mt-0.5 opacity-80">{t("material.uploadSuccess", { n: uploadInfo.charCount.toLocaleString() })}</div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {materials.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-ide-fg-muted">{t("material.empty")}</div>
          )}
          <ul className="flex flex-col gap-1">
            {materials.map((m) => {
              const Icon = TYPE_ICON[m.type?.toLowerCase() || "file"] || FileIcon;
              const badge = getTypeBadge(m.type);
              const timeStr = m.addedAt || m.createdAt;
              return (
                <li
                  key={m.materialId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(m.materialId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(m.materialId);
                    }
                  }}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ide-accent",
                    m.materialId === selectedId
                      ? "bg-ide-bg-active text-ide-fg"
                      : "hover:bg-ide-bg-active text-ide-fg-muted"
                  )}
                >
                  <Icon size={14} className={badge.className} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-ide-fg">{m.title}</span>
                      <span className={cn("shrink-0 text-[9px] font-bold", badge.className)}>
                        {badge.label}
                      </span>
                    </div>
                    {timeStr && (
                      <div className="text-[10px] text-ide-fg-muted">{formatTime(timeStr)}</div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(m.materialId);
                    }}
                    title={t("material.deleteTip")}
                    className="flex h-5 w-5 items-center justify-center text-ide-danger opacity-0 hover:bg-ide-bg group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      {/* 右栏 资料正文 */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-ide-border bg-ide-bg-alt px-3 text-xs">
          <div className="flex items-center gap-2 truncate text-ide-fg">
            {selected && (
              <span className={cn("font-bold text-[10px]", getTypeBadge(selected.type).className)}>
                {getTypeBadge(selected.type).label}
              </span>
            )}
            <span className="truncate">{selected?.title || t("material.notSelected")}</span>
          </div>
          <div className="flex items-center gap-2">
            {selected?.type && (
              <span className="text-ide-fg-muted">{t("material.typeLabel")} {selected.type}</span>
            )}
            {selected && (
              <button
                onClick={handleAddToInterview}
                title={t("material.addToInterviewTip")}
                className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 text-xs",
                  addedToInterview
                    ? "bg-ide-success/20 text-ide-success"
                    : "bg-ide-accent/20 text-ide-accent hover:bg-ide-accent/30"
                )}
              >
                {addedToInterview ? <Check size={12} /> : <Plus size={12} />}
                {addedToInterview ? t("material.added") : t("material.addToInterview")}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div role="alert" className="border-b border-ide-danger/30 bg-ide-danger/10 px-3 py-2 text-xs text-ide-danger">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto bg-ide-bg p-4">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-ide-fg-muted">
              <p className="text-sm">{t("material.selectPrompt")}</p>
            </div>
          ) : loading ? (
            <div className="text-ide-fg-muted">{t("common.loading")}</div>
          ) : (
            <div className="flex h-full flex-col">
              {content && (
                <div className="mb-2 text-[11px] text-ide-fg-muted">
                  {t("material.charCount", { n: content.length.toLocaleString() })}
                </div>
              )}
              <pre className="editable flex-1 whitespace-pre-wrap break-words font-sans text-sm text-ide-fg">
                {content || t("material.emptyContent")}
              </pre>
            </div>
          )}
        </div>
      </section>
      </div>

      {/* 简历解析面板 */}
      <div className="shrink-0 border-t border-ide-border bg-ide-bg-alt">
        <button
          onClick={() => setResumeCollapsed((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase text-ide-fg-muted hover:bg-ide-bg-active"
        >
          {resumeCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <FileText size={14} className="text-ide-accent" />
          {t("material.resumeSection")}
        </button>
        {!resumeCollapsed && (
          <div className="max-h-[55vh] overflow-y-auto border-t border-ide-border p-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <label className="text-[11px] font-medium text-ide-fg-muted">{t("material.pasteResume")}</label>
                <textarea
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder={t("material.pasteResume")}
                  rows={6}
                  className="w-full resize-y border border-ide-border bg-ide-bg px-2 py-1 text-xs text-ide-fg outline-none focus:border-ide-accent"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label className="text-[11px] font-medium text-ide-fg-muted">{t("material.pasteJD")}</label>
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  placeholder={t("material.pasteJD")}
                  rows={6}
                  className="w-full resize-y border border-ide-border bg-ide-bg px-2 py-1 text-xs text-ide-fg outline-none focus:border-ide-accent"
                />
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={handleAnalyzeMatch}
                disabled={analyzing}
                className="flex h-7 items-center gap-1 bg-ide-accent px-3 text-xs text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
              >
                <Sparkles size={12} />
                {analyzing ? t("material.analyzing") : t("material.analyzeMatch")}
              </button>
              {analyzing && <span className="text-[11px] text-ide-fg-muted">{t("common.loading")}</span>}
            </div>

            {resumeError && (
              <div
                role="alert"
                className="mt-2 flex items-center gap-1 border border-ide-danger/30 bg-ide-danger/10 px-2 py-1 text-[11px] text-ide-danger"
              >
                <AlertCircle size={12} className="shrink-0" />
                <span className="truncate">{resumeError}</span>
              </div>
            )}

            {(parsedResume || matchResult) && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {parsedResume && (
                  <div className="min-w-0 border border-ide-border bg-ide-bg p-2">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-ide-fg">
                      <FileText size={12} className="text-ide-accent" />
                      {t("material.parsedResume")}
                    </div>
                    {/* R21:把"没解析出来"显式告诉用户。
                        此前这些缺口是静默的 —— 界面只显示解析到的部分,
                        用户以为"简历里就没有这些信息",实际是解析器没读出来。 */}
                    {parsedResume.parseGaps && parsedResume.parseGaps.length > 0 && (
                      <div className="mb-1.5 border-l-2 border-ide-warning bg-ide-warning/5 px-2 py-1 text-[10px] leading-relaxed text-ide-fg-muted">
                        {t("material.parseGaps", { fields: parsedResume.parseGaps.join("、") })}
                      </div>
                    )}
                    <dl className="flex flex-col gap-1 text-[11px]">
                      {parsedResume.name && (
                        <div className="flex gap-1">
                          <dt className="text-ide-fg-muted">{t("material.resumeName")}:</dt>
                          <dd className="truncate text-ide-fg">{parsedResume.name}</dd>
                        </div>
                      )}
                      {parsedResume.phone && (
                        <div className="flex gap-1">
                          <dt className="text-ide-fg-muted">{t("material.resumePhone")}:</dt>
                          <dd className="truncate text-ide-fg">{parsedResume.phone}</dd>
                        </div>
                      )}
                      {parsedResume.email && (
                        <div className="flex gap-1">
                          <dt className="text-ide-fg-muted">{t("material.resumeEmail")}:</dt>
                          <dd className="truncate text-ide-fg">{parsedResume.email}</dd>
                        </div>
                      )}
                      {parsedResume.education.length > 0 && (
                        <div className="flex gap-1">
                          <dt className="shrink-0 text-ide-fg-muted">{t("material.resumeEducation")}:</dt>
                          <dd className="min-w-0 truncate text-ide-fg">
                            {parsedResume.education
                              .map((e) => `${e.school || ""}${e.period ? ` (${e.period})` : ""}`.trim())
                              .join("; ")}
                          </dd>
                        </div>
                      )}
                      {parsedResume.experience.length > 0 && (
                        <div className="flex gap-1">
                          <dt className="shrink-0 text-ide-fg-muted">{t("material.resumeExperience")}:</dt>
                          <dd className="min-w-0 truncate text-ide-fg">
                            {parsedResume.experience
                              .map((e) => `${e.company || ""} ${e.role || ""}`.trim())
                              .join("; ")}
                          </dd>
                        </div>
                      )}
                      {parsedResume.skills.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <dt className="text-ide-fg-muted">{t("material.resumeSkills")}:</dt>
                          <dd className="flex flex-wrap gap-1">
                            {parsedResume.skills.map((s) => (
                              <span
                                key={s}
                                className="border border-ide-border bg-ide-bg px-1.5 py-0.5 text-[10px] text-ide-fg"
                              >
                                {s}
                              </span>
                            ))}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}

                {matchResult && (
                  <div className="min-w-0 border border-ide-border bg-ide-bg p-2">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-ide-fg">
                      <Briefcase size={12} className="text-ide-accent" />
                      {t("material.matchResult")}
                      {/*
                        R21:分数为 null 时**不能显示 0**。
                        0 分 = "我读懂了,你不匹配"(结论);
                        无法计算 = "我没读懂"(失败)。两者含义完全不同,
                        混淆会让用户误判自己的能力。
                      */}
                      {matchScore?.score === null || matchScore?.score === undefined ? (
                        <span
                          className="ml-auto rounded bg-ide-warning/20 px-1.5 py-0.5 text-[10px] font-bold text-ide-warning"
                          title={t("material.matchUnavailableHint")}
                        >
                          {t("material.matchUnavailable")}
                        </span>
                      ) : (
                        <span className="ml-auto rounded bg-ide-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-ide-accent">
                          {matchScore.score}
                        </span>
                      )}
                    </div>
                    {(matchScore?.score === null || matchScore?.score === undefined) && (
                      <div className="mb-1.5 border-l-2 border-ide-warning bg-ide-warning/5 px-2 py-1 text-[10px] leading-relaxed text-ide-fg-muted">
                        {matchScore?.reason === "emptyJd"
                          ? t("material.matchFailEmptyJd")
                          : t("material.matchFailNoSkills")}
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5 text-[11px]">
                      {matchResult.matchedSkills.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1 text-ide-success">
                            <CheckCircle2 size={11} />
                            {t("material.matchedSkills")}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {matchResult.matchedSkills.map((s) => (
                              <span
                                key={s}
                                className="border border-ide-success/40 bg-ide-success/10 px-1.5 py-0.5 text-[10px] text-ide-success"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {matchResult.missingSkills.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1 text-ide-danger">
                            <AlertCircle size={11} />
                            {t("material.missingSkills")}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {matchResult.missingSkills.map((s) => (
                              <span
                                key={s}
                                className="border border-ide-danger/40 bg-ide-danger/10 px-1.5 py-0.5 text-[10px] text-ide-danger"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {matchResult.strengths.length > 0 && (
                        <div>
                          <div className="text-ide-fg-muted">{t("material.strengths")}</div>
                          <ul className="list-disc pl-4 text-ide-fg">
                            {matchResult.strengths.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {matchResult.weaknesses.length > 0 && (
                        <div>
                          <div className="text-ide-fg-muted">{t("material.weaknesses")}</div>
                          <ul className="list-disc pl-4 text-ide-fg">
                            {matchResult.weaknesses.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {matchResult.advice && (
                        <div>
                          <div className="text-ide-fg-muted">{t("material.advice")}</div>
                          <p className="text-ide-fg">{matchResult.advice}</p>
                        </div>
                      )}
                      {matchResult.suggestedQuestions.length > 0 && (
                        <div>
                          <div className="text-ide-fg-muted">{t("material.suggestedInterviewQuestions")}</div>
                          <ul className="list-disc pl-4 text-ide-fg">
                            {matchResult.suggestedQuestions.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
