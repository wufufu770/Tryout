// 面试报告多格式导出:Markdown / JSON / PDF(打印)
// 仅使用浏览器原生 API,不引入额外依赖。
import { toastWarning } from "@/shared";

interface ExportMessage {
  role: string;
  content: string;
  agentName?: string;
  createdAt?: string;
  stage?: number;
}

interface ExportEvaluation {
  overallScore: number;
  report?: string;
  improvementAdvice?: string;
  betterAnswerSample?: string;
  dimensions?: { dimensionName: string; score: number; comment?: string }[];
  generatedAt?: string;
}

interface ExportSession {
  title: string;
  difficulty?: string;
  flowTemplate?: string;
  createdAt?: string;
}

function formatTimeSafe(ts?: string): string {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "interviewx-report"
  );
}

// 通过 Blob + 临时 a 标签触发下载
function triggerDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 释放 URL
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safe(s: unknown): string {
  if (s == null) return "-";
  return String(s);
}

// ============ Markdown ============

export function exportSessionAsMarkdown(
  session: ExportSession,
  messages: ExportMessage[],
  evaluations: ExportEvaluation[]
): string {
  const lines: string[] = [];
  const title = session?.title || "面试会话";

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- 难度: ${safe(session?.difficulty)}`);
  lines.push(`- 流程: ${safe(session?.flowTemplate)}`);
  lines.push(`- 创建时间: ${formatTimeSafe(session?.createdAt)}`);
  lines.push("");

  // 消息记录
  lines.push("## 对话记录");
  lines.push("");
  for (const m of messages || []) {
    const time = m.createdAt ? ` _${formatTimeSafe(m.createdAt)}_` : "";
    if (m.role === "user") {
      lines.push(`> **用户**${time}:`);
      lines.push(`> ${m.content.split("\n").join("\n> ")}`);
      lines.push("");
    } else if (m.role === "assistant" || m.role === "system") {
      const speaker = m.agentName || (m.role === "system" ? "系统" : "面试官");
      lines.push(`● **${speaker}**${time}:`);
      lines.push(m.content);
      lines.push("");
    } else {
      lines.push(`● **${m.role}**${time}:`);
      lines.push(m.content);
      lines.push("");
    }
  }

  // 评估报告
  lines.push("## 评估报告");
  lines.push("");
  if (!evaluations || evaluations.length === 0) {
    lines.push("_暂无评估_");
    lines.push("");
  } else {
    evaluations.forEach((ev, i) => {
      lines.push(`### 评估 ${i + 1}`);
      lines.push(`- 综合评分: ${safe(ev.overallScore)}`);
      lines.push(`- 生成时间: ${formatTimeSafe(ev.generatedAt)}`);
      lines.push("");
      if (ev.dimensions && ev.dimensions.length > 0) {
        lines.push("**维度评分:**");
        lines.push("");
        lines.push("| 维度 | 分数 | 备注 |");
        lines.push("| --- | --- | --- |");
        for (const d of ev.dimensions) {
          const comment = (d.comment || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
          lines.push(`| ${d.dimensionName} | ${safe(d.score)} | ${comment} |`);
        }
        lines.push("");
      }
      if (ev.report) {
        lines.push("**报告:**");
        lines.push("");
        lines.push(ev.report);
        lines.push("");
      }
      if (ev.improvementAdvice) {
        lines.push("**改进建议:**");
        lines.push("");
        lines.push(ev.improvementAdvice);
        lines.push("");
      }
      if (ev.betterAnswerSample) {
        lines.push("");
        lines.push("**优化回答示例:**");
        lines.push(ev.betterAnswerSample);
      }
    });
  }

  const md = lines.join("\n");
  triggerDownload(md, `${sanitizeFileName(title)}.md`, "text/markdown;charset=utf-8");
  return md;
}

// ============ JSON ============

