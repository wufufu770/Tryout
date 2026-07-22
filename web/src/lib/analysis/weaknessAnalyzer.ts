import { api } from "@/api/client";

export interface WeaknessResult {
  hasData: boolean;
  message?: string;
  totalEvaluations?: number;
  dimensionStats?: { dimensionName: string; avgScore: number; count: number }[];
  weakestDimensions?: { dimensionName: string; avgScore: number; count: number }[];
  advice?: string;
  recentScores?: { score: number; date: string; sessionId: string }[];
}

export async function analyzeWeakness(limit = 5): Promise<WeaknessResult> {
  return api.request(`/analysis/weakness?limit=${limit}`);
}
