/**
 * RavenCat legacy ContactTrace 物理存储退役回归。
 *
 * 覆盖三类数据库终态：
 *   A. fresh 初始化后 sqlite_master 中不存在 raven_cat_contact_traces；
 *   B. legacy DB（预置表 + 历史 row + trace indexes）经 forward cleanup 后无表无索引；
 *   C. 历史迁移重新进入（31 重新建表）后，forward cleanup 仍收敛到最终无表状态，且重复执行不报错。
 *
 * 与 verify-group-conversation-identity-sqlite.mjs 相同，本 fixture 不运行完整 production
 * migration runner，而是按 marker 切片并转译被验证的历史迁移（31）与末尾 forward cleanup（73），
 * 在 node:sqlite 隔离实例上证明「历史 create → final cleanup」的顺序语义。
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
// 切片提取：迁移 31（历史建表）与迁移 73（末尾 forward cleanup）
// ============================================================================
function sliceMigration(marker, nextMarker) {
  const markerIndex = migrationsSource.indexOf(marker);
  assert.ok(markerIndex > 0, `migrations.ts 必须存在标记：${marker}`);
  const finalBraceIndex = migrationsSource.trimEnd().length - 1;
  const nextMigrationIndex = nextMarker ? migrationsSource.indexOf(nextMarker, markerIndex) : -1;
  const endIndex = nextMigrationIndex > markerIndex ? nextMigrationIndex : finalBraceIndex;
  return migrationsSource.slice(markerIndex, endIndex);
}

const migration31Body = sliceMigration(
  '// Migration 31: RavenCat proactive contact durable trace log',
  '// Migration 32:',
);
const migration73Body = sliceMigration(
  '// 迁移73：退役 legacy ContactTrace 物理存储。',
  '// 迁移74：',
);

const { runMigration31 } = await import(transpileToModuleUrl(
  `export async function runMigration31(db) {\n${migration31Body}\n}`,
));
const { runMigration73 } = await import(transpileToModuleUrl(
  `export async function runMigration73(db) {\n${migration73Body}\n}`,
));

/** 把 node:sqlite 实例适配成迁移代码期望的异步执行器。 */
function createAdapter(db) {
  return {
    execAsync: async (sql) => {
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

const TABLE = 'raven_cat_contact_traces';

function tableExists(db) {
  return db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(TABLE) !== undefined;
}

function traceIndexNames(db) {
  return db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%'`,
  ).all(TABLE).map((row) => row.name);
}

// ============================================================================
// 0. Fresh schema 收敛：schema.ts 不再定义表与任何 trace index
// ============================================================================
{
  const schemaSource = read('src/platform/persistence/sqlite/schema.ts');
  assert.doesNotMatch(schemaSource, /ravenCatContactTraces/, 'fresh schema 不得再定义 ravenCatContactTraces');
  assert.doesNotMatch(schemaSource, /raven_cat_contact_traces/, 'fresh schema 不得再出现 contact trace 表名');
  assert.doesNotMatch(schemaSource, /idx_raven_cat_contact_traces/, 'fresh INDEXES 不得再定义 trace index');
}

// ============================================================================
// A. fresh：空库直接执行 forward cleanup 不报错，且无表
// ============================================================================
{
  const db = new DatabaseSync(':memory:');
  await runMigration73(createAdapter(db));
  assert.equal(tableExists(db), false, 'fresh cleanup 后不得存在 contact trace 表');
  db.close();
}

// ============================================================================
// B. legacy：预置完整历史表 + row + 三个 trace indexes，cleanup 后无表无索引
// ============================================================================
{
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE raven_cat_contact_traces (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      wake_reason TEXT,
      route TEXT,
      ai_id TEXT,
      session_id TEXT,
      native_wake_event_id TEXT,
      contact_episode_id TEXT,
      block_reason TEXT,
      action_stage TEXT,
      action_outcome TEXT,
      evidence_code TEXT,
      acknowledged_at TEXT,
      message_ids_json TEXT NOT NULL DEFAULT '[]',
      points_before_json TEXT,
      points_after_json TEXT,
      ai_visible_explanation TEXT,
      user_notice TEXT,
      message_preview TEXT,
      vision_route TEXT,
      ocr_succeeded INTEGER,
      degraded INTEGER,
      error_category TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_raven_cat_contact_traces_created_at
      ON raven_cat_contact_traces(created_at DESC);
    CREATE INDEX idx_raven_cat_contact_traces_kind
      ON raven_cat_contact_traces(kind, created_at DESC);
    CREATE INDEX idx_raven_cat_contact_traces_episode
      ON raven_cat_contact_traces(contact_episode_id, created_at ASC);
    INSERT INTO raven_cat_contact_traces (
      id, kind, wake_reason, route, ai_id, session_id, created_at
    ) VALUES (
      'trace-legacy', 'proactive_contact', 'system_timer', 'message',
      'host-ai', 'session-legacy', '2026-08-01T00:00:00.000Z'
    );
  `);
  assert.equal(tableExists(db), true, 'legacy 预置必须存在 contact trace 表');
  assert.deepEqual(
    traceIndexNames(db).sort(),
    [
      'idx_raven_cat_contact_traces_created_at',
      'idx_raven_cat_contact_traces_episode',
      'idx_raven_cat_contact_traces_kind',
    ],
  );

  await runMigration73(createAdapter(db));

  assert.equal(tableExists(db), false, 'legacy DB 清理后不得存在 contact trace 表');
  assert.deepEqual(traceIndexNames(db), [], 'trace indexes 必须随表一并删除');
  db.close();
}

// ============================================================================
// C. 历史迁移重新进入 + final cleanup：重复 bootstrap 仍收敛到无表状态
// ============================================================================
{
  const db = new DatabaseSync(':memory:');
  const adapter = createAdapter(db);

  // 第一次 bootstrap：历史迁移 31 重新建表，末尾 forward cleanup 删除。
  await runMigration31(adapter);
  assert.equal(tableExists(db), true, '历史迁移 31 必须重新创建 contact trace 表');
  assert.deepEqual(
    traceIndexNames(db).sort(),
    ['idx_raven_cat_contact_traces_created_at', 'idx_raven_cat_contact_traces_kind'],
  );
  await runMigration73(adapter);
  assert.equal(tableExists(db), false, '历史建表后 forward cleanup 必须收敛到无表');

  // 第二次 bootstrap：完整 pipeline 重复执行仍不报错，且最终无表。
  await runMigration31(adapter);
  assert.equal(tableExists(db), true, '重复 bootstrap 时历史迁移 31 仍会重新建表');
  await runMigration73(adapter);
  assert.equal(tableExists(db), false, '重复 bootstrap 后 forward cleanup 仍必须收敛到无表');
  assert.deepEqual(traceIndexNames(db), [], '重复 bootstrap 后不得残留 trace indexes');
  db.close();
}

console.log('RavenCat legacy ContactTrace 物理存储退役回归通过。');
