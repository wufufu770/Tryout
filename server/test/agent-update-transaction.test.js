// 单元测试:Agent 一次性保存的事务边界(守卫 ISSUE-065)
//
// ## 背景
// 前端 `agentStore.updateAgent` 此前是两个请求:
//   PUT /api/agents/:id/basic   → 改基本信息
//   POST /api/agents/:id/versions → 建版本 + 切 current_version_id
// 两步之间没有任何回滚。第二步失败时第一步已落库,于是:
//   基本信息改了但没有对应版本记录(版本链断裂),
//   前端 set() 从未执行、store 仍是旧值,用户以为没保存 —— 刷新才发现真改了。
//
// 现改为 `updateAgentWithVersion()`:一个事务里做完两件事。
//
// ## ⚠️ 这份测试为什么必须绕过 HTTP 直接调 db
// R27 教训:门禁变绿不等于问题被解决,得看它到底测了什么。
// 我最初在 e2e 里写的是"version 侧非法 → 400,且基本信息不变",并把它当成
// 事务回滚的证据。**复核发现那是假绿**:
// 路由里两个 `s.object(...).parse()` 都在调用 `updateAgentWithVersion` **之前**,
// 所以 version 非法时 db 函数压根没被调用 —— 哪怕没有事务,basic 也不会变。
// 那条 e2e 实际测的是"schema 层拒绝时无写入",不是"事务回滚"。
//
// 真正能区分有无事务的失败源是 **db 层类型错误**:
// better-sqlite3 的 `.run()` 收到非法绑定值会抛 TypeError,而 HTTP 路径的
// schema 会先把它挡掉。所以这里直接给 db 层喂 schema 拦不住的坏数据 ——
// 正是它能验证事务真的在回滚。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent, getAgent, updateAgentWithVersion, createAgentVersion,
} from "../db.js";

const P = "test_tx_" + Date.now() + "_";

function mkAgent(suffix, over = {}) {
  const agentId = P + suffix;
  createAgent({
    agentId,
    name: "原名",
    role: "tech",
    promptTemplate: "原提示词",
    tone: "neutral",
    difficulty: 5,
    focusAreas: [],
    ...over,
  });
  return agentId;
}

// ---- 正常路径 ----

test("正常保存:基本信息与新版本同时生效,currentVersion 指向新版本", () => {
  const id = mkAgent("ok");
  const before = getAgent(id).currentVersionId;
  const v = updateAgentWithVersion(id, { name: "新名字" }, {
    promptTemplate: "新提示词", tone: "aggressive", difficulty: 8,
    focusAreas: ["缓存"], changelog: "改了语气",
  });
  const a = getAgent(id);
  assert.equal(a.name, "新名字", "基本信息应生效");
  assert.ok(v?.versionId, "应返回新建的版本");
  assert.equal(a.currentVersionId, v.versionId, "currentVersion 应指向刚建的版本");
  assert.notEqual(a.currentVersionId, before, "currentVersion 应确实变了");
  assert.equal(v.tone, "aggressive");
  assert.equal(v.difficulty, 8);
  // camelize 已把 focus_areas 的 JSON 解析成数组(db.js 的 JSON 列白名单)
  assert.deepEqual(v.focusAreas, ["缓存"]);
  assert.equal(v.changelog, "改了语气");
});

test("未传的版本字段沿用 db 层既有默认值,不被 partial() 的默认值污染", () => {
  // 呼应 ISSUE-040:partial() 会带上创建场景的默认值,把"没传"变成"设成默认"。
  // 这里 version 侧刻意不传 tone,期望落库为 "neutral"(db 层 `|| "neutral"` 兜底),
  // 而不是出现别的值。
  const id = mkAgent("dflt");
  const v = updateAgentWithVersion(id, {}, { promptTemplate: "只给提示词" });
  assert.equal(v.tone, "neutral");
  assert.equal(v.difficulty, 5);
});

