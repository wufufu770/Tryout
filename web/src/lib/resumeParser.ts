// resumeParser:简历结构化解析(零依赖,纯正则)
//
// ⚠️ 文件解析(PDF/DOCX/TXT)不在本文件。
//    统一由服务端 /api/materials/upload 处理(server/index.js):
//      - PDF  → pdfjs-dist legacy build + cMapUrl(支持中文 CID 编码)
//      - DOCX → mammoth.extractRawText
//    前端只负责拿回 { rawText, title, type } 后调 parseResume() 做结构化。
//
//    历史说明:本文件曾有一个前端 PDF 解析实现(用 latin1 解码 + 括号正则),
//    对中文 PDF 必然失效且无任何调用方,已删除。如需改文件解析,改服务端。

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
  /**
   * R20 新增:哪些字段没解析出来。
   * 动机:此前"教育/经历解析为空"是**静默**的 —— 用户以为导入成功,
   * 面试官却拿不到任何上下文。现在把缺口显式暴露给调用方。
   */
  parseGaps?: string[];
}

// ---- 内部工具 ----

/*
 * 时间段 —— 必须支持真实简历的三种写法:
 *   `2022.07 - 至今`      点分
 *   `2023 年 6 月 – 至今` 中文年月日(真实简历极常见)
 *   `2020.09 -- 2024.06`  双连字符(resume2 模板用的就是这个)
 *
 * ⚠️ 结束标记必须**先于**分隔符匹配,否则「至今」会被分隔符字符类
 * `[-—–~～至]` 吃掉「今」,只剩「至」。
 */
const END_WORD = "(?:至今|今|present|Present|PRESENT|预计|now)";
const SEP = "[-—–~～至]+\\s*";
const START_DATE = "\\d{4}\\s*[.\\-年]\\s*\\d{1,2}\\s*月?";
const END_DATE = "\\d{4}\\s*[.\\-年]\\s*\\d{1,2}\\s*月?";
const PERIOD_RE = new RegExp(
  `(${START_DATE})(?:\\s*${SEP}(${END_DATE}|${END_WORD}))?`,
  "i"
);
/** 只要行里出现时间即视为"经历候选行" */
const HAS_PERIOD_RE = new RegExp(`${START_DATE}`, "i");

/**
 * 技能项的合法性。
 *
 * 除常规过滤外,还要拦一类**随机无意义中文串** ——
 * 部分简历模板(如 Typst 模板)会用随机汉字做隐私遮罩
 * (`肺己阐择萧精拜纱茎` 这种),它们在文本上和真实技能无法区分,
 * 只能靠启发式:真实技能几乎不会包含这些特征字。
 */
const CJK_RE = /[\u4e00-\u9fa5]/;
function looksLikeSkill(s: string): boolean {
  if (!s) return false;
  const t = s.trim();
  if (t.length < 2 || t.length > 20) return false;
  if (/^[\s\p{P}\p{S}]+$/u.test(t)) return false;          // 纯标点/符号
  if (/^\d+$/.test(t)) return false;                          // 纯数字
  if (/^(熟练|掌握|熟悉|精通|了解|使用|具备|能够|擅长|负责)/.test(t)) return false; // 描述句开头
  if (/[。！？；]$/.test(t)) return false;                     // 以句读结尾

  /*
   * 隐私遮罩检测:纯中文串 + 长度偏长 + 不含任何已知技术词 → 判为噪声。
   * 保留短且高频的纯中文技能(机器学习/深度学习/计算机视觉 等)——
   * 它们在 TECH_KEYWORDS 里,会被第 4 步单独捞回,不受此规则影响。
   */
  if (CJK_RE.test(t) && !/[A-Za-z0-9]/.test(t)) {
    // 纯中文技能:只在它本身是"可读的技能名"时保留
    // 启发式:常见中文技能词库
    const CN_SKILL = /^(机器学习|深度学习|自然语言处理|计算机视觉|推荐系统|数据挖掘|数据分析|大数据|云计算|分布式|微服务|高并发|系统设计|算法|数据结构|操作系统|计算机网络|数据库|前端|后端|测试|运维|安全|项目管理|团队协作|沟通表达)/;
    if (!CN_SKILL.test(t)) return false;
  }
  return true;
}

