// 题库数据源聚合(W3-1)
//
// ⚠️ 本目录**不在前端源码树内**（web/src/data/）。
//    原因:12 个数据文件合计 917 KB,放在 web/src 下会被 Vite 打进主 bundle,
//    即使用户从不打开题库页也要下载。移到仓库根的 data/ 后,
//    只有 `npm run export:questionbank` 会读取它们,产出 JSON。
//
// 类型定义复用前端薄层(避免重复声明且保证前后端类型一致):
//   web/src/data/questionMeta.ts
//
// 产出:由 web/scripts/export-questionbank.mjs 消费
import { AI_QUESTIONS } from "./ai";
import { ALGORITHM_QUESTIONS } from "./algorithm";
import { BACKEND_QUESTIONS } from "./backend";
import { DATA_QUESTIONS } from "./data";
import { PRODUCT_QUESTIONS } from "./product";
import { DEVOPS_QUESTIONS } from "./devops";
import { FRONTEND_QUESTIONS } from "./frontend";
import { HR_QUESTIONS } from "./hr";
import { MOBILE_QUESTIONS } from "./mobile";
import { PROJECT_QUESTIONS } from "./project";
import { QA_QUESTIONS } from "./qa";
import { SECURITY_QUESTIONS } from "./security";

export const QUESTION_BANK = [
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

export {
  AI_QUESTIONS,
  ALGORITHM_QUESTIONS,
  BACKEND_QUESTIONS,
  DATA_QUESTIONS,
  PRODUCT_QUESTIONS,
  DEVOPS_QUESTIONS,
  FRONTEND_QUESTIONS,
  HR_QUESTIONS,
  MOBILE_QUESTIONS,
  PROJECT_QUESTIONS,
  QA_QUESTIONS,
  SECURITY_QUESTIONS,
};
