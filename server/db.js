// 数据库初始化与访问层
// Docker 版:后端 SQLite,通过 REST API 暴露
// v2:新增 providers 表(cc-switch 风格供应商管理)+ bug 修复
// v3:消息入库前做 PII 脱敏,补齐 404/校验,新增 stage / current-version 接口
// v5:多 Agent 协同 + 会话难度 + 整场评价 + 会话分组
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import path from "path";
import fs from "fs";
import { redactPii } from "./pii.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

// DB_DIR 解析:优先环境变量 → Docker /data → 本地 ./data
// 跨平台兼容:Windows 下 "/data" 会被解析为 "<盘符>:\data" 导致 EPERM
const DB_DIR = process.env.DB_DIR || (process.platform === "win32" ? path.join(process.cwd(), "data") : "/data");
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_BASE = fs.existsSync(path.join(DB_DIR, "tryout.db")) || !fs.existsSync(path.join(DB_DIR, "interviewx.db"))
  ? "tryout"
  : "interviewx";
const DB_PATH = path.join(DB_DIR, `${DB_BASE}.db`);

// Agent 图标存储目录
const ICON_DIR = path.join(DB_DIR, "agent_icons");
if (!fs.existsSync(ICON_DIR)) fs.mkdirSync(ICON_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
// 写忙时等待 5s 而非立即抛 SQLITE_BUSY(默认 0),避免并发写场景下偶发错误
db.pragma("busy_timeout = 5000");
// 同步模式:NORMAL(WAL 下兼顾性能与一致性,意外断电不损坏库)
db.pragma("synchronous = NORMAL");

// 建表
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  name TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL,
  current_version_id TEXT,
  is_template INTEGER NOT NULL DEFAULT 0,
  -- v5:头像类型(emoji/preset/uploaded)、头像值、默认供应商
  icon_type TEXT NOT NULL DEFAULT 'emoji',
  icon_value TEXT,
  preferred_provider_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_versions (
  version_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  tone TEXT NOT NULL DEFAULT 'neutral',
  focus_areas TEXT NOT NULL DEFAULT '[]',
  difficulty INTEGER NOT NULL DEFAULT 5,
  prompt_template TEXT NOT NULL,
  changelog TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, version_no)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  model_id TEXT NOT NULL,
  flow_template TEXT,
  current_stage INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  -- v5:会话难度(easy/normal/hard/extreme/hell)、分组归属
  difficulty TEXT NOT NULL DEFAULT 'normal',
  group_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS session_agents (
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_version_id TEXT NOT NULL,
  role_in_session TEXT NOT NULL DEFAULT 'primary',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, agent_id)
);