/** 从 `标签 : 值` 形态里取冒号右侧的值(`研究领域 : 语音识别` → `语音识别`) */
function stripLabelPrefix(s: string): string {
  // 只剥离一次"短标签 + 冒号",避免把 `Java:Spring` 这类也切掉
  const m = s.match(/^[^:：]{1,8}[:：]\s*(.+)$/);
  return m ? m[1].trim() : s.trim();
}

/** 从一行里抽出时间段的标准化表示 */
function extractPeriod(line: string): string | undefined {
  const m = line.match(PERIOD_RE);
  if (!m) return undefined;
  const norm = (s: string) =>
    s.replace(/\s+/g, "").replace(/[年]/g, ".").replace(/月/g, "").replace(/\.$/, "").trim();
  const start = norm(m[1]);
  const endRaw = m[2] || "";
  // 「今」是「至今」的简写,统一成「至今」;「至今」不能被截成「至」
  const end = /^(至)?今$|^至今$/.test(endRaw) ? "至今" : norm(endRaw);
  return `${start} - ${end || "至今"}`;
}

/** 去掉一行里的时间段,剩下的才是公司/职位/学校部分 */
function stripPeriod(line: string): string {
  return line
    .replace(PERIOD_RE, " ")
    // 时间段常带括号结束标记,如 `2024.09 -- 2027.06（预计）`;
    // 剥掉时间段后这些残留在原地,不清掉会让"只剩括号内容"的行被误判为空
    .replace(/[（(]\s*(?:至今|今|present|预计|now)\s*[）)]/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s|｜,，·•\-—–]+|[\s|｜,，·•\-—–]+$/g, "")
    .trim();
}

/* ============================================================
 * 姓名 / 电话 / 邮箱
 * ========================================================== */

function extractName(text: string): string | undefined {
  const labeled = text.match(/姓\s*名[:：]\s*([^\s|,，]{1,20})/);
  if (labeled) return labeled[1].trim();
  // 首行独立成行的中文/英文姓名
  const firstLine = text.split("\n").map((s) => s.trim()).find(Boolean);
  if (firstLine && /^[\u4e00-\u9fa5]{2,4}$/.test(firstLine)) return firstLine;
  if (firstLine && /^[A-Za-z][A-Za-z\s.'-]{1,30}$/.test(firstLine) && firstLine.split(/\s+/).length <= 3) {
    return firstLine.trim();
  }
  // 兼容旧行为:任意位置的独立中文行
  const loose = text.match(/^([\u4e00-\u9fa5]{2,4})$/m);
  return loose?.[1]?.trim();
}

function extractPhone(text: string): string | undefined {
  /*
   * ⚠️ 边界约束是必需的:早期版本 `/1[3-9]\d{9}/` 会把 18 位身份证
   * `110101199003078515` 误抓成 `19900307851` —— 用户填的是身份证,
   * 反馈里却显示别人的号码片段。
   */
  const m = text.match(/(?<![\d])1[3-9]\d{9}(?![\d])/);
  return m?.[0];
}

function extractEmail(text: string): string | undefined {
  return text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
}

/* ============================================================
 * 教育 / 工作经历
 * ========================================================== */

/**
 * 把"无时间的行"与"有时间的行"配对。
 *
 * 动机(R20,来自真实 PDF):LaTeX/Typst 排版常把「学校 + 学位」和「时间段」
 * 放在**相邻两行**,例如:
 *     家里蹲大学·计算机学院 硕士生 | 计算机技术
 *     某某描述 2024.09 -- 2027.06（预计）
 * 逐行处理时,时间落到了下一行,导致公司/学校被解析成描述文字。
 * 这里把这类跨行结构合并成一条再解析。
 */
/** 简历的段落标题:本身没有时间,且绝不该与下一行合并 */
const SECTION_HEADING = /^(工作经历|实习经历|教育经历|学术背景|项目经历|竞赛经历|实践经历|专业技能|技能|技术栈|个人简介|自我评价|获奖情况|论文与专利|荣誉奖项|工作|项目|教育|技能特长|求职意向|基本信息)$/;

function pairWithNextTimeLine(text: string): { line: string; source: "same" | "next" }[] {
  const lines = text.split("\n").map((l) => l.trim());
  const out: { line: string; source: "same" | "next" }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    if (!cur) continue;
    if (HAS_PERIOD_RE.test(cur)) {
      out.push({ line: cur, source: "same" });
      continue;
    }
    // ⚠️ 段落标题("工作经历"等)不能与下一行合并,否则标题会混进公司名,
    //    且会消耗掉本该独立成对的那一行
    if (SECTION_HEADING.test(cur)) {
      out.push({ line: cur, source: "same" });
      continue;
    }
    /*
     * ⚠️ 列表项(以 • 开头)不能与下一行合并 ——
     *    否则「• 负责...」会吸走下一条真实经历行,导致该条目凭空消失。
     *    这正是最初"只解析出 1 条"的原因。
     */
    if (/^[•·\-*]/.test(cur)) {
      out.push({ line: cur, source: "same" });
      continue;
    }
    // 当前行无时间 → 看下一行是否有时间
    const next = lines[i + 1];
    if (next && HAS_PERIOD_RE.test(next) && cur.length >= 4 && cur.length <= 120) {
      out.push({ line: `${cur} ${next}`, source: "next" });
      i++;   // 跳过已消费的下一行
      continue;
    }
    out.push({ line: cur, source: "same" });
  }
  return out;
}