test("多次保存:版本号递增,不覆盖历史版本", () => {
  const id = mkAgent("seq");
  const v1 = updateAgentWithVersion(id, { name: "第一次" }, { promptTemplate: "p1" });
  const v2 = updateAgentWithVersion(id, { name: "第二次" }, { promptTemplate: "p2" });
  assert.notEqual(v1.versionId, v2.versionId);
  assert.equal(v2.versionNo, v1.versionNo + 1, "versionNo 应递增");
  assert.equal(getAgent(id).name, "第二次");
});

// ---- 事务回滚(这份测试的核心,也是 e2e 覆盖不到的那部分)----

test("事务回滚:版本写入失败时,基本信息必须完全不变", () => {
  const id = mkAgent("rollback");
  const before = getAgent(id);
  const nameBefore = before.name;
  const verBefore = before.currentVersionId;

  // promptTemplate 传对象:`!input.promptTemplate` 对对象为 false,能过前置校验,
  // 但 better-sqlite3 只接受 null/number/string/Buffer/BigInt,绑定阶段抛错
  // (实测是 `RangeError: Too few parameter values were provided`,不是 TypeError ——
  //  同样不能用字符串代替:SQLite 弱类型,"abc" 会被照存成 TEXT,根本不报错。)
  // 这里不断言错误类型:本测试要锁的是"抛错时数据回滚",不是"抛哪种错"。
  assert.throws(
    () => updateAgentWithVersion(id, { name: "不该生效的名字" }, {
      promptTemplate: { not: "a string" },
    }),
    "应抛出绑定错误"
  );

  const after = getAgent(id);
  assert.equal(after.name, nameBefore, "基本信息必须回滚 —— 这正是不加事务时的数据不一致");
  assert.equal(after.currentVersionId, verBefore, "currentVersion 不该变(不该产生半截版本链)");
});

test("事务回滚:提示词为空时也必须整体回滚", () => {
  const id = mkAgent("empty");
  const nameBefore = getAgent(id).name;
  assert.throws(
    () => updateAgentWithVersion(id, { name: "同样不该生效" }, { promptTemplate: "" }),
    /promptTemplate/
  );
  assert.equal(getAgent(id).name, nameBefore);
});

// ---- 前置校验:这些失败发生在事务之前,basic 也不该被改 ----

test("agent 不存在 → 404,不留任何写入", () => {
  assert.throws(
    () => updateAgentWithVersion("no-such-agent-xyz", { name: "x" }, { promptTemplate: "y" }),
    (e) => e.status === 404 || /不存在|NotFound|Agent/i.test(e.message),
    "应报不存在"
  );
});

test("模板 Agent 不可修改", () => {
  const id = mkAgent("tpl", { isTemplate: true });
  assert.throws(
    () => updateAgentWithVersion(id, { name: "改模板" }, { promptTemplate: "y" }),
    /模板/,
    "模板 Agent 应被拒"
  );
  assert.equal(getAgent(id).name, "原名", "被拒后不得有任何改动");
});

test("缺 promptTemplate → 校验失败,且基本信息不变", () => {
  const id = mkAgent("nover");
  const nameBefore = getAgent(id).name;
  assert.throws(() => updateAgentWithVersion(id, { name: "不该生效" }, {}), /promptTemplate/);
  assert.equal(getAgent(id).name, nameBefore);
});

// ---- 回归:独立的 createAgentVersion 仍要正常(我把它重构成了复用 _insertAgentVersion)----

test("回归:createAgentVersion 仍然只建一个版本,不被重构改坏", () => {
  const id = mkAgent("reg");
  const v = createAgentVersion(id, { promptTemplate: "独立建版本", tone: "gentle" });
  assert.ok(v?.versionId);
  assert.equal(v.versionNo, 2, "初始版本占 1,新版本应为 2");
  assert.equal(v.tone, "gentle");
  assert.equal(getAgent(id).currentVersionId, v.versionId);
  // 再建一个,确认没有因为重构而重复插入
  const v2 = createAgentVersion(id, { promptTemplate: "第二个" });
  assert.equal(v2.versionNo, 3, "必须严格递增,不能出现重复 versionNo");
  assert.notEqual(v.versionId, v2.versionId);
});
