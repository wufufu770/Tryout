// 单元测试:Agent CRUD(零依赖,用 Node.js 内置 node:test)
// 运行:node --test test/
// 注意:db.js 模块加载时即连接 DB,测试会使用 DB_DIR 指向的测试库
// 建议运行前设置 DB_DIR 指向临时目录,避免污染开发库
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent, getAgent, listAgents, updateAgentBasic, deleteAgent, createAgentVersion, setAgentCurrentVersion,
} from "../db.js";

const TEST_PREFIX = "test_" + Date.now() + "_";

test("createAgent + getAgent:创建并按 id 读取", () => {
  const agentId = TEST_PREFIX + "crud_1";
  const created = createAgent({
    agentId,
    name: "测试面试官",
    avatar: "🤖",
    role: "hr",
    isTemplate: false,
    tone: "neutral",
    focusAreas: ["沟通"],
    difficulty: 5,
    promptTemplate: "# Role\n你是测试用面试官",
  });
  // createAgent 返回 camelCase 对象
  assert.ok(created, "createAgent 应返回创建的对象");
  assert.equal(created.name, "测试面试官");
  assert.equal(created.role, "hr");
  // getAgent 也返回 camelCase
  const got = getAgent(agentId);
  assert.ok(got, "应能查到新建的 agent");
  assert.equal(got.name, "测试面试官");
  assert.equal(got.agentId, agentId);
});

test("listAgents:支持按 kind 过滤候选人", () => {
  const agentId = TEST_PREFIX + "cand_1";
  createAgent({
    agentId,
    name: "测试候选人",
    avatar: "🙂",
    role: "candidate",
    isTemplate: false,
    agentKind: "candidate",
    candidatePersona: "calm",
    tone: "neutral",
    focusAreas: ["附和"],
    difficulty: 4,
    promptTemplate: "# Role\n你是测试候选人",
  });
  const candidates = listAgents("candidate");
  // listAgents 返回 camelCase,字段是 agentId 不是 agent_id
  assert.ok(candidates.some(a => a.agentId === agentId), "候选人列表应包含新建候选人");
  const interviewers = listAgents("interviewer");
  assert.ok(!interviewers.some(a => a.agentId === agentId), "面试官列表不应包含候选人");
});

test("updateAgentBasic:更新基础字段(role 必填)", () => {
  const agentId = TEST_PREFIX + "upd_1";
  createAgent({
    agentId,
    name: "原名",
    avatar: "🧊",
    role: "hr",
    isTemplate: false,
    tone: "neutral",
    focusAreas: [],
    difficulty: 3,
    promptTemplate: "原 prompt",
  });
  // updateAgentBasic 要求 role 必填
  updateAgentBasic(agentId, {
    name: "新名",
    role: "hr", // 必填
    avatar: "🔥",
    tone: "aggressive", // 注:tone 在 updateAgentBasic 不更新,只在版本里
    focusAreas: ["抗压"],
    difficulty: 8,
    promptTemplate: "新 prompt",
  });
  const got = getAgent(agentId);
  assert.equal(got.name, "新名");
  assert.equal(got.avatar, "🔥");
});

test("createAgentVersion + setAgentCurrentVersion:版本切换", () => {
  const agentId = TEST_PREFIX + "ver_1";
  const created = createAgent({
    agentId,
    name: "版本测试",
    avatar: "📋",
    role: "hr",
    isTemplate: false,
    tone: "neutral",
    focusAreas: [],
    difficulty: 5,
    promptTemplate: "v1 prompt",
  });
  // 创建 v2 版本
  const v2 = createAgentVersion(agentId, {
    changeSummary: "加强追问",
    promptTemplate: "v2 prompt 更强",
  });
  // setAgentCurrentVersion 需要有效 versionId
  assert.ok(v2?.versionId, "createAgentVersion 应返回新版本");
  setAgentCurrentVersion(agentId, v2.versionId);
  const got = getAgent(agentId);
  assert.ok(got, "版本切换后 agent 仍存在");
  assert.equal(got.currentVersionId, v2.versionId, "当前版本应切换到 v2");
});

test("deleteAgent:删除后查不到", () => {
  const agentId = TEST_PREFIX + "del_1";
  createAgent({
    agentId,
    name: "待删除",
    avatar: "❌",
    role: "hr",
    isTemplate: false,
    tone: "neutral",
    focusAreas: [],
    difficulty: 5,
    promptTemplate: "待删",
  });
  deleteAgent(agentId);
  const got = getAgent(agentId);
  assert.ok(!got, "删除后应查不到(返回 null/undefined)");
});

// 清理:所有 TEST_PREFIX 开头的 agent 都删掉,避免污染
test("清理测试数据", () => {
  const all = listAgents();
  for (const a of all) {
    if (a.agentId && a.agentId.startsWith("test_")) {
      try { deleteAgent(a.agentId); } catch { /* 忽略 */ }
    }
  }
});