CREATE TABLE IF NOT EXISTS session_materials (
  session_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  purpose TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, material_id)
);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  agent_version_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model_version TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  parent_message_id TEXT,
  stage INTEGER NOT NULL DEFAULT 0,
  is_degraded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS materials (
  material_id TEXT PRIMARY KEY,
  user_id TEXT DEFAULT 'default',
  type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  title TEXT,
  content_hash TEXT,
  char_count INTEGER NOT NULL DEFAULT 0,
  parse_status TEXT NOT NULL DEFAULT 'ok',
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_contents (
  material_id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  parsed_json TEXT
);

CREATE TABLE IF NOT EXISTS evaluations (
  evaluation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_version_id TEXT,
  model_version TEXT,
  overall_score REAL NOT NULL,
  report TEXT NOT NULL,
  improvement_advice TEXT,
  better_answer_sample TEXT,
  tokens_consumed INTEGER NOT NULL DEFAULT 0,
  generation_ms INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evaluation_dimensions (
  evaluation_id TEXT NOT NULL,
  dimension_name TEXT NOT NULL,
  score REAL NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  comment TEXT,
  PRIMARY KEY (evaluation_id, dimension_name)
);

-- 旧表(保留兼容,逐步迁移到 providers)
CREATE TABLE IF NOT EXISTS api_keys (
  provider TEXT PRIMARY KEY,
  key_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v2: cc-switch 风格供应商表
CREATE TABLE IF NOT EXISTS providers (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  base_url TEXT NOT NULL,
  api_key TEXT,
  api_format TEXT NOT NULL DEFAULT 'openai_chat',
  model_name TEXT,
  icon TEXT,
  icon_color TEXT,
  notes TEXT,
  website_url TEXT,
  sort_index INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  in_failover_queue INTEGER NOT NULL DEFAULT 0,
  failover_priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v5:阶段-Agent 绑定(多 Agent 协同)
CREATE TABLE IF NOT EXISTS session_stage_agents (
  session_id    TEXT NOT NULL,
  stage_index   INTEGER NOT NULL,
  agent_id      TEXT NOT NULL,
  role_in_stage TEXT NOT NULL DEFAULT 'primary',
  ask_mode      TEXT NOT NULL DEFAULT 'sequential',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, stage_index, agent_id)
);

-- v5:整场面试回顾评价
CREATE TABLE IF NOT EXISTS session_reviews (
  review_id     TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  overall_score REAL NOT NULL,
  strengths     TEXT,
  weaknesses    TEXT,
  improvements  TEXT,
  performance   TEXT,
  next_focus    TEXT,
  generated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v5:会话分组
CREATE TABLE IF NOT EXISTS session_groups (
  group_id             TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  description          TEXT,
  color                TEXT DEFAULT '#4D6BFE',
  sort_order           INTEGER NOT NULL DEFAULT 0,
  summary              TEXT,
  summary_generated_at TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v10.2.4(P0-3):独立的 token 用量记录表(修复无 sessionId 时 usage 不入库导致预算绕过)
-- 原方案:tokens_total 仅记在 sessions 表,onUsage 依赖 sessionId,无 sessionId 时 onUsage=null → 预算校验失效
-- 新方案:每次 LLM 调用都记录到 token_usage,预算校验从 token_usage 查(不依赖 sessions)
CREATE TABLE IF NOT EXISTS token_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tokens     INTEGER NOT NULL,
  provider   TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(date(created_at));
`);

// ---- 性能索引(幂等,旧库自动补建) ----
// 覆盖列表页常见查询:按时间倒序、按类型/状态过滤、外键关联
db.exec(`
CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent ON agent_versions(agent_id, version_no);

CREATE INDEX IF NOT EXISTS idx_evaluations_session ON evaluations(session_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluation_dimensions_eval ON evaluation_dimensions(evaluation_id);

CREATE INDEX IF NOT EXISTS idx_materials_user_type ON materials(user_id, type, added_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_stage_agents_session ON session_stage_agents(session_id, stage_index);
CREATE INDEX IF NOT EXISTS idx_session_reviews_session ON session_reviews(session_id);

CREATE INDEX IF NOT EXISTS idx_providers_active ON providers(is_active);
CREATE INDEX IF NOT EXISTS idx_providers_failover ON providers(in_failover_queue, failover_priority);
`);

// ---- 启动时自动备份(每天最多 1 份,保留最近 7 份) ----
// 第一性原理:SQLite 单文件误删即丢,启动时低频备份是最低成本的容灾
// v10:改用 better-sqlite3 的 db.backup() API(基于 SQLite Online Backup API)
// 原因:WAL 模式下 fs.copyFileSync 可能复制到一半的页(尤其有并发写时),产生损坏备份;
// db.backup() 在 SQLite 层做页级复制,保证一致性
function backupDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) return; // 首次启动无库可备份
    const backupDir = path.join(DB_DIR, "backup");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const backupPath = path.join(backupDir, `${DB_BASE}-${today}.db`);
    // 当天已备份则跳过
    if (!fs.existsSync(backupPath)) {
      // 使用 SQLite Online Backup API(保证 WAL 库一致性,避免 fs.copyFileSync 复制到一半的页)
      db.backup(backupPath);
      console.log(`[backup] 已备份到 ${backupPath}`);
    }
    // 清理 7 天前的旧备份
    const files = fs.readdirSync(backupDir).filter(f => f.startsWith(`${DB_BASE}-`) && f.endsWith(".db"));
    for (const f of files) {
      const m = f.match(new RegExp(`${DB_BASE}-(\\d{4}-\\d{2}-\\d{2})\\.db`));
      if (!m) continue;
      const age = Date.now() - new Date(m[1]).getTime();
      if (age > 7 * 24 * 3600 * 1000) {
        fs.unlinkSync(path.join(backupDir, f));
        console.log(`[backup] 清理旧备份 ${f}`);
      }
    }
  } catch (e) {
    // 备份失败不阻塞启动,只记录
    console.warn(`[backup] 备份失败(不阻塞启动): ${e.message}`);
  }
}
backupDatabase();

// ---- v5 迁移:为旧库补字段(ALTER TABLE ADD COLUMN 是幂等的反向,需要逐列检查) ----
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  return cols.includes(column);
}
function addColumnIfMissing(table, column, def) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def};`);
    console.log(`[migration] ${table}.${column} 已添加`);
  }
}
addColumnIfMissing("agents", "icon_type", "TEXT NOT NULL DEFAULT 'emoji'");
addColumnIfMissing("agents", "icon_value", "TEXT");
addColumnIfMissing("agents", "preferred_provider_id", "TEXT");
addColumnIfMissing("sessions", "difficulty", "TEXT NOT NULL DEFAULT 'normal'");
addColumnIfMissing("sessions", "group_id", "TEXT");
// v6:群面支持
// agent_kind: interviewer(面试官) / candidate(AI 候选人),用于区分群面参与者
addColumnIfMissing("agents", "agent_kind", "TEXT NOT NULL DEFAULT 'interviewer'");
// candidate_persona: 候选人画像(aggressive/calm/leader/follower/challenger/data_driven),仅 candidate 用
addColumnIfMissing("agents", "candidate_persona", "TEXT");
// session_type: interview(单/多面试官) / group(群面)
addColumnIfMissing("sessions", "session_type", "TEXT NOT NULL DEFAULT 'interview'");
// group_config: 群面配置 JSON(候选人数量/画像选择/讨论时长/加速倍率/面试官数量/案例文本)
addColumnIfMissing("sessions", "group_config", "TEXT");
// v7:供应商 seed 版本号,用于一次性迁移(避免每次启动都迁移,覆盖用户手动改回的旧模型名)
addColumnIfMissing("providers", "seed_version", "INTEGER NOT NULL DEFAULT 0");
// v9:软删除字段(误删保护,物理删除改为 UPDATE deleted_at = now())
addColumnIfMissing("agents", "deleted_at", "TEXT");
addColumnIfMissing("providers", "deleted_at", "TEXT");
addColumnIfMissing("materials", "deleted_at", "TEXT");
addColumnIfMissing("sessions", "deleted_at", "TEXT");
addColumnIfMissing("session_groups", "deleted_at", "TEXT");
// v9:token 配额与成本控制(按 IP/用户维度,日预算)
addColumnIfMissing("sessions", "tokens_total", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("sessions", "cost_usd", "REAL NOT NULL DEFAULT 0");

// ---- v11:语音答题与逐题反馈(ALPHA 新增表,向后兼容,老库自动创建) ----
db.exec(`
CREATE TABLE IF NOT EXISTS answer_recordings (
  recording_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT,
  question TEXT NOT NULL,
  audio_path TEXT,
  transcript TEXT NOT NULL DEFAULT '',
  wpm REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_answer_recordings_session ON answer_recordings(session_id, created_at);
CREATE TABLE IF NOT EXISTS question_feedback (
  feedback_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  score REAL,
  weakness_tags TEXT NOT NULL DEFAULT '[]',
  improvement TEXT,
  better_answer TEXT,
  is_missed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_question_feedback_session ON question_feedback(session_id, created_at);
`);

// ---- agents 索引(依赖上面的迁移列 agent_kind,必须放在迁移之后) ----
db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_kind ON agents(agent_kind, is_template, created_at DESC);`);
// v9:软删除过滤索引(常用查询 WHERE deleted_at IS NULL)
db.exec(`
CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_providers_active_sort ON providers(deleted_at, sort_index) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(deleted_at, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_materials_active ON materials(deleted_at, added_at DESC) WHERE deleted_at IS NULL;
`);

export const AGENT_ICON_DIR = ICON_DIR;
export const DB_DIR_EXPORT = DB_DIR;

// v9:健康检查探针(供 /api/health 使用)
export function dbHealthCheck() {
  try {
    db.prepare("SELECT 1").get();
    return { db: "ok" };
  } catch (e) {
    return { db: "fail: " + e.message };
  }
}

// v10:暴露 db 实例(供 index.js 做 token 预算等聚合查询)
export function getDb() { return db; }

// v10:今日 token 用量(供 chat 路由做日预算校验)
// v10.2.4(P0-3):改为从 token_usage 表查(原从 sessions.tokens_total 查,无 sessionId 时漏计)
export function getTodayTokenUsage() {
  try {
    const r = db.prepare("SELECT COALESCE(SUM(tokens), 0) AS t FROM token_usage WHERE date(created_at) = date('now')").get();
    return r?.t || 0;
  } catch (e) {
    // v10.2.5(P2-3):fail-open 时记录 error 级别日志(便于运维发现预算绕过)
    console.error("[token_usage] 预算查询失败(fail-open,可能绕过预算限制):", e.message);
    return 0;
  }
}

// v10.2.4(P0-3):记录 token 用量到独立表(不依赖 sessionId,修复预算绕过)
export function recordTokenUsage(tokens, provider, sessionId) {
  try {
    db.prepare("INSERT INTO token_usage (tokens, provider, session_id) VALUES (?, ?, ?)")
      .run(tokens, provider || null, sessionId || null);
  } catch (e) {
    // 记录失败不影响主流程(但预算校验可能因此不精确)
    console.error("[token_usage] 记录失败:", e.message);
  }
}

// v10.2.5(P0-3 跟进):token_usage 表清理机制
// 防止日积月累导致表膨胀(每次 LLM 调用都写入,长期运行会积累大量记录)
// 启动时清理 30 天前记录 + 每 24h 定时清理
function cleanupTokenUsage() {
  try {
    const r = db.prepare("DELETE FROM token_usage WHERE date(created_at) < date('now', '-30 days')").run();
    if (r.changes > 0) {
      console.log(`[token_usage] 清理 ${r.changes} 条 30 天前旧记录`);
    }
  } catch (e) {
    console.warn(`[token_usage] 清理失败(不阻塞): ${e.message}`);
  }
}
cleanupTokenUsage();
setInterval(cleanupTokenUsage, 24 * 60 * 60 * 1000).unref();

// ---- 工具函数 ----
export function genId(prefix) {
  return `${prefix}_${nanoid(12)}`;
}

// snake_case → camelCase;同时解密敏感字段(api_key)
function camelize(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const camelKey = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (["is_template", "is_degraded", "is_active", "in_failover_queue", "is_missed"].includes(k)) {
      out[camelKey] = !!v;
    } else if (["focus_areas", "parsed_json", "strengths", "weaknesses", "improvements", "group_config", "weakness_tags"].includes(k) && typeof v === "string") {
      try { out[camelKey] = JSON.parse(v); } catch { out[camelKey] = v; }
    } else if (k === "api_key" && typeof v === "string") {
      // 解密:ENC:: 前缀自动解,明文原样返回(向后兼容)
      out[camelKey] = v ? decryptSecret(v) : v;
    } else if (k === "key_value" && typeof v === "string") {
      out[camelKey] = v ? decryptSecret(v) : v;
    } else {
      out[camelKey] = v;
    }
  }
  return out;
}

function camelizeAll(rows) {
  return (rows || []).map(camelize);
}

// ---- Provider(cc-switch 风格) ----
// 查询统一过滤 deleted_at IS NULL;写入时 api_key 加密(ENC:: 前缀)
export function listProviders() {
  return camelizeAll(db.prepare("SELECT * FROM providers WHERE deleted_at IS NULL ORDER BY sort_index ASC, created_at ASC").all());
}

export function getProvider(providerId) {
  return camelize(db.prepare("SELECT * FROM providers WHERE provider_id = ? AND deleted_at IS NULL").get(providerId));
}

export function getActiveProvider() {
  return camelize(db.prepare("SELECT * FROM providers WHERE is_active = 1 AND deleted_at IS NULL LIMIT 1").get());
}

export function getFailoverQueue() {
  return camelizeAll(db.prepare("SELECT * FROM providers WHERE in_failover_queue = 1 AND deleted_at IS NULL ORDER BY failover_priority ASC").all());
}

export function createProvider(input) {
  const providerId = input.providerId || genId("prov");
  // API Key 入库前加密(空值跳过)
  const encryptedKey = input.apiKey ? encryptSecret(input.apiKey) : null;
  db.prepare(`INSERT INTO providers (provider_id, name, category, base_url, api_key, api_format, model_name, icon, icon_color, notes, website_url, sort_index, is_active, in_failover_queue, failover_priority, seed_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(providerId, input.name, input.category || "custom", input.baseUrl, encryptedKey,
      input.apiFormat || "openai_chat", input.modelName || null, input.icon || null,
      input.iconColor || null, input.notes || null, input.websiteUrl || null,
      input.sortIndex || 0, input.isActive ? 1 : 0,
      input.inFailoverQueue ? 1 : 0, input.failoverPriority || 0,
      input.seedVersion || 0);
  return getProvider(providerId);
}

export function updateProvider(providerId, input) {
  const existing = getProvider(providerId);
  if (!existing) return null;
  // API Key 更新:显式传入则加密后覆盖;undefined 保持原值;null/空串表示清空
  let apiKeyValue = null;
  let apiKeySet = "api_key";
  if (input.apiKey !== undefined) {
    apiKeySet = "?";
    apiKeyValue = input.apiKey ? encryptSecret(input.apiKey) : null;
  }
  db.prepare(`UPDATE providers SET
    name = COALESCE(?, name),
    category = COALESCE(?, category),
    base_url = COALESCE(?, base_url),
    api_key = ${apiKeySet},
    api_format = COALESCE(?, api_format),
    model_name = COALESCE(?, model_name),
    icon = COALESCE(?, icon),
    icon_color = COALESCE(?, icon_color),
    notes = COALESCE(?, notes),
    website_url = COALESCE(?, website_url),
    sort_index = COALESCE(?, sort_index),
    in_failover_queue = COALESCE(?, in_failover_queue),
    failover_priority = COALESCE(?, failover_priority),
    seed_version = COALESCE(?, seed_version),
    updated_at = datetime('now')
    WHERE provider_id = ? AND deleted_at IS NULL`)
    .run(
      input.name ?? null, input.category ?? null, input.baseUrl ?? null,
      ...(apiKeySet === "?" ? [apiKeyValue] : []),
      input.apiFormat ?? null, input.modelName ?? null,
      input.icon ?? null, input.iconColor ?? null, input.notes ?? null,
      input.websiteUrl ?? null, input.sortIndex ?? null,
      input.inFailoverQueue === undefined ? null : (input.inFailoverQueue ? 1 : 0),
      input.failoverPriority ?? null,
      input.seedVersion ?? null,
      providerId
    );
  return getProvider(providerId);
}

export function deleteProvider(providerId) {
  // 软删除:标记 deleted_at,保留数据可恢复(物理清除需手动 VACUUM)
  const tx = db.transaction(() => {
    const result = db.prepare("UPDATE providers SET deleted_at = datetime('now'), is_active = 0 WHERE provider_id = ? AND deleted_at IS NULL").run(providerId);
    return result.changes;
  });
  const deleted = tx();
  if (deleted === 0) throw new NotFoundError("供应商");
}

export function setActiveProvider(providerId) {
  const tx = db.transaction(() => {
    db.prepare("UPDATE providers SET is_active = 0").run();
    db.prepare("UPDATE providers SET is_active = 1, updated_at = datetime('now') WHERE provider_id = ?").run(providerId);
  });
  tx();
  return getProvider(providerId);
}

// 兼容旧 api_keys:从 providers 表读取(自动解密)
export function getApiKey(provider) {
  // 先从 providers 表找
  const p = db.prepare("SELECT api_key FROM providers WHERE (provider_id = ? OR name = ?) AND deleted_at IS NULL").get(provider, provider);
  if (p?.api_key) return decryptSecret(p.api_key);
  // 再从旧表找
  const row = db.prepare("SELECT key_value FROM api_keys WHERE provider = ?").get(provider);
  return row?.key_value ? decryptSecret(row.key_value) : null;
}

// ---- Agent ----
// v10:N+1 优化,一次 IN 查询替代循环内 SELECT
export function listAgents(kind) {
  // v6:kind 可选 'interviewer' / 'candidate',不传则返回全部
  // v9:过滤软删除
  const rows = kind
    ? db.prepare("SELECT * FROM agents WHERE agent_kind = ? AND deleted_at IS NULL ORDER BY is_template DESC, created_at DESC").all(kind)
    : db.prepare("SELECT * FROM agents WHERE deleted_at IS NULL ORDER BY is_template DESC, created_at DESC").all();
  if (rows.length === 0) return [];
  const agents = camelizeAll(rows);
  // 批量取 currentVersion(避免 N+1)
  const versionIds = agents.map(a => a.currentVersionId).filter(Boolean);
  if (versionIds.length > 0) {
    const placeholders = versionIds.map(() => "?").join(",");
    const versions = db.prepare(`SELECT * FROM agent_versions WHERE version_id IN (${placeholders})`).all(...versionIds);
    const vMap = new Map(versions.map(v => [v.version_id, v]));
    for (const a of agents) {
      if (a.currentVersionId) {
        a.currentVersion = camelize(vMap.get(a.currentVersionId));
      }
    }
  }
  return agents;
}

export function getAgent(agentId) {
  const a = camelize(db.prepare("SELECT * FROM agents WHERE agent_id = ? AND deleted_at IS NULL").get(agentId));
  if (a?.currentVersionId) {
    a.currentVersion = camelize(db.prepare("SELECT * FROM agent_versions WHERE version_id = ?").get(a.currentVersionId));
  }
  return a;
}

export function createAgent(input) {
  if (!input?.name) throw new ValidationError("name 为必填");
  if (!input?.role) throw new ValidationError("role 为必填");
  if (!input?.promptTemplate) throw new ValidationError("promptTemplate 为必填");
  // v10:agentId 格式校验(防路径穿越);未传则用 nanoid 生成
  // 格式约束:^[a-zA-Z0-9_-]{1,32}$(与 AgentSchema 一致)
  const agentId = input.agentId || genId("agent");
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(agentId)) {
    throw new ValidationError("agentId 格式不合法(仅允许字母数字下划线短横线,1-32 字符)");
  }
  const versionId = genId("ver");
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO agents (agent_id, user_id, name, avatar, role, current_version_id, is_template, icon_type, icon_value, preferred_provider_id, agent_kind, candidate_persona) VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(agentId, input.name, input.avatar || null, input.role, versionId, input.isTemplate ? 1 : 0,
        input.iconType || "emoji", input.iconValue || null, input.preferredProviderId || null,
        input.agentKind || "interviewer", input.candidatePersona || null);
    db.prepare(`INSERT INTO agent_versions (version_id, agent_id, version_no, tone, focus_areas, difficulty, prompt_template) VALUES (?, ?, 1, ?, ?, ?, ?)`)
      .run(versionId, agentId, input.tone || "neutral", JSON.stringify(input.focusAreas || []), input.difficulty || 5, input.promptTemplate);
  });
  tx();
  return getAgent(agentId);
}

export function createAgentVersion(agentId, input) {
  if (!input?.promptTemplate) throw new ValidationError("promptTemplate 为必填");
  const versionId = genId("ver");
  const maxNo = db.prepare("SELECT MAX(version_no) as m FROM agent_versions WHERE agent_id = ?").get(agentId)?.m || 0;
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO agent_versions (version_id, agent_id, version_no, tone, focus_areas, difficulty, prompt_template, changelog) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(versionId, agentId, maxNo + 1, input.tone || "neutral", JSON.stringify(input.focusAreas || []), input.difficulty || 5, input.promptTemplate, input.changelog || null);
    db.prepare("UPDATE agents SET current_version_id = ? WHERE agent_id = ?").run(versionId, agentId);
  });
  tx();
  return camelize(db.prepare("SELECT * FROM agent_versions WHERE version_id = ?").get(versionId));
}

// 切换 Agent 当前生效版本
export function setAgentCurrentVersion(agentId, versionId) {
  const agent = getAgent(agentId);
  if (!agent) throw new NotFoundError("Agent");
  const ver = db.prepare("SELECT * FROM agent_versions WHERE version_id = ? AND agent_id = ?").get(versionId, agentId);
  if (!ver) throw new NotFoundError("版本");
  db.prepare("UPDATE agents SET current_version_id = ? WHERE agent_id = ?").run(versionId, agentId);
  return getAgent(agentId);
}

export function updateAgentBasic(agentId, input) {
  const { name, avatar, role, iconType, iconValue, preferredProviderId, agentKind, candidatePersona } = input || {};
  if (!name) throw new ValidationError("name 为必填");
  if (!role) throw new ValidationError("role 为必填");
  const existing = getAgent(agentId);
  if (!existing) throw new NotFoundError("Agent");
  if (existing.isTemplate) throw new ValidationError("模板 Agent 不可修改");
  // preferredProviderId: undefined=不改,null/""=清空,其他值=更新
  const providerValue = preferredProviderId === undefined
    ? { mode: "keep" }
    : { mode: "set", value: preferredProviderId ? String(preferredProviderId) : null };
  // candidatePersona: undefined=不改,null/""=清空,其他值=更新
  const personaValue = candidatePersona === undefined
    ? { mode: "keep" }
    : { mode: "set", value: candidatePersona ? String(candidatePersona) : null };
  db.prepare(`UPDATE agents SET
    name = ?,
    avatar = COALESCE(?, avatar),
    role = ?,
    icon_type = COALESCE(?, icon_type),
    icon_value = COALESCE(?, icon_value),
    preferred_provider_id = ${providerValue.mode === "keep" ? "preferred_provider_id" : "?"},
    agent_kind = COALESCE(?, agent_kind),
    candidate_persona = ${personaValue.mode === "keep" ? "candidate_persona" : "?"}
    WHERE agent_id = ?`)
    .run(name, avatar ?? null, role,
      iconType ?? null, iconValue ?? null,
      ...(providerValue.mode === "set" ? [providerValue.value] : []),
      agentKind ?? null,
      ...(personaValue.mode === "set" ? [personaValue.value] : []),
      agentId);
}

export function deleteAgent(agentId) {
  // v9:软删除(保留 agent_versions 与历史会话引用,数据可恢复)
  const tx = db.transaction(() => {
    const result = db.prepare("UPDATE agents SET deleted_at = datetime('now') WHERE agent_id = ? AND is_template = 0 AND deleted_at IS NULL").run(agentId);
    return result.changes;
  });
  const deleted = tx();
  if (deleted === 0) throw new ValidationError("无法删除模板 Agent 或 Agent 不存在");
}

// ---- Session ----
const VALID_DIFFICULTIES = ["easy", "normal", "hard", "extreme", "hell"];
const VALID_SESSION_TYPES = ["interview", "group"];
export function createSession(input) {
  if (!input?.title) throw new ValidationError("title 为必填");
  if (!input?.modelId) throw new ValidationError("modelId 为必填");
  const difficulty = input.difficulty && VALID_DIFFICULTIES.includes(input.difficulty) ? input.difficulty : "normal";
  const sessionType = input.sessionType && VALID_SESSION_TYPES.includes(input.sessionType) ? input.sessionType : "interview";
  const sessionId = genId("sess");
  const groupConfig = input.groupConfig ? JSON.stringify(input.groupConfig) : null;
  db.prepare(`INSERT INTO sessions (session_id, title, model_id, flow_template, difficulty, group_id, session_type, group_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, input.title, input.modelId, input.flowTemplate || null, difficulty, input.groupId || null, sessionType, groupConfig);
  return camelize(db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId));
}

export function getSession(sessionId) {
  return camelize(db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId));
}

export function listSessions() {
  return camelizeAll(db.prepare("SELECT * FROM sessions WHERE status != 'archived' AND deleted_at IS NULL ORDER BY updated_at DESC").all());
}

export function updateSessionModel(sessionId, modelId) {
  if (!getSession(sessionId)) throw new NotFoundError("会话");
  db.prepare("UPDATE sessions SET model_id = ?, updated_at = datetime('now') WHERE session_id = ?").run(modelId, sessionId);
}

// 阶段推进:更新 current_stage
export function updateSessionStage(sessionId, stage) {
  if (!getSession(sessionId)) throw new NotFoundError("会话");
  const stageNum = Number(stage);
  if (isNaN(stageNum) || stageNum < 0 || !Number.isInteger(stageNum)) {
    throw new ValidationError("stage 必须为非负整数");
  }
  db.prepare("UPDATE sessions SET current_stage = ?, updated_at = datetime('now') WHERE session_id = ?").run(stageNum, sessionId);
}

export function addSessionAgent(sessionId, agentId, agentVersionId, roleInSession = "primary") {
  if (!agentId) throw new ValidationError("agentId 为必填");
  const session = getSession(sessionId);
  if (!session) throw new NotFoundError("会话");
  const agent = getAgent(agentId);
  if (!agent) throw new NotFoundError("Agent");
  db.prepare(`INSERT OR REPLACE INTO session_agents (session_id, agent_id, agent_version_id, role_in_session) VALUES (?, ?, ?, ?)`)
    .run(sessionId, agentId, agentVersionId || agent.currentVersionId || null, roleInSession);
}

export function listSessionAgents(sessionId) {
  return camelizeAll(db.prepare("SELECT * FROM session_agents WHERE session_id = ?").all(sessionId));
}

// ---- Message ----
export function addMessage(input) {
  if (!input?.role) throw new ValidationError("role 为必填");
  if (!input?.content) throw new ValidationError("content 为必填");
  if (input.content.length > 100000) throw new ValidationError("消息内容过长(超过 100KB)");
  // PII 脱敏后入库,避免手机号/邮箱/身份证明文落库
  const { redacted } = redactPii(input.content);
  const messageId = genId("msg");
  db.prepare(`INSERT INTO messages (message_id, session_id, agent_id, agent_version_id, role, content, model_version, tokens_in, tokens_out, stage, is_degraded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(messageId, input.sessionId, input.agentId || null, input.agentVersionId || null,
      input.role, redacted, input.modelVersion || null,
      input.tokensIn || 0, input.tokensOut || 0, input.stage || 0, input.isDegraded ? 1 : 0);
  return camelize(db.prepare("SELECT * FROM messages WHERE message_id = ?").get(messageId));
}

export function listMessages(sessionId) {
  return camelizeAll(db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId));
}

// ---- Material ----
export function createMaterial(input) {
  if (!input?.rawText) throw new ValidationError("rawText 为必填");
  if (!input?.type) throw new ValidationError("type 为必填");
  if (!input?.sourceType) throw new ValidationError("sourceType 为必填");
  const materialId = genId("mat");
  // PII 脱敏:资料入库时也需脱敏,与 addMessage 保持一致
  const { redacted } = redactPii(input.rawText);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO materials (material_id, type, source_type, source_ref, title, char_count) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(materialId, input.type, input.sourceType, input.sourceRef || null, input.title || null, redacted.length);
    db.prepare("INSERT INTO material_contents (material_id, raw_text, parsed_json) VALUES (?, ?, ?)")
      .run(materialId, redacted, input.parsedJson || null);
  });
  tx();
  return camelize(db.prepare("SELECT * FROM materials WHERE material_id = ?").get(materialId));
}

