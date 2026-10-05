// 题库元数据(不含题库内容)
//
// W3-1 拆分说明:原 `data/questionBank.ts` 同时承担两件事——
//   (a) 行业/题型/难度的中文元数据与类型定义
//   (b) import 12 个数据文件、聚合出 808 道题(合计 909 KB)
// (b) 是首屏负担:即使没进题库页,这 900 KB 也会进 Vite 主 bundle。
// 现在拆开:本文件只留 (a);题库内容改为运行时从服务端拉取。
//
// 凡是需要在**渲染筛选项**时拿到中文 label 的地方仍用这里;
// 凡是拿到题目**内容**的地方改用 @/lib/questionBankClient。

export type QuestionType = "technical" | "design" | "behavioral" | "coding" | "questions";
export type QuestionDifficulty = "junior" | "mid" | "senior";

export interface Question {
  id: string;          // 如 "backend-tech-001"
  industry: string;    // 如 "backend"
  type: QuestionType;
  difficulty: QuestionDifficulty;
  title: string;       // 题目标题
  content: string;     // 题目详细描述
  /** 参考答案 —— ⚠️ 仅服务端持有,不下发到前端(见 questionBankClient.toLite) */
  referenceAnswer?: string;
  keyPoints: string[]; // 考察点列表
  tags: string[];
  estimatedMinutes: number;
}

// 行业列表(12 个)
export const INDUSTRIES: { id: string; label: string; icon: string }[] = [
  { id: "backend",   label: "后端开发",     icon: "🖥️" },
  { id: "frontend",  label: "前端开发",     icon: "🎨" },
  { id: "algorithm", label: "算法工程师",   icon: "🧮" },
  { id: "data",      label: "数据分析师",   icon: "📊" },
  { id: "product",   label: "产品经理",     icon: "🎯" },
  { id: "devops",    label: "运维工程师",   icon: "🚀" },
  { id: "ai",        label: "AI/机器学习",  icon: "🤖" },
  { id: "security",  label: "网络安全",     icon: "🛡️" },
  { id: "qa",        label: "测试工程师",   icon: "🐞" },
  { id: "mobile",    label: "移动开发",     icon: "📱" },
  { id: "project",   label: "项目经理",     icon: "📋" },
  { id: "hr",        label: "人力资源",     icon: "👥" },
];

// 题型列表(5 种)
export const QUESTION_TYPES: { id: QuestionType; label: string }[] = [
  { id: "technical",  label: "技术原理" },
  { id: "design",     label: "系统设计" },
  { id: "behavioral", label: "行为面试" },
  { id: "coding",     label: "手撕代码" },
  { id: "questions",  label: "反问环节" },
];

// 难度列表(3 档)
export const DIFFICULTIES: { id: QuestionDifficulty; label: string }[] = [
  { id: "junior", label: "初级" },
  { id: "mid",    label: "中级" },
  { id: "senior", label: "高级" },
];