const SCHOOL_HINT = /大学|学院|学校|University|College|Institute/i;

/** 常见的"这行是工作经历"信号 */
const JOB_HINT = /工程师|经理|主管|总监|架构师|开发|设计|产品|运营|分析师|专员|负责人|实习|SRE|DevOps|PM|Manager|Engineer|Developer|Designer/i;
/** 常见的"这行是教育经历"信号 */
const DEGREE_HINT = /本科|硕士|博士|学士|研究生|大专|高中|Bachelor|Master|PhD/i;

function parseExperience(text: string): StructuredResume["experience"] {
  const out: StructuredResume["experience"] = [];
  const seen = new Set<string>();

  for (const { line } of pairWithNextTimeLine(text)) {
    if (line.length < 6 || line.length > 200) continue;
    if (line.startsWith("•") || line.startsWith("·") || line.startsWith("-")) continue;
    // 必须有时间
    if (!HAS_PERIOD_RE.test(line)) continue;
    // ⚠️ 含学校/学位的行属于**教育**段,不能进工作经历 ——
    //    早期版本没有这个排除,导致 education 段的行被 parseExperience 先吃掉,
    //    表现为"工作经历里出现清华大学"。
    if (SCHOOL_HINT.test(line) && !JOB_HINT.test(line)) continue;
    if (DEGREE_HINT.test(line) && !JOB_HINT.test(line)) continue;

    const period = extractPeriod(line);
    let rest = stripPeriod(line);
    if (!rest) continue;

    let company: string | undefined;
    let role: string | undefined;

    // 形式 A:公司 | 职位(竖线分隔,最明确)
    const pipe = rest.split(/\s*[|｜]\s*/);
    if (pipe.length >= 2) {
      [company, role] = [pipe[0].trim(), pipe.slice(1).join(" ").trim()];
    } else if (pipe.length === 2) {
      [company, role] = [pipe[0].trim(), pipe[1].trim()];
    } else {
      // 形式 B:职位, 公司 —— 中文简历常见「职位在前」写法
      const comma = rest.split(/[,，]\s*/);
      if (comma.length >= 2) {
        const a = comma[0].trim();
        const b = comma[1].trim();
        // 职位通常含 JOB_HINT 词;若 a 命中则 a 是职位、b 是公司,反之亦然
        if (JOB_HINT.test(a) && !JOB_HINT.test(b)) { role = a; company = b; }
        else if (JOB_HINT.test(b) && !JOB_HINT.test(a)) { company = a; role = b; }
        else { company = a; role = b; }
      } else {
        // 形式 C:公司 职位(空格分隔,无标点)——只能靠词性启发式猜
        const sp = rest.split(/\s+/);
        if (sp.length >= 2) {
          // 找第一个含 JOB_HINT 的词作为职位起点
          const idx = sp.findIndex((w) => JOB_HINT.test(w));
          if (idx > 0) {
            role = sp.slice(idx).join(" ");
            company = sp.slice(0, idx).join(" ");
          } else if (sp.length >= 2) {
            company = sp[0];
            role = sp.slice(1).join(" ");
          }
        } else {
          company = rest;
        }
      }
    }

    company = (company || "").replace(/^[-–—•·\s]+|[-–—•·\s]+$/g, "").trim();
    role = (role || "").replace(/^[-–—•·\s]+|[-–—•\s]+$/g, "").trim();
    if (!company && !role) continue;
    // 公司名太像句子就不采信
    if (company && company.length > 40) company = company.slice(0, 40);
    const key = `${company}|${role}|${period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ company: company || undefined, role: role || undefined, period });
    if (out.length >= 20) break;
  }
  return out;
}

function parseEducation(text: string): StructuredResume["education"] {
  const out: StructuredResume["education"] = [];
  const seen = new Set<string>();

  for (const { line } of pairWithNextTimeLine(text)) {
    if (line.length < 5 || line.length > 200) continue;
    if (line.startsWith("•") || line.startsWith("·")) continue;

    const hasSchool = SCHOOL_HINT.test(line);
    const hasDegree = DEGREE_HINT.test(line);
    if (!hasSchool && !hasDegree) continue;

    const period = extractPeriod(line);
    let rest = stripPeriod(line);
    if (!rest) continue;

    let school: string | undefined;
    let major: string | undefined;
    let degree: string | undefined;

    // 形式 A:学校·学院 学位 | 专业
    const pipe = rest.split(/\s*[|｜]\s*/);
    if (pipe.length >= 2) {
      school = pipe[0].trim();
      major = pipe[1].trim();
    } else {
      // 形式 B:专业, 学校
      const comma = rest.split(/[,，]\s*/);
      if (comma.length >= 2) {
        const a = comma[0].trim();
        const b = comma[1].trim();
        if (SCHOOL_HINT.test(b) && !SCHOOL_HINT.test(a)) { major = a; school = b; }
        else if (SCHOOL_HINT.test(a) && !SCHOOL_HINT.test(b)) { school = a; major = b; }
        else { school = a; major = b; }
      } else {
        school = rest;
      }
    }

    school = (school || "").trim();
    major = (major || "").trim();
    // 学位从整行里抓
    const dm = rest.match(DEGREE_HINT);
    if (dm) degree = dm[0];

    if (school) {
      // 学校名里带上"专业 硕士"是常见写法,剥掉
      school = school.replace(/\s*(本科|硕士|博士|学士|研究生|大专)\s*$/, "").trim() || school;
    }
    if (!school && !major) continue;
    const key = `${school}|${major}|${period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ school: school || undefined, major: major || undefined, degree, period });
    if (out.length >= 10) break;
  }
  return out;
}