export function listMaterials() {
  return camelizeAll(db.prepare("SELECT * FROM materials WHERE deleted_at IS NULL ORDER BY added_at DESC").all());
}

export function getMaterialContent(materialId) {
  return camelize(db.prepare("SELECT * FROM material_contents WHERE material_id = ?").get(materialId));
}

// v9:软删除(保留历史会话引用的资料可恢复)
export function deleteMaterial(materialId) {
  const tx = db.transaction(() => {
    const result = db.prepare("UPDATE materials SET deleted_at = datetime('now') WHERE material_id = ? AND deleted_at IS NULL").run(materialId);
    return result.changes;
  });
  const deleted = tx();
  if (deleted === 0) throw new NotFoundError("资料");
}

// ---- Evaluation ----
export function createEvaluation(input) {
  if (input?.overallScore === undefined) throw new ValidationError("overallScore 为必填");
  if (!input?.report) throw new ValidationError("report 为必填");
  const overall = Number(input.overallScore);
  if (isNaN(overall) || overall < 0 || overall > 10) throw new ValidationError("overallScore 必须为 0-10 的数字");
  for (const d of (input.dimensions || [])) {
    const score = Number(d.score);
    if (isNaN(score) || score < 1 || score > 5) throw new ValidationError(`维度 ${d.dimensionName} 的 score 必须为 1-5 的数字`);
    if (!d.dimensionName || !String(d.dimensionName).trim()) throw new ValidationError("dimensionName 不能为空");
  }
  const evaluationId = genId("eval");
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO evaluations (evaluation_id, session_id, agent_version_id, model_version, overall_score, report, improvement_advice, better_answer_sample, tokens_consumed, generation_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(evaluationId, input.sessionId, input.agentVersionId || null, input.modelVersion || null,
        overall, input.report, input.improvementAdvice || null,
        input.betterAnswerSample || null, input.tokensConsumed || 0, input.generationMs || 0);
    for (const d of (input.dimensions || [])) {
      db.prepare("INSERT INTO evaluation_dimensions (evaluation_id, dimension_name, score, weight, comment) VALUES (?, ?, ?, ?, ?)")
        .run(evaluationId, d.dimensionName, Number(d.score), d.weight || 1.0, d.comment || null);
    }
  });
  tx();
  const evalRow = camelize(db.prepare("SELECT * FROM evaluations WHERE evaluation_id = ?").get(evaluationId));
  evalRow.dimensions = camelizeAll(db.prepare("SELECT * FROM evaluation_dimensions WHERE evaluation_id = ?").all(evaluationId));
  return evalRow;
}

