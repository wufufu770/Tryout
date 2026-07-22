// 内置行业题库模块
// 覆盖 12 大行业、5 种题型、3 个难度等级,总计 500+ 题
// 主文件:类型定义 + 行业/题型/难度元数据 + 过滤函数 + 各行业数据合并
//
// 数据文件拆分:
//   questionBank.backend.ts    后端开发
//   questionBank.frontend.ts   前端开发
//   questionBank.algorithm.ts  算法工程师
//   questionBank.data.ts       数据分析师
//   questionBank.product.ts    产品经理
//   questionBank.devops.ts     运维工程师
//   questionBank.ai.ts         AI/机器学习
//   questionBank.security.ts   网络安全
//   questionBank.qa.ts         测试工程师
//   questionBank.mobile.ts     移动开发
//   questionBank.project.ts    项目经理
//   questionBank.hr.ts         人力资源

export interface Question {
  id: string;          // 如 "backend-tech-001"
  industry: string;    // 如 "backend"
  type: "technical" | "design" | "behavioral" | "coding" | "questions";
  difficulty: "junior" | "mid" | "senior";
  title: string;       // 题目标题
  content: string;     // 题目详细描述
  referenceAnswer: string;  // 参考答案(简明扼要)
  keyPoints: string[];      // 考察点列表
  tags: string[];           // 标签
  estimatedMinutes: number; // 预估时长(分钟)
}

// 行业列表
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

// 题型列表
export const QUESTION_TYPES: { id: string; label: string }[] = [
  { id: "technical",  label: "技术原理" },
  { id: "design",     label: "系统设计" },
  { id: "behavioral", label: "行为面试" },
  { id: "coding",     label: "手撕代码" },
  { id: "questions",  label: "反问环节" },
];

// 难度列表
export const DIFFICULTIES: { id: string; label: string }[] = [
  { id: "junior", label: "初级" },
  { id: "mid",    label: "中级" },
  { id: "senior", label: "高级" },
];

// 导入各行业题库数据
import { BACKEND_QUESTIONS }    from "./questionBank.backend";
import { FRONTEND_QUESTIONS }   from "./questionBank.frontend";
import { ALGORITHM_QUESTIONS }  from "./questionBank.algorithm";
import { DATA_QUESTIONS }       from "./questionBank.data";
import { PRODUCT_QUESTIONS }    from "./questionBank.product";
import { DEVOPS_QUESTIONS }     from "./questionBank.devops";
import { AI_QUESTIONS }         from "./questionBank.ai";
import { SECURITY_QUESTIONS }   from "./questionBank.security";
import { QA_QUESTIONS }         from "./questionBank.qa";
import { MOBILE_QUESTIONS }     from "./questionBank.mobile";
import { PROJECT_QUESTIONS }    from "./questionBank.project";
import { HR_QUESTIONS }         from "./questionBank.hr";

// 合并全部题目
export const QUESTION_BANK: Question[] = [
  ...BACKEND_QUESTIONS,
  ...FRONTEND_QUESTIONS,
  ...ALGORITHM_QUESTIONS,
  ...DATA_QUESTIONS,
  ...PRODUCT_QUESTIONS,
  ...DEVOPS_QUESTIONS,
  ...AI_QUESTIONS,
  ...SECURITY_QUESTIONS,
  ...QA_QUESTIONS,
  ...MOBILE_QUESTIONS,
  ...PROJECT_QUESTIONS,
  ...HR_QUESTIONS,
];

// 过滤函数:支持按行业 / 题型 / 难度过滤,未指定则不过滤
export function filterQuestions(opts: {
  industry?: string;
  type?: string;
  difficulty?: string;
}): Question[] {
  return QUESTION_BANK.filter((q) => {
    if (opts.industry && q.industry !== opts.industry) return false;
    if (opts.type && q.type !== opts.type) return false;
    if (opts.difficulty && q.difficulty !== opts.difficulty) return false;
    return true;
  });
}

// 按 id 查找题目
export function getQuestionById(id: string): Question | undefined {
  return QUESTION_BANK.find((q) => q.id === id);
}