/* ============================================================
 * 技能
 * ========================================================== */

const TECH_KEYWORDS = [
  "JavaScript", "TypeScript", "Python", "Java", "Go", "Rust", "C++", "C#", "SQL", "Swift", "Kotlin", "PHP", "Ruby",
  "React", "Vue", "Angular", "Svelte", "Node.js", "Next.js", "Spring", "SpringBoot", "Django", "Flask",
  "MySQL", "PostgreSQL", "Redis", "MongoDB", "Elasticsearch", "Kafka", "RabbitMQ", "RocketMQ",
  "Docker", "Kubernetes", "K8s", "Linux", "Nginx", "Git", "Jenkins", "CI/CD",
  "AWS", "GCP", "Azure", "阿里云", "腾讯云",
  "PyTorch", "TensorFlow", "Keras", "transformers", "DeepSpeed", "fastai", "CUDA",
  "机器学习", "深度学习", "自然语言处理", "计算机视觉", "大模型", "推荐系统", "NLP", "LLM",
];

function extractSkills(text: string): string[] {
  const skills: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (looksLikeSkill(t) && !skills.includes(t)) skills.push(t);
  };

  // 1) `技能: ...` / `技能清单: ...` / `专业技能: ...` 段落
  const block = text.match(/(?:^|\n)\s*(?:专业)?(?:技能|技术栈|技术清单|专业技能)[^:：\n]{0,6}[:：]\s*([^\n]+)/);
  if (block) {
    const body = stripLabelPrefix(block[1]);
    for (const part of body.split(/[,，、;；/]+/)) add(part);
  }

  // 2) `技能` 标题下的一行(简历常见:标题单独一行,内容在下一行)
  const skillHeading = text.match(/(?:^|\n)\s*技能\s*(?:\n|\r\n)\s*([^\n]{2,200})/);
  if (skillHeading) {
    for (const part of stripLabelPrefix(skillHeading[1]).split(/[,，、;；/]+/)) add(part);
  }

  // 3) `标签 : 值` 形态(如 `研究领域 : 语音识别, 多模态学习`)
  for (const m of text.matchAll(/([^\n:：]{2,10})\s*[:：]\s*([^\n]{2,120})/g)) {
    const label = m[1].trim();
    if (!/技能|技术|工具|语言|框架|领域|方向|能力|经验/.test(label)) continue;
    for (const part of m[2].split(/[,，、;；/]+/)) add(part);
  }

  // 4) 技术栈关键词兜底
  for (const kw of TECH_KEYWORDS) {
    if (text.includes(kw) && !skills.includes(kw)) skills.push(kw);
  }

  return skills.slice(0, 40);
}

