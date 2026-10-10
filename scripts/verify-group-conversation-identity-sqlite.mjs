/**
 * 群聊统一 conversation identity 的 node:sqlite 迁移契约测试。
 *
 * 依赖仓库统一的 Node 22.13+ 运行时与内置 node:sqlite；环境不满足时必须失败。
 *
 * 静态架构契约由必跑脚本执行：
 *   npm run verify:group-conversation-identity
 *
 * 真实 expo-sqlite 外键迁移仍需 Android 真机 fresh database 验收。
 */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function transpileToModuleUrl(sourceText) {
  const output = ts.transpileModule(sourceText, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
}

const migrationsSource = read('src/platform/persistence/sqlite/migrations.ts');

// ============================================================================
// 提取迁移 54 源码并编译为可执行函数
// ============================================================================
const migration54Marker = '// 迁移54';
const markerIndex = migrationsSource.indexOf(migration54Marker);
assert.ok(markerIndex > 0, 'migrations.ts 必须存在迁移54 注释');
const finalBraceIndex = migrationsSource.trimEnd().length - 1;
assert.equal(migrationsSource[finalBraceIndex], '}', 'runMigrations 必须以右大括号结尾');
// 迁移 54 不再是最后一个迁移：本 fixture 只执行迁移 54，切片到下一个迁移注释为止。
const nextMigrationIndex = migrationsSource.indexOf('// 迁移55');
const migration54End = nextMigrationIndex > markerIndex ? nextMigrationIndex : finalBraceIndex;
const migration54Body = migrationsSource.slice(markerIndex, migration54End);
const moduleUrl = transpileToModuleUrl(
  `export async function runMigration54(db) {\n${migration54Body}\n}`,
);
const { runMigration54 } = await import(moduleUrl);

/** 把 node:sqlite 实例适配成迁移代码期望的异步执行器。 */
function createAdapter(db, options = {}) {
  const { failOnSql } = options;
  return {
    execAsync: async (sql) => {
      if (failOnSql && failOnSql(sql)) {
        throw new Error('injected migration failure');
      }
      db.exec(sql);
    },
    getFirstAsync: async (sql) => {
      const rows = db.prepare(sql).all();
      return rows.length > 0 ? rows[0] : null;
    },
    getAllAsync: async (sql) => db.prepare(sql).all(),
    runAsync: async (sql, params = []) => db.prepare(sql).run(...params),
  };
}

/** 旧库结构：messages 外键指向 sessions(id)，尚无 chat_conversations。 */
function createLegacyDatabase(extraSql = '') {
  const db = new DatabaseSync(':memory:');
  // 历史数据中存在群聊消息以 group_chats.id 写入 messages.session_id 的形态，
  // 与当时未启用外键约束的旧版本一致；迁移会负责重建外键并重新开启约束。
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      ai_assistant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      last_message TEXT,
      last_time TEXT,
      is_active INTEGER DEFAULT 1,
      is_pinned INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE group_chats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      last_message TEXT,
      last_time TEXT,
      is_pinned INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      agent_id TEXT,
      client_message_id TEXT,
      text TEXT NOT NULL,
      is_me INTEGER NOT NULL,
      sender_type TEXT,
      api_message_id TEXT,
      time TEXT,
      created_at TEXT NOT NULL,
      show_time_separator_before INTEGER DEFAULT 0,
      updated_at TEXT,
      reply_to_id INTEGER,
      reply_to_text TEXT,
      logical_message_id TEXT,
      segment_index INTEGER DEFAULT 0,
      segment_total INTEGER DEFAULT 1,
      delivery_status TEXT DEFAULT 'delivered',
      status TEXT DEFAULT 'sent',
      tokens_used INTEGER DEFAULT 0,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      metadata_json TEXT,
      is_read INTEGER DEFAULT 0,
      voice_played_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
  const insertSession = db.prepare(`
    INSERT INTO sessions (id, ai_assistant_id, name, last_message, last_time, is_active, is_pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSession.run('s1', 'ai1', '会话1', 'hello', '2026-08-01T00:00:00.000Z', 1, 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
  insertSession.run('s2', 'ai1', '会话2', null, null, 0, 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
  db.prepare(`
    INSERT INTO group_chats (id, name, avatar, last_message, last_time, is_pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('g1', '群聊1', null, null, null, 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');

  const insertMessage = db.prepare(`
    INSERT INTO messages (id, session_id, agent_id, client_message_id, text, is_me, sender_type, api_message_id, time, created_at, show_time_separator_before, updated_at, reply_to_id, reply_to_text, logical_message_id, segment_index, segment_total, delivery_status, status, tokens_used, prompt_tokens, completion_tokens, metadata_json, is_read)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMessage.run(10, 's1', 'ai1', 'c1', '第一条', 1, 'user', null, '10:00', '2026-08-01T10:00:00.000Z', 1, '2026-08-01T10:00:00.000Z', null, null, null, 0, 1, 'delivered', 'sent', 0, 0, 0, null, 1);
  insertMessage.run(20, 'g1', 'ai2', 'c2', '群消息', 0, 'assistant', null, '11:00', '2026-08-01T11:00:00.000Z', 0, '2026-08-01T11:00:00.000Z', null, null, null, 0, 1, 'delivered', 'sent', 0, 0, 0, null, 0);
  if (extraSql) {
    db.exec(extraSql);
  }
  return db;
}

// 测试 1：干净旧库迁移成功，回填 identity 并重建 messages 外键
{
  const db = createLegacyDatabase();
  await runMigration54(createAdapter(db));

  assert.deepEqual(
    db.prepare('SELECT id, kind FROM chat_conversations ORDER BY id').all()
      .map((row) => ({ id: row.id, kind: row.kind })),
    [
      { id: 'g1', kind: 'group' },
      { id: 's1', kind: 'direct' },
      { id: 's2', kind: 'direct' },
    ],
    'identity 必须按详情行回填 direct/group',
  );
  const fkList = db.prepare(`PRAGMA foreign_key_list('messages')`).all();
  assert.deepEqual(
    fkList.map((fk) => ({ table: fk.table, from: fk.from, to: fk.to, on_delete: fk.on_delete })),
    [{ table: 'chat_conversations', from: 'session_id', to: 'id', on_delete: 'CASCADE' }],
    'messages 外键必须指向 chat_conversations(id) 且 ON DELETE CASCADE',
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 2, '消息数量必须完整保留');
  assert.equal(db.prepare('SELECT MAX(id) AS m FROM messages').get().m, 20, '历史最大 id 必须保留');
  assert.equal(
    db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'messages'").get().seq,
    20,
    'AUTOINCREMENT 序列必须恢复到最大 id',
  );
  const nextId = db.prepare(`
    INSERT INTO messages (session_id, agent_id, client_message_id, text, is_me, sender_type, api_message_id, time, created_at, show_time_separator_before, updated_at, reply_to_id, reply_to_text, logical_message_id, segment_index, segment_total, delivery_status, status, tokens_used, prompt_tokens, completion_tokens, metadata_json, is_read)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('s1', 'ai1', 'c3', '新消息', 1, 'user', null, '12:00', '2026-08-01T12:00:00.000Z', 0, '2026-08-01T12:00:00.000Z', null, null, null, 0, 1, 'delivered', 'sent', 0, 0, 0, null, 1).lastInsertRowid;
  assert.equal(nextId, 21, '下一次插入的 id 不得覆盖历史 id');
  assert.equal(
    db.prepare('PRAGMA foreign_keys').get().foreign_keys,
    1,
    '迁移成功后必须恢复外键约束',
  );
  assert.throws(
    () => db.exec("INSERT INTO chat_conversations (id, kind) VALUES ('x', 'other')"),
    /CHECK/,
    'kind 约束必须拒绝 direct/group 之外的值',
  );
  // identity 级联删除消息。
  db.exec("DELETE FROM chat_conversations WHERE id = 'g1'");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id = 'g1'").get().c,
    0,
    '删除 identity 必须级联删除该 conversation 的 messages',
  );
}

// 测试 2：迁移可重复执行（幂等）
{
  const db = createLegacyDatabase();
  await runMigration54(createAdapter(db));
  await runMigration54(createAdapter(db));
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM chat_conversations').get().c, 3, '重复执行不得重复回填');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 2, '重复执行不得丢失消息');
  const fkList = db.prepare(`PRAGMA foreign_key_list('messages')`).all();
  assert.equal(fkList.length, 1, '重复执行后外键仍然唯一正确');
  assert.equal(fkList[0].table, 'chat_conversations', '重复执行后外键仍指向 chat_conversations');
}

// 测试 3：session/group ID 冲突必须失败并给出冲突 ID
{
  const db = createLegacyDatabase(`
    INSERT INTO group_chats (id, name, avatar, last_message, last_time, is_pinned, created_at, updated_at)
    VALUES ('s1', '冲突群', null, null, null, 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
  `);
  await assert.rejects(
    runMigration54(createAdapter(db)),
    /会话 ID 冲突：s1[\s\S]*同时存在于 sessions 与 group_chats/,
  );
}

// 测试 4：identity kind 冲突必须失败
{
  const db = createLegacyDatabase(`
    CREATE TABLE chat_conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('direct', 'group'))
    );
    INSERT INTO chat_conversations (id, kind) VALUES ('s1', 'group');
  `);
  await assert.rejects(
    runMigration54(createAdapter(db)),
    /会话身份类型冲突[\s\S]*s1/,
  );
}

// 测试 5：携带孤立消息的老数据必须完成迁移——孤儿审计落库后删除，正常消息保留。
// 复现真机故障形态：54 之前的老版本删除会话只删 sessions 行，多个已删会话残留消息。
{
  const db = createLegacyDatabase(`
    INSERT INTO messages (id, session_id, agent_id, client_message_id, text, is_me, sender_type, api_message_id, time, created_at, show_time_separator_before, updated_at, reply_to_id, reply_to_text, logical_message_id, segment_index, segment_total, delivery_status, status, tokens_used, prompt_tokens, completion_tokens, metadata_json, is_read)
    VALUES
      (30, 'nope1', null, null, '孤儿1', 1, 'user', null, '12:00', '2026-08-01T12:00:00.000Z', 0, '2026-08-01T12:00:00.000Z', null, null, null, 0, 1, 'delivered', 'sent', 0, 0, 0, null, 1),
      (31, 'nope1', null, null, '孤儿2', 0, 'assistant', null, '12:01', '2026-08-01T12:01:00.000Z', 0, '2026-08-01T12:01:00.000Z', null, null, null, 0, 1, 'delivered', 'sent', 0, 0, 0, null, 1),
      (32, 'nope2', null, null, '孤儿3', 1, 'user', null, '12:02', '2026-08-01T12:02:00.000Z', 0, '2026-08-01T12:02:00.000Z', null, null, null, 0, 1, 'delivered', 'sent', 0, 0, 0, null, 1);
  `);
  await runMigration54(createAdapter(db));

  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id IN ('nope1', 'nope2')").get().c,
    0,
    '孤立消息必须在审计后删除',
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id IN ('s1', 'g1')").get().c,
    2,
    '归属正常的消息必须完整保留',
  );
  assert.deepEqual(
    db.prepare('SELECT session_id, message_count FROM chat_orphan_message_audit ORDER BY session_id').all()
      .map((row) => ({ session_id: row.session_id, message_count: row.message_count })),
    [
      { session_id: 'nope1', message_count: 2 },
      { session_id: 'nope2', message_count: 1 },
    ],
    '审计表必须按 session 记录被删孤立消息的数量',
  );
  assert.ok(
    db.prepare('SELECT deleted_at FROM chat_orphan_message_audit LIMIT 1').get().deleted_at,
    '审计行必须带删除时间',
  );
  const fkList = db.prepare(`PRAGMA foreign_key_list('messages')`).all();
  assert.equal(fkList[0].table, 'chat_conversations', '删除孤儿后 messages 外键必须完成重建');
  assert.equal(
    db.prepare('PRAGMA foreign_keys').get().foreign_keys,
    1,
    '迁移成功后必须恢复外键约束',
  );
  // 孤儿删除后重复执行必须幂等：消息与审计行数均不变化。
  await runMigration54(createAdapter(db));
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 2, '重复执行不得丢失消息');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM chat_orphan_message_audit').get().c,
    2,
    '重复执行不得重复产生审计行',
  );
}

// 测试 6：无详情的 identity 必须失败
{
  const db = createLegacyDatabase(`
    CREATE TABLE chat_conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('direct', 'group'))
    );
    INSERT INTO chat_conversations (id, kind) VALUES ('ghost', 'direct');
  `);
  await assert.rejects(runMigration54(createAdapter(db)), /无详情[\s\S]*ghost/);
}

// 测试 7：重建中途失败必须回滚并恢复外键约束
{
  const db = createLegacyDatabase();
  const adapter = createAdapter(db, {
    failOnSql: (sql) => sql.includes('ALTER TABLE messages_new RENAME TO messages'),
  });
  await assert.rejects(
    runMigration54(adapter),
    /injected migration failure/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM messages').get().c, 2, '回滚后消息必须完整保留');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'messages_new'").get().c,
    0,
    '回滚必须清理 messages_new 中间表',
  );
  const fkList = db.prepare(`PRAGMA foreign_key_list('messages')`).all();
  assert.equal(fkList[0].table, 'sessions', '回滚后 messages 外键必须保持原状');
  assert.equal(
    db.prepare('PRAGMA foreign_keys').get().foreign_keys,
    1,
    '失败后必须恢复外键约束',
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM chat_conversations').get().c,
    3,
    '回填保持幂等，再次启动可恢复',
  );
}

console.log('群聊统一 conversation identity：node:sqlite 隔离 fixture 验证通过。');
console.log('静态架构契约由必跑脚本 verify:group-conversation-identity 执行；');
console.log('真实 expo-sqlite 外键迁移仍需 Android 真机 fresh database 验收。');
