// 弱项分析核心逻辑单元测试
// 关注:这段逻辑会**直接给用户"该练什么"的建议**,统计口径错了就是在给错误建议。
// 无评估数据时必须返回 hasData:false 并说明,**不能编造建议**。
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWeaknessCore } from "../services/weaknessCore.js";

const ev = (dims, overallScore = 6, date = "2026-01-01", id = "e") => ({
  evaluationId: id,
  overallScore,
  generatedAt: date,
  sessionId: `s-${id}`,
  dimensions: Object.entries(dims).map(([dimensionName, score]) => ({ dimensionName, score, comment: "" })),
});

test("无评估数据:返回 hasData:false 而非编造建议", () => {
  const r = analyzeWeaknessCore([]);
  assert.equal(r.hasData, false);
  assert.equal(r.advice, undefined);
});

test("维度统计:计算平均分与样本数", () => {
  const r = analyzeWeaknessCore([
    ev({ 技术深度: 4, 沟通表达: 5 }),
    ev({ 技术深度: 2, 沟通表达: 5 }),
  ]);
  const tech = r.dimensionStats.find((d) => d.dimensionName === "技术深度");
  assert.equal(tech.avgScore, 3);
  assert.equal(tech.count, 2);
});

test("维度统计:按平均分升序(最弱在前)", () => {
  const r = analyzeWeaknessCore([ev({ A: 5, B: 2, C: 4 })]);
  assert.deepEqual(r.dimensionStats.map((d) => d.dimensionName), ["B", "C", "A"]);
});

test("弱项:最多返回 2 个", () => {
  // 每个维度至少 3 个样本,才够格进入建议
  const rows = [
    ev({ A: 1, B: 2, C: 3, D: 4, E: 5 }, 5, "2026-01-01", "1"),
    ev({ A: 1, B: 2, C: 3, D: 4, E: 5 }, 5, "2026-01-02", "2"),
    ev({ A: 1, B: 2, C: 3, D: 4, E: 5 }, 5, "2026-01-03", "3"),
  ];
  const r = analyzeWeaknessCore(rows);
  assert.equal(r.weakestDimensions.length, 2);
  assert.equal(r.weakestDimensions[0].dimensionName, "A");
});

test("弱项:给出可执行的建议文本", () => {
  const rows = [
    ev({ 技术深度: 2, 沟通表达: 5 }, 5, "2026-01-01", "1"),
    ev({ 技术深度: 2, 沟通表达: 5 }, 5, "2026-01-02", "2"),
    ev({ 技术深度: 2, 沟通表达: 5 }, 5, "2026-01-03", "3"),
  ];
  const r = analyzeWeaknessCore(rows);
  assert.ok(r.advice.includes("技术深度"));
});

test("样本量门槛:1 个样本的 2 分不应触发练习建议", () => {
  const r = analyzeWeaknessCore([
    ev({ 沟通表达: 2 }, 5, "2026-01-01", "a"),   // 只 1 次就 2 分
    ev({ 技术深度: 3 }, 5, "2026-01-02", "b"),
    ev({ 技术深度: 3 }, 5, "2026-01-03", "c"),
    ev({ 技术深度: 3 }, 5, "2026-01-04", "d"),
  ]);
  assert.ok(!r.advice.includes("沟通表达"), "1 个样本不应触发建议");
  assert.ok(r.advice.includes("技术深度"));
});

test("样本量门槛:样本不足的维度标记 lowConfidence", () => {
  const r = analyzeWeaknessCore([
    ev({ 沟通表达: 2 }, 5, "2026-01-01", "a"),
    ev({ 技术深度: 3 }, 5, "2026-01-02", "b"),
    ev({ 技术深度: 3 }, 5, "2026-01-03", "c"),
    ev({ 技术深度: 3 }, 5, "2026-01-04", "d"),
  ]);
  assert.equal(r.dimensionStats.find((d) => d.dimensionName === "沟通表达").lowConfidence, true);
  assert.equal(r.dimensionStats.find((d) => d.dimensionName === "技术深度").lowConfidence, false);
});

test("样本量门槛:全部维度样本都不足时应说明而非给建议", () => {
  const r = analyzeWeaknessCore([
    ev({ A: 2 }, 5, "2026-01-01", "a"),
    ev({ B: 3 }, 5, "2026-01-02", "b"),
  ]);
  assert.ok(!r.advice.includes("【"));
  assert.ok(r.advice.includes("样本"), "应说明样本不够");
});

test("样本量门槛:可配置", () => {
  const data = [ev({ A: 2 }, 5, "2026-01-01", "a"), ev({ A: 2 }, 5, "2026-01-02", "b")];
  assert.ok(!analyzeWeaknessCore(data).advice.includes("A"), "默认门槛 3 → 不进入建议");
  assert.ok(analyzeWeaknessCore(data, { minSamples: 2 }).advice.includes("A"));
});

test("维度统计:平均分与样本数(不受门槛影响)", () => {
  const r = analyzeWeaknessCore([ev({ X: 4 }, 5, "2026-01-01", "1"), ev({ X: 2 }, 5, "2026-01-02", "2")]);
  const x = r.dimensionStats.find((d) => d.dimensionName === "X");
  assert.equal(x.avgScore, 3);
  assert.equal(x.count, 2);
});

test("边界:评估无 dimensions 时不崩溃", () => {
  const r = analyzeWeaknessCore([
    { evaluationId: "x", overallScore: 5, generatedAt: "2026-01-01", sessionId: "s" },
  ]);
  assert.equal(r.hasData, true);
  assert.deepEqual(r.dimensionStats, []);
  assert.ok(r.advice.includes("维度明细"));
});

test("边界:非法分数应被跳过而非拉低均值", () => {
  const r = analyzeWeaknessCore([
    { evaluationId: "a", overallScore: 5, generatedAt: "2026-01-01", sessionId: "s",
      dimensions: [{ dimensionName: "X", score: NaN, comment: "" }] },
    ev({ X: 4 }, 5, "2026-01-02", "b"),
  ]);
  const x = r.dimensionStats.find((d) => d.dimensionName === "X");
  assert.equal(x.avgScore, 4);
  assert.equal(x.count, 1);
});

test("边界:recentScores 按时间倒序", () => {
  const r = analyzeWeaknessCore([
    ev({ A: 3 }, 5, "2026-01-01", "old"),
    ev({ A: 3 }, 5, "2026-06-01", "new"),
  ]);
  assert.ok(r.recentScores[0].date >= r.recentScores[1].date);
});

test("边界:空参数不应崩溃", () => {
  assert.doesNotThrow(() => analyzeWeaknessCore(null));
  assert.doesNotThrow(() => analyzeWeaknessCore(undefined));
});