export function exportSessionAsJSON(
  session: ExportSession,
  messages: ExportMessage[],
  evaluations: ExportEvaluation[]
): string {
  const payload = {
    session,
    messages,
    evaluations,
    exportedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(payload, null, 2);
  const title = session?.title || "session";
  triggerDownload(json, `${sanitizeFileName(title)}.json`, "application/json;charset=utf-8");
  return json;
}

// ============ PDF(打印) ============

export function exportSessionAsPDF(
  session: ExportSession,
  messages: ExportMessage[],
  evaluations: ExportEvaluation[]
): void {
  const title = session?.title || "面试会话";

  const escapeHtml = (s: unknown): string => {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const messageHtml = (messages || [])
    .map((m) => {
      const time = m.createdAt ? ` <span class="time">${escapeHtml(formatTimeSafe(m.createdAt))}</span>` : "";
      if (m.role === "user") {
        return `<div class="msg user"><div class="meta"><span class="badge user-badge">用户</span>${time}</div><div class="content">${escapeHtml(m.content)}</div></div>`;
      }
      const speaker = m.agentName || (m.role === "system" ? "系统" : "面试官");
      return `<div class="msg ai"><div class="meta"><span class="badge ai-badge">● ${escapeHtml(speaker)}</span>${time}</div><div class="content">${escapeHtml(m.content)}</div></div>`;
    })
    .join("\n");

  const evalHtml = (evaluations || [])
    .map((ev, i) => {
      const dims =
        ev.dimensions && ev.dimensions.length > 0
          ? `<table class="dims"><thead><tr><th>维度</th><th>分数</th><th>备注</th></tr></thead><tbody>${ev.dimensions
              .map(
                (d) =>
                  `<tr><td>${escapeHtml(d.dimensionName)}</td><td class="score">${escapeHtml(d.score)}</td><td>${escapeHtml(d.comment || "")}</td></tr>`
              )
              .join("")}</tbody></table>`
          : "";
      return `<div class="eval">
        <div class="eval-head"><span>评估 ${i + 1}</span><span class="score-big">综合评分: ${escapeHtml(ev.overallScore)}</span></div>
        <div class="eval-time">生成时间: ${escapeHtml(formatTimeSafe(ev.generatedAt))}</div>
        ${dims}
        ${ev.report ? `<div class="section"><div class="section-title">报告</div><div class="section-body">${escapeHtml(ev.report)}</div></div>` : ""}
        ${ev.improvementAdvice ? `<div class="section"><div class="section-title">改进建议</div><div class="section-body advice">${escapeHtml(ev.improvementAdvice)}</div></div>` : ""}
        ${ev.betterAnswerSample ? `<div class="section"><div class="section-title">优化回答示例</div><div class="section-body">${escapeHtml(ev.betterAnswerSample)}</div></div>` : ""}
      </div>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} - 面试报告</title>
<style>
  :root {
    --ide-bg: #1e1e1e;
    --ide-bg-alt: #252526;
    --ide-border: #3c3c3c;
    --ide-fg: #d4d4d4;
    --ide-fg-muted: #9d9d9d;
    --ide-accent: #4f9eff;
    --ide-success: #4ec9b0;
    --ide-danger: #f48771;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--ide-bg);
    color: var(--ide-fg);
    font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, "Courier New", monospace;
    font-size: 12px;
    line-height: 1.55;
  }
  .container { padding: 24px 32px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 8px 0; color: var(--ide-fg); border-bottom: 1px solid var(--ide-border); padding-bottom: 8px; }
  .meta { color: var(--ide-fg-muted); margin-bottom: 20px; font-size: 11px; }
  .meta div { margin: 2px 0; }
  h2 { font-size: 15px; color: var(--ide-accent); margin: 24px 0 10px 0; border-left: 3px solid var(--ide-accent); padding-left: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .msg { margin: 10px 0; padding: 8px 10px; border: 1px solid var(--ide-border); background: var(--ide-bg-alt); border-radius: 2px; }
  .msg.user { border-left: 3px solid var(--ide-accent); }
  .msg.ai { border-left: 3px solid var(--ide-success); }
  .meta { color: var(--ide-fg-muted); font-size: 10px; margin-bottom: 4px; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 2px; font-weight: 600; }
  .user-badge { background: rgba(79, 158, 255, 0.2); color: var(--ide-accent); }
  .ai-badge { background: rgba(78, 201, 176, 0.2); color: var(--ide-success); }
  .time { margin-left: 6px; }
  .content { white-space: pre-wrap; word-break: break-word; }
  .eval { margin: 14px 0; padding: 12px; border: 1px solid var(--ide-border); background: var(--ide-bg-alt); }
  .eval-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: 600; }
  .score-big { color: var(--ide-accent); font-family: inherit; }
  .eval-time { color: var(--ide-fg-muted); font-size: 10px; margin-bottom: 8px; }
  .dims { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 11px; }
  .dims th, .dims td { border: 1px solid var(--ide-border); padding: 4px 8px; text-align: left; }
  .dims th { background: var(--ide-bg); color: var(--ide-fg-muted); }
  .dims .score { color: var(--ide-accent); text-align: center; }
  .section { margin-top: 8px; }
  .section-title { color: var(--ide-fg-muted); font-size: 10px; text-transform: uppercase; margin-bottom: 3px; }
  .section-body { white-space: pre-wrap; word-break: break-word; }
  .section-body.advice { color: var(--ide-success); }
  .empty { color: var(--ide-fg-muted); font-style: italic; padding: 8px 0; }
  @media print {
    @page { margin: 12mm; }
    body { background: #fff; color: #000; }
    .msg, .eval { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="container">
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <div>难度: ${escapeHtml(session?.difficulty)}</div>
    <div>流程: ${escapeHtml(session?.flowTemplate)}</div>
    <div>创建时间: ${escapeHtml(formatTimeSafe(session?.createdAt))}</div>
  </div>

  <h2>对话记录</h2>
  ${messages && messages.length > 0 ? messageHtml : '<div class="empty">暂无消息</div>'}

  <h2>评估报告</h2>
  ${evaluations && evaluations.length > 0 ? evalHtml : '<div class="empty">暂无评估</div>'}
</div>
<script>
  window.onload = function () {
    setTimeout(function () { window.print(); }, 300);
  };
</script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    // 弹窗被拦截时提示用户允许弹窗后重试
    toastWarning("PDF 导出需要允许弹窗,请在浏览器地址栏允许本站弹窗后重试");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