// v10:N+1 优化,批量取 dimensions
export function listEvaluations(sessionId) {
  const evals = camelizeAll(db.prepare("SELECT * FROM evaluations WHERE session_id = ? ORDER BY generated_at DESC").all(sessionId));
  attachDimensionsBatch(evals);
  return evals;
}

// 全局评估查询(跨会话,按时间倒序,用于进步曲线)
export function listAllEvaluations(limit = 100) {
  const evals = camelizeAll(db.prepare("SELECT * FROM evaluations ORDER BY generated_at DESC LIMIT ?").all(limit));
  attachDimensionsBatch(evals);
  return evals;
}

// 批量附加 dimensions(避免 N+1)
function attachDimensionsBatch(evals) {
  if (evals.length === 0) return;
  const ids = evals.map(e => e.evaluationId);
  const placeholders = ids.map(() => "?").join(",");
  const dims = db.prepare(`SELECT * FROM evaluation_dimensions WHERE evaluation_id IN (${placeholders})`).all(...ids);
  const dimMap = new Map();
  for (const d of dims) {
    if (!dimMap.has(d.evaluation_id)) dimMap.set(d.evaluation_id, []);
    dimMap.get(d.evaluation_id).push(d);
  }
  for (const e of evals) {
    e.dimensions = camelizeAll(dimMap.get(e.evaluationId) || []);
  }
}