/* ============================================================
 * 主入口
 * ========================================================== */

export function parseResume(text: string): StructuredResume {
  const rawText = text || "";
  const parseMethod: StructuredResume["parseMethod"] = rawText.trim() ? "text" : "unknown";

  const name = extractName(rawText);
  const phone = extractPhone(rawText);
  const email = extractEmail(rawText);
  const education = parseEducation(rawText);
  const experience = parseExperience(rawText);
  const skills = extractSkills(rawText);

  /*
   * R20:显式暴露"没解析出来"的字段。
   * 此前这些缺口是静默的 —— 用户看到"导入成功",面试官却拿不到上下文。
   */
  const gaps: string[] = [];
  if (rawText.trim()) {
    if (!name) gaps.push("姓名");
    if (!phone) gaps.push("手机号");
    if (!email) gaps.push("邮箱");
    if (education.length === 0) gaps.push("教育经历");
    if (experience.length === 0) gaps.push("工作经历");
    if (skills.length === 0) gaps.push("技能");
  }

  return {
    name, phone, email, education, experience, skills, projects: [],
    rawText, parseMethod,
    parseGaps: gaps.length ? gaps : undefined,
  };
}

/**
 * 生成 JD 匹配 prompt(交给 LLM)
 */
export function generateJDPrompt(resume: StructuredResume, jd: string): string {
  const skills = resume.skills.join(", ");
  const exp = resume.experience.map((e) => `${e.company || ""} ${e.role || ""} (${e.period || ""})`).join("; ");
  return `请对比以下简历与岗位描述,输出匹配分析。

简历摘要:
- 姓名: ${resume.name || "未知"}
- 技能: ${skills || "未提取到"}
- 经历: ${exp || "未提取到"}

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

const JD_MATCH_STRINGS: (keyof JDMatchResult)[] = [
  "matchedSkills", "missingSkills", "strengths", "weaknesses", "suggestedQuestions", "advice",
];

export function parseJDMatchResult(content: string): JDMatchResult | null {
  let jsonStr = (content || "").trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  /*
   * ⚠️ R20 结构校验:此前只做 JSON.parse,LLM 少返回一个字段时
   * 下游会拿到 undefined 并在渲染时崩。缺字段视为无效结果(返回 null),
   * 让调用方走"解析失败"分支而不是渲染崩溃。
   */
  if (typeof parsed.matchScore !== "number" || !Number.isFinite(parsed.matchScore)) return null;
  for (const k of JD_MATCH_STRINGS) {
    const v = parsed[k];
    if (k === "advice") {
      if (typeof v !== "string") return null;
    } else if (!Array.isArray(v) || v.some((x: unknown) => typeof x !== "string")) {
      return null;
    }
  }
  return parsed as JDMatchResult;
}
