/**
 * 迁移85 真实升级验证：legacy direct session 收口 + canonical 唯一索引。
 *
 * 覆盖：
 * A 现存 AI 多 session → 只留 canonical（尊重 last_active_session_id 偏好）
 * B owner 已删除的 orphan（同 id 多条）→ 不撞 UNIQUE，identity / messages / 派生事实一并清理
 * C NULL / '' ai_assistant_id 的 orphan → 不阻断初始化
 * D group chat 事实完全不受影响
 * E 幂等：重复执行 + 残留临时表后重跑都安全，且不破坏已建立的数据
 * F fresh DB（空 sessions / 空 ai_assistants）→ 正常建索引
 *
 * 另外校验迁移结束后的稳定不变量与「原子性 / 不留临时表」。
 *
 * 注：本 fixture 刻意做成 legacy 形态（sessions 无 UNIQUE(ai_assistant_id)，
 * ai_assistant_id 无外键、可为 NULL/''），否则无法构造真实旧库的异常 shape。
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const tempDir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'chat-canonical-migration-'));
const T = '2026-01-01T00:00:00.000Z';

// ---- 提取真实迁移85 本体（与其它迁移 verifier 同一模式）----
const migrationsSource = read('src/platform/persistence/sqlite/migrations.ts');
const startIndex = migrationsSource.indexOf('// 迁移85');
const endIndex = migrationsSource.indexOf('// 迁移86');
assert.ok(startIndex > 0, 'migrations.ts 必须存在迁移85 注释');
assert.ok(endIndex > startIndex, 'migrations.ts 必须存在迁移86 注释作为迁移85 的切片终点');
const migrationBody = migrationsSource.slice(startIndex, endIndex);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(
    `export async function runMigration85(db) {\n${migrationBody}\n}`,
    { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
).toString('base64')}`;
const { runMigration85 } = await import(moduleUrl);

function createExecutor(db) {
  return {
    getFirstAsync: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
    runAsync: async (sql, params = []) => {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    execAsync: async (sql) => db.exec(sql),
  };
}

/** legacy 形态建库：sessions 无唯一约束、ai_assistant_id 无外键且可为 NULL。 */
function createLegacyDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE ai_assistants (
      id TEXT PRIMARY KEY, is_host_ai INTEGER NOT NULL DEFAULT 0,
      last_active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, ai_assistant_id TEXT, name TEXT NOT NULL,
      last_message TEXT, last_time TEXT, is_active INTEGER DEFAULT 1,
      is_archived INTEGER DEFAULT 0, archive_reason TEXT, tags TEXT,
      is_pinned INTEGER DEFAULT 0, visible_after_message_id INTEGER, visible_after_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE chat_conversations (id TEXT PRIMARY KEY, kind TEXT NOT NULL);
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      text TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE conversation_turn_runs (
      run_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE conversation_turn_state (
      session_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE call_sessions (
      id TEXT PRIMARY KEY,
      chat_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE call_events (
      id TEXT PRIMARY KEY,
      chat_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE session_vision_helpers (
      episode_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE group_chats (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function addSession(db, id, aiAssistantId, updatedAt = T) {
  db.prepare(
    `INSERT INTO sessions (id, ai_assistant_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, aiAssistantId, id, T, updatedAt);
}

/** 给一个 session 补 direct identity + 消息 + 各类派生事实。 */
function addDirectDetail(db, id, { messages = 1 } = {}) {
  db.prepare(`INSERT INTO chat_conversations (id, kind) VALUES (?, 'direct')`).run(id);
  for (let index = 0; index < messages; index += 1) {
    db.prepare(`INSERT INTO messages (session_id, text, created_at) VALUES (?, ?, ?)`)
      .run(id, `${id}-msg-${index}`, T);
  }
  db.prepare(`INSERT INTO call_sessions (id, chat_session_id, created_at) VALUES (?, ?, ?)`)
    .run(`call-${id}`, id, T);
  db.prepare(`INSERT INTO call_events (id, chat_session_id, created_at) VALUES (?, ?, ?)`)
    .run(`event-${id}`, id, T);
  db.prepare(`INSERT INTO session_vision_helpers (episode_id, session_id, updated_at) VALUES (?, ?, ?)`)
    .run(`episode-${id}`, id, T);
  db.prepare(`INSERT INTO conversation_turn_runs (run_id, session_id, created_at) VALUES (?, ?, ?)`)
    .run(`run-${id}`, id, T);
  db.prepare(`INSERT INTO conversation_turn_state (session_id, updated_at) VALUES (?, ?)`)
    .run(id, T);
}

function addGroupFacts(db) {
  db.prepare(`INSERT INTO chat_conversations (id, kind) VALUES ('group-1', 'group')`).run();
  db.prepare(`INSERT INTO group_chats (id, name, created_at, updated_at) VALUES ('group-1', '群', ?, ?)`).run(T, T);
  db.prepare(`INSERT INTO messages (session_id, text, created_at) VALUES ('group-1', '群消息', ?)`).run(T);
}

const rows = (db, sql, params = []) => db.prepare(sql).all(...params);
const count = (db, sql, params = []) => rows(db, sql, params)[0]?.c ?? 0;

/** 迁移后必须成立的稳定不变量。 */
function assertInvariants(db, label) {
  assert.equal(
    count(db, `SELECT COUNT(*) AS c FROM (
      SELECT ai_assistant_id FROM sessions GROUP BY ai_assistant_id HAVING COUNT(*) > 1
    )`),
    0,
    `${label}：sessions(ai_assistant_id) 不得存在重复值`,
  );
  assert.equal(
    count(db, `SELECT COUNT(*) AS c FROM sessions s
      WHERE s.ai_assistant_id IS NULL
         OR s.ai_assistant_id = ''
         OR NOT EXISTS (SELECT 1 FROM ai_assistants a WHERE a.id = s.ai_assistant_id)`),
    0,
    `${label}：不得残留无 owner 的 direct session`,
  );
  assert.equal(
    count(db, `SELECT COUNT(*) AS c FROM chat_conversations c
      WHERE c.kind = 'direct' AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = c.id)`),
    0,
    `${label}：不得残留没有 sessions 详情的 direct identity`,
  );
  assert.equal(
    count(db, `SELECT COUNT(*) AS c FROM messages m
      WHERE NOT EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = m.session_id)`),
    0,
    `${label}：不得残留孤儿消息`,
  );
  assert.equal(
    rows(db, `PRAGMA foreign_key_check`).length,
    0,
    `${label}：不得存在外键违规`,
  );
  assert.equal(
    count(db, `SELECT COUNT(*) AS c FROM sqlite_temp_master
      WHERE name IN ('canonical_direct_sessions','alternate_direct_sessions','orphan_direct_sessions')`),
    0,
    `${label}：迁移不得留下临时集合`,
  );
  assert.equal(
    count(db, `SELECT COUNT(*) AS c FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_sessions_canonical_ai'`),
    1,
    `${label}：必须建立 canonical 唯一索引`,
  );
}

async function migrate(db) {
  await runMigration85(createExecutor(db));
}

// ============================================================================
// Case A：现存 AI 有 A1/A2 → 只留 canonical，且尊重 last_active_session_id
// ============================================================================
{
  const db = createLegacyDatabase();
  db.prepare(`INSERT INTO ai_assistants (id, is_host_ai, created_at) VALUES ('ai-live', 1, ?)`).run(T);
  // A1 的 updated_at 更新（按 updated_at 排序会选 A1），但 last_active_session_id 指向 A2。
  addSession(db, 'sess-A1', 'ai-live', '2026-02-01T00:00:00.000Z');
  addSession(db, 'sess-A2', 'ai-live', '2026-01-01T00:00:00.000Z');
  db.prepare(`UPDATE ai_assistants SET last_active_session_id = 'sess-A2' WHERE id = 'ai-live'`).run();
  addDirectDetail(db, 'sess-A1', { messages: 2 });
  addDirectDetail(db, 'sess-A2', { messages: 1 });

  await migrate(db);

  assert.deepEqual(
    db.prepare(`SELECT id FROM sessions`).all().map((row) => row.id),
    ['sess-A2'],
    'Case A：同 AI 只允许保留 canonical，且必须尊重 last_active_session_id 偏好',
  );
  assert.equal(
    db.prepare(`SELECT last_active_session_id AS v FROM ai_assistants WHERE id = 'ai-live'`).get().v,
    'sess-A2',
    'Case A：last_active_session_id 必须指向 canonical',
  );
  // alternate 的 identity / messages / 派生事实必须一起消失
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM chat_conversations WHERE id = 'sess-A1'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM messages WHERE session_id = 'sess-A1'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM call_sessions WHERE chat_session_id = 'sess-A1'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM call_events WHERE chat_session_id = 'sess-A1'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM session_vision_helpers WHERE session_id = 'sess-A1'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM conversation_turn_runs WHERE session_id = 'sess-A1'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM conversation_turn_state WHERE session_id = 'sess-A1'`), 0);
  // canonical 自身事实必须完好
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM messages WHERE session_id = 'sess-A2'`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM call_events WHERE chat_session_id = 'sess-A2'`), 1);
  assertInvariants(db, 'Case A');
  db.close();
}

// ============================================================================
// Case B：owner 已删除的 orphan（同 id 多条）→ 不撞 UNIQUE，且完整清理
// ============================================================================
{
  const db = createLegacyDatabase();
  db.prepare(`INSERT INTO ai_assistants (id, is_host_ai, created_at) VALUES ('ai-live', 1, ?)`).run(T);
  addSession(db, 'sess-A1', 'ai-live');
  addDirectDetail(db, 'sess-A1');
  // ai-ghost 已从 ai_assistants 删除，但留下两个 direct session
  addSession(db, 'sess-O1', 'ai-ghost');
  addSession(db, 'sess-O2', 'ai-ghost');
  addDirectDetail(db, 'sess-O1', { messages: 3 });
  addDirectDetail(db, 'sess-O2', { messages: 2 });

  await migrate(db); // 修复前：CREATE UNIQUE INDEX 撞 UNIQUE constraint failed

  assert.deepEqual(
    db.prepare(`SELECT id FROM sessions ORDER BY id`).all().map((row) => row.id),
    ['sess-A1'],
    'Case B：owner 已删除的 orphan direct session 必须被清理',
  );
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM chat_conversations WHERE kind = 'direct' AND id LIKE 'sess-O%'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM messages WHERE session_id LIKE 'sess-O%'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM call_events WHERE chat_session_id LIKE 'sess-O%'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM conversation_turn_state WHERE session_id LIKE 'sess-O%'`), 0);
  assertInvariants(db, 'Case B');
  db.close();
}

// ============================================================================
// Case C：NULL / '' ai_assistant_id 的 legacy orphan
// ============================================================================
{
  const db = createLegacyDatabase();
  db.prepare(`INSERT INTO ai_assistants (id, is_host_ai, created_at) VALUES ('ai-live', 1, ?)`).run(T);
  addSession(db, 'sess-A1', 'ai-live');
  addDirectDetail(db, 'sess-A1');
  addSession(db, 'sess-N1', null);
  addSession(db, 'sess-E1', '');
  addSession(db, 'sess-E2', '');
  addDirectDetail(db, 'sess-N1');
  addDirectDetail(db, 'sess-E1');
  addDirectDetail(db, 'sess-E2');

  await migrate(db);

  assert.deepEqual(
    db.prepare(`SELECT id FROM sessions ORDER BY id`).all().map((row) => row.id),
    ['sess-A1'],
    'Case C：NULL / 空 ai_assistant_id 的 legacy session 必须被清理且不阻断初始化',
  );
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM messages WHERE session_id IN ('sess-N1','sess-E1','sess-E2')`), 0);
  assertInvariants(db, 'Case C');
  db.close();
}

// ============================================================================
// Case D：group chat 事实完全不受影响
// ============================================================================
{
  const db = createLegacyDatabase();
  db.prepare(`INSERT INTO ai_assistants (id, is_host_ai, created_at) VALUES ('ai-live', 1, ?)`).run(T);
  addGroupFacts(db);
  addSession(db, 'sess-A1', 'ai-live');
  addDirectDetail(db, 'sess-A1');
  addSession(db, 'sess-A2', 'ai-live');
  addDirectDetail(db, 'sess-A2');
  db.prepare(`UPDATE ai_assistants SET last_active_session_id = 'sess-A1' WHERE id = 'ai-live'`).run();
  addSession(db, 'sess-O1', 'ai-ghost');
  addDirectDetail(db, 'sess-O1');

  await migrate(db);

  assert.equal(count(db, `SELECT COUNT(*) AS c FROM chat_conversations WHERE id = 'group-1' AND kind = 'group'`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM group_chats WHERE id = 'group-1'`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM messages WHERE session_id = 'group-1'`), 1);
  assert.deepEqual(
    db.prepare(`SELECT id FROM sessions ORDER BY id`).all().map((row) => row.id),
    ['sess-A1'],
    'Case D：group 事实不得参与 direct session 收口',
  );
  assertInvariants(db, 'Case D');
  db.close();
}

// ============================================================================
// Case E：幂等（重复执行 + 残留临时表后重跑），且不破坏已建立的数据
// ============================================================================
{
  const db = createLegacyDatabase();
  db.prepare(`INSERT INTO ai_assistants (id, is_host_ai, created_at) VALUES ('ai-live', 1, ?)`).run(T);
  addSession(db, 'sess-A1', 'ai-live');
  addDirectDetail(db, 'sess-A1');
  addSession(db, 'sess-O1', 'ai-ghost');
  addDirectDetail(db, 'sess-O1');

  await migrate(db);
  // 模拟上一次运行中途失败留下的临时集合，再跑一次必须仍然成功
  db.exec(`
    CREATE TEMP TABLE canonical_direct_sessions (ai_id TEXT, canonical_id TEXT);
    CREATE TEMP TABLE alternate_direct_sessions (id TEXT);
  `);
  // 清除边界属于用户数据，重复迁移不得清掉
  db.prepare(`UPDATE sessions SET visible_after_message_id = 7, visible_after_at = ? WHERE id = 'sess-A1'`).run(T);

  await migrate(db);

  assert.deepEqual(
    db.prepare(`SELECT id FROM sessions ORDER BY id`).all().map((row) => row.id),
    ['sess-A1'],
    'Case E：重复迁移必须保持收敛结果',
  );
  const boundary = db.prepare(`SELECT visible_after_message_id AS m, visible_after_at AS a FROM sessions WHERE id = 'sess-A1'`).get();
  assert.equal(boundary.m, 7, 'Case E：重复迁移不得清掉用户的历史清除边界');
  assert.equal(boundary.a, T, 'Case E：重复迁移不得清掉时间边界');
  assertInvariants(db, 'Case E');
  db.close();
}

// ============================================================================
// Case F：fresh DB（空 sessions / 空 ai_assistants）
// ============================================================================
{
  const db = createLegacyDatabase();
  await migrate(db);
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM sessions`), 0);
  assertInvariants(db, 'Case F');
  db.close();
}

// ============================================================================
// 失败路径必须报出具体阶段（不能只留"迁移85失败"黑盒）
// ============================================================================
{
  const db = createLegacyDatabase();
  db.exec(`DROP TABLE chat_conversations;`); // 让清理阶段必然失败
  let failure = null;
  try {
    await migrate(db);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, '缺失 chat_conversations 时迁移必须失败');
  assert.match(failure.cause?.message ?? '', /迁移85：/, '失败必须带具体阶段名');
  assert.match(failure.message, /迁移85：建立 canonical 单聊与历史边界失败/);
  // 事务必须回滚：基础表仍然可用
  assert.equal(count(db, `SELECT COUNT(*) AS c FROM sessions`), 0);
  db.close();
}

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('迁移85 真实升级验证通过（A 现存多 session / B orphan owner 缺失 / C NULL 空 id / D group 隔离 / E 幂等 / F fresh）');