// ---- v5:阶段-Agent 绑定 ----
// 保存某阶段的 Agent 绑定(覆盖式)
export function saveStageAgents(sessionId, stageIndex, agents) {
  if (!getSession(sessionId)) throw new NotFoundError("会话");
  if (!Number.isInteger(stageIndex) || stageIndex < 0) throw new ValidationError("stageIndex 必须为非负整数");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM session_stage_agents WHERE session_id = ? AND stage_index = ?").run(sessionId, stageIndex);
    for (const a of (agents || [])) {
      if (!a.agentId) throw new ValidationError("agentId 为必填");
      db.prepare(`INSERT INTO session_stage_agents (session_id, stage_index, agent_id, role_in_stage, ask_mode, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(sessionId, stageIndex, a.agentId, a.roleInStage || "primary", a.askMode || "sequential", a.sortOrder || 0);
    }
  });
  tx();
  return listStageAgents(sessionId, stageIndex);
}

export function listStageAgents(sessionId, stageIndex) {
  if (stageIndex === undefined) {
    return camelizeAll(db.prepare("SELECT * FROM session_stage_agents WHERE session_id = ? ORDER BY stage_index ASC, sort_order ASC").all(sessionId));
  }
  return camelizeAll(db.prepare("SELECT * FROM session_stage_agents WHERE session_id = ? AND stage_index = ? ORDER BY sort_order ASC").all(sessionId, stageIndex));
}

export function deleteStageAgents(sessionId, stageIndex) {
  db.prepare("DELETE FROM session_stage_agents WHERE session_id = ? AND stage_index = ?").run(sessionId, stageIndex);
}

// ---- v5:整场面试回顾评价 ----
export function createSessionReview(input) {
  if (!input?.sessionId) throw new ValidationError("sessionId 为必填");
  if (input?.overallScore === undefined) throw new ValidationError("overallScore 为必填");
  if (!getSession(input.sessionId)) throw new NotFoundError("会话");
  const reviewId = genId("rev");
  db.prepare(`INSERT INTO session_reviews (review_id, session_id, overall_score, strengths, weaknesses, improvements, performance, next_focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(reviewId, input.sessionId, Number(input.overallScore),
      JSON.stringify(input.strengths || []),
      JSON.stringify(input.weaknesses || []),
      JSON.stringify(input.improvements || []),
      input.performance || null,
      input.nextFocus || null);
  return getSessionReview(input.sessionId);
}

export function getSessionReview(sessionId) {
  return camelize(db.prepare("SELECT * FROM session_reviews WHERE session_id = ? ORDER BY generated_at DESC LIMIT 1").get(sessionId));
}

export function listAllSessionReviews() {
  return camelizeAll(db.prepare("SELECT * FROM session_reviews ORDER BY generated_at DESC").all());
}

// ---- v5:会话分组 ----
export function createSessionGroup(input) {
  if (!input?.name) throw new ValidationError("name 为必填");
  const groupId = genId("grp");
  db.prepare(`INSERT INTO session_groups (group_id, name, description, color, sort_order) VALUES (?, ?, ?, ?, ?)`)
    .run(groupId, input.name, input.description || null, input.color || "#4D6BFE", input.sortOrder || 0);
  return getSessionGroup(groupId);
}

export function getSessionGroup(groupId) {
  return camelize(db.prepare("SELECT * FROM session_groups WHERE group_id = ? AND deleted_at IS NULL").get(groupId));
}

export function listSessionGroups() {
  return camelizeAll(db.prepare("SELECT * FROM session_groups WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC").all());
}

export function updateSessionGroup(groupId, input) {
  const existing = getSessionGroup(groupId);
  if (!existing) throw new NotFoundError("分组");
  db.prepare(`UPDATE session_groups SET
    name = COALESCE(?, name),
    description = COALESCE(?, description),
    color = COALESCE(?, color),
    sort_order = COALESCE(?, sort_order),
    summary = COALESCE(?, summary),
    summary_generated_at = COALESCE(?, summary_generated_at)
    WHERE group_id = ?`)
    .run(input.name ?? null, input.description ?? null, input.color ?? null,
      input.sortOrder ?? null, input.summary ?? null, input.summaryGeneratedAt ?? null,
      groupId);
  return getSessionGroup(groupId);
}

export function deleteSessionGroup(groupId) {
  // v9:软删除 + 解除会话归属
  const tx = db.transaction(() => {
    db.prepare("UPDATE sessions SET group_id = NULL WHERE group_id = ?").run(groupId);
    db.prepare("UPDATE session_groups SET deleted_at = datetime('now') WHERE group_id = ? AND deleted_at IS NULL").run(groupId);
  });
  tx();
}

// 设置会话所属分组(groupId 为 null 表示移到未分组)
export function setSessionGroup(sessionId, groupId) {
  if (!getSession(sessionId)) throw new NotFoundError("会话");
  if (groupId !== null) {
    if (!getSessionGroup(groupId)) throw new NotFoundError("分组");
  }
  db.prepare("UPDATE sessions SET group_id = ?, updated_at = datetime('now') WHERE session_id = ?").run(groupId, sessionId);
}

// 列出某分组下的所有会话
export function listSessionsByGroup(groupId) {
  return camelizeAll(db.prepare("SELECT * FROM sessions WHERE group_id = ? AND status != 'archived' AND deleted_at IS NULL ORDER BY updated_at DESC").all(groupId));
}

// 列出未分组会话
export function listUngroupedSessions() {
  return camelizeAll(db.prepare("SELECT * FROM sessions WHERE (group_id IS NULL OR group_id = '') AND status != 'archived' AND deleted_at IS NULL ORDER BY updated_at DESC").all());
}

// ---- v5:Agent 图标文件存取 ----
// v10:路径穿越防护 + 禁用 svg(svg 可含脚本,且 magic bytes 校验需排除)
export function saveAgentIcon(agentId, buffer, ext) {
  if (!agentId) throw new ValidationError("agentId 为必填");
  // v10:agentId 格式校验(防路径穿越,与 AgentSchema 一致)
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(agentId)) {
    throw new ValidationError("Invalid agent id");
  }
  // v10:svg 不再允许(可含脚本,且 magic bytes 校验不适用)
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "png";
  // 清理旧图标(不同扩展名)
  for (const old of ["jpg", "jpeg", "png", "webp"]) {
    const oldPath = path.join(ICON_DIR, `${agentId}.${old}`);
    if (fs.existsSync(oldPath) && old !== safeExt) {
      try { fs.unlinkSync(oldPath); } catch {}
    }
  }
  // v10:路径穿越防护:最终路径必须在 ICON_DIR 内
  const full = path.resolve(ICON_DIR, `${agentId}.${safeExt}`);
  const iconDirResolved = path.resolve(ICON_DIR) + path.sep;
  if (!full.startsWith(iconDirResolved)) {
    throw new Error("Invalid agent id");
  }
  fs.writeFileSync(full, buffer);
  // 同步更新 agents 表:icon_type=uploaded, icon_value=文件扩展名
  db.prepare("UPDATE agents SET icon_type = 'uploaded', icon_value = ? WHERE agent_id = ?").run(safeExt, agentId);
  return safeExt;
}

export function getAgentIconPath(agentId) {
  // v10:agentId 格式校验(防路径穿越)
  if (!agentId || !/^[a-zA-Z0-9_-]{1,32}$/.test(agentId)) return null;
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const p = path.join(ICON_DIR, `${agentId}.${ext}`);
    if (fs.existsSync(p)) return { path: p, ext };
  }
  return null;
}

// ---- 兼容旧 API Keys ----
export function saveApiKey(provider, key) {
  // v9:加密后入库
  const enc = key ? encryptSecret(key) : null;
  db.prepare(`INSERT OR REPLACE INTO api_keys (provider, key_value, updated_at) VALUES (?, ?, datetime('now'))`).run(provider, enc);
}

export function deleteApiKey(provider) {
  db.prepare("DELETE FROM api_keys WHERE provider = ?").run(provider);
}

// v10:listApiKeyProviders 返回 mask 后的 key(不返回明文,避免通过 /api/keys 泄露)
function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return "***";
  return key.slice(0, 3) + "***" + key.slice(-4);
}
export function listApiKeyProviders() {
  return db.prepare("SELECT provider, key_value FROM api_keys").all().map(r => {
    const key = r.key_value ? decryptSecret(r.key_value) : null;
    return { provider: r.provider, maskedKey: maskKey(key), hasKey: !!key };
  });
}

