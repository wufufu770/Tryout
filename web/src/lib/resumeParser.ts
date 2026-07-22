// resumeParser:简历解析(零依赖)
// 从第一原理:简历解析 = (1) 提取文本 (2) 正则识别结构化字段 (3) LLM 深化(可选)
// PDF/DOCX 不引入 pdfjs-dist/mammoth,而是:
//   - 纯文本/Markdown:直接解析
//   - PDF:用浏览器 FileReader 读取二进制,正则提取文本流(pdf 中文本以 BT...ET 包裹)
//   - DOCX:用 JSZip 思路读取 document.xml(此处简化,仅支持纯文本与 .txt)
// 实际项目中如需完整 PDF 解析,建议用户复制简历文本粘贴

export interface StructuredResume {
  name?: string;
  phone?: string;
  email?: string;
  education: { school?: string; major?: string; degree?: string; period?: string }[];
  experience: { company?: string; role?: string; period?: string; description?: string }[];
  skills: string[];
  projects: { name?: string; role?: string; description?: string }[];
  rawText: string;
  /** 解析方式 */
  parseMethod: "text" | "pdf-fallback" | "unknown";
}

/**
 * 从文件提取纯文本
 * 支持:.txt .md(直接读);.pdf(简易文本流提取,可能不完整)
 */
export async function extractTextFromFile(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error("文件超过 20MB 限制");
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return await file.text();
  }
  if (name.endsWith(".pdf")) {
    // 简易 PDF 文本提取:读取二进制,提取括在括号内的文本字符串
    // PDF 文本通常形如:(Hello World) Tj 或 [(H) (ello)] TJ
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // 按 Latin1 解码(PDF 文本通常单字节编码),一次性解码避免 O(n²) 字符串拼接
    const raw = new TextDecoder("latin1").decode(bytes);
    // 提取括号内的文本
    const texts: string[] = [];
    const regex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(raw)) !== null) {
      const t = m[1]
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\");
      if (t.trim()) texts.push(t);
    }
    return texts.join(" ");
  }
  // 其他格式:尝试以文本读取
  try { return await file.text(); } catch { return ""; }
}

/**
 * 正则解析结构化简历字段
 */
export function parseResume(text: string): StructuredResume {
  const rawText = text;
  const parseMethod: StructuredResume["parseMethod"] = "text";

  // 姓名:开头第一行,或"姓名:XXX"
  let name: string | undefined;
  const nameMatch = text.match(/姓名[:：]\s*(\S+)/) || text.match(/^([\u4e00-\u9fa5a-zA-Z·\s]{2,20})$/m);
  if (nameMatch) name = nameMatch[1].trim();

  // 电话
  const phoneMatch = text.match(/1[3-9]\d{9}/);
  const phone = phoneMatch?.[0];

  // 邮箱
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const email = emailMatch?.[0];

  // 教育经历:匹配"学校/专业/学位/时间"模式
  const education: StructuredResume["education"] = [];
  const eduRegex = /([0-9]{4}\.[0-9]{1,2})\s*[-—~至]\s*([0-9]{4}\.[0-9]{1,2}|至今|present)?\s*([^\n]+?(?:大学|学院|University|university)[^\n]*)/g;
  let em: RegExpExecArray | null;
  while ((em = eduRegex.exec(text)) !== null) {
    education.push({
      period: `${em[1]} - ${em[2] || "至今"}`,
      school: em[3].trim(),
    });
  }

  // 工作经历:匹配"公司 职位 时间"
  const experience: StructuredResume["experience"] = [];
  const expRegex = /([0-9]{4}\.[0-9]{1,2})\s*[-—~至]\s*([0-9]{4}\.[0-9]{1,2}|至今|present)?\s*([^\n]+?)\s*[|｜]\s*([^\n]+)/g;
  let xm: RegExpExecArray | null;
  while ((xm = expRegex.exec(text)) !== null) {
    experience.push({
      period: `${xm[1]} - ${xm[2] || "至今"}`,
      company: xm[3].trim(),
      role: xm[4].trim(),
    });
  }

  // 技能:匹配"技能:"后的内容,或技术栈关键词
  const skills: string[] = [];
  const skillMatch = text.match(/技能[:：]?\s*([^\n]+)/);
  if (skillMatch) {
    skills.push(...skillMatch[1].split(/[,，、/\s]+/).filter((s) => s.length > 0 && s.length < 20));
  }
  // 常见技术栈关键词
  const techKeywords = ["JavaScript", "TypeScript", "Python", "Java", "Go", "Rust", "C++", "React", "Vue", "Angular",
    "Node.js", "Spring", "Django", "Flask", "MySQL", "PostgreSQL", "Redis", "MongoDB", "Docker", "Kubernetes",
    "AWS", "GCP", "Azure", "Linux", "Git", "机器学习", "深度学习", "PyTorch", "TensorFlow"];
  for (const kw of techKeywords) {
    if (text.includes(kw) && !skills.includes(kw)) skills.push(kw);
  }

  return { name, phone, email, education, experience, skills, projects: [], rawText, parseMethod };
}

/**
 * 生成 JD 匹配 prompt(交给 LLM)
 */
export function generateJDPrompt(resume: StructuredResume, jd: string): string {
  const skills = resume.skills.join(", ");
  const exp = resume.experience.map((e) => `${e.company} ${e.role} (${e.period})`).join("; ");
  return `请对比以下简历与岗位描述,输出匹配分析。

简历摘要:
- 姓名: ${resume.name || "未知"}
- 技能: ${skills}
- 经历: ${exp}

岗位描述(JD):
${jd}

请严格输出以下 JSON 格式(不要输出其他内容):
{
  "matchScore": 0-100,
  "matchedSkills": ["匹配的技能"],
  "missingSkills": ["缺失的技能"],
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["不足1"],
  "suggestedQuestions": ["建议面试中考察的问题1", "问题2"],
  "advice": "求职建议"
}`;
}

export interface JDMatchResult {
  matchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  weaknesses: string[];
  suggestedQuestions: string[];
  advice: string;
}

export function parseJDMatchResult(content: string): JDMatchResult | null {
  let jsonStr = content.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}