// ---- 自定义错误类 ----
// v10.2:ValidationError 携带 code + i18nKey + i18nParams(供前端 i18n 映射)
export class ValidationError extends Error {  constructor(message, opts = {}) {
    super(message);
    this.name = "ValidationError";
    this.code = opts.code;
    this.i18nKey = opts.i18nKey;
    this.i18nParams = opts.i18nParams;
  }
}

export class NotFoundError extends Error {
  constructor(resource) {
    super(`${resource}不存在`);
    this.name = "NotFoundError";
  }
}

// ---- v11:语音答题与逐题反馈 ----
export function createAnswerRecording(input) {
  const { sessionId, agentId, question, audioPath, transcript, wpm, durationMs, model } = input;
  const id = genId("rec");
  db.prepare(
    `INSERT INTO answer_recordings (recording_id, session_id, agent_id, question, audio_path, transcript, wpm, duration_ms, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sessionId, agentId || null, question, audioPath || null, transcript || "", wpm || 0, durationMs || 0, model || "");
  return { recordingId: id };
}

export function listAnswerRecordings(sessionId) {
  return db.prepare(
    `SELECT recording_id, session_id, agent_id, question, audio_path, transcript, wpm, duration_ms, model, created_at
     FROM answer_recordings WHERE session_id = ? ORDER BY created_at ASC`
  ).all(sessionId);
}

export function createQuestionFeedback(input) {
  const { sessionId, question, answer, score, weaknessTags, improvement, betterAnswer, isMissed } = input;
  const id = genId("fb");
  db.prepare(
    `INSERT INTO question_feedback (feedback_id, session_id, question, answer, score, weakness_tags, improvement, better_answer, is_missed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, sessionId, question || "", answer || "",
    score ?? null, JSON.stringify(weaknessTags || []),
    improvement || null, betterAnswer || null, isMissed ? 1 : 0
  );
  return { feedbackId: id };
}

export function listQuestionFeedback(sessionId) {
  return camelizeAll(
    db.prepare(
      `SELECT feedback_id, session_id, question, answer, score, weakness_tags, improvement, better_answer, is_missed, created_at
       FROM question_feedback WHERE session_id = ? ORDER BY created_at ASC`
    ).all(sessionId)
  ).map((r) => ({
    ...r,
    // camelize 已处理 weakness_tags(JSON)与 is_missed(bool),此处兜底保证形状稳定
    weakness_tags: undefined,
  }));
}

export function setQuestionMissed(feedbackId, isMissed) {
  db.prepare(`UPDATE question_feedback SET is_missed = ? WHERE feedback_id = ?`).run(isMissed ? 1 : 0, feedbackId);
  return { ok: true };
}

export function deleteQuestionFeedback(feedbackId) {
  db.prepare(`DELETE FROM question_feedback WHERE feedback_id = ?`).run(feedbackId);
  return { ok: true };
}
