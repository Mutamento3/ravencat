/**
 * RavenCat contact settings 表 legacy contact route columns 退役回归。
 *
 * 覆盖以下终态与重入路径：
 *   A. fresh schema 不再定义三条 route columns，fresh 库全链仍稳定；
 *   B. current-legacy shape（三条 route columns + 全部 live columns + 非默认 live 数据）
 *      经末尾 cleanup 后 route columns 全消失、live 数据原样保留；
 *   C. old historical shape（migration30/71 需要兼容的旧列）经完整迁移链仍能升级，
 *      末尾 cleanup 得到 live-only table，且 71a 黑名单合并仍成立；
 *   D. 第二次 bootstrap：live-only 表再走 migration30 → migration71 → migration74
 *      不报错、migration30 不重补旧列、migration71 不因 enabled_message_route 缺失失败；
 *   E. 第三次/重复 cleanup 仍安全收敛，live 数据仍完整。
 *
 * 与 verify-raven-cat-contact-trace-retirement.mjs 相同，本 fixture 不运行完整
 * production migration runner，而是按 marker 切片并转译被验证的历史迁移（30/71）与
 * 末尾 forward cleanup（74），在 node:sqlite 隔离实例上证明「历史 create → 历史清理
 * → final cleanup」的顺序语义与幂等性。
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
// 切片提取：迁移 30（历史建表 + legacy-shape guard）、迁移 71（旧 shape 清理）
// 与迁移 74（末尾 route columns 退役）
// ============================================================================
function sliceMigration(marker, nextMarker) {
  const markerIndex = migrationsSource.indexOf(marker);
  assert.ok(markerIndex > 0, `migrations.ts 必须存在标记：${marker}`);
  const finalBraceIndex = migrationsSource.trimEnd().length - 1;
  const nextMigrationIndex = nextMarker ? migrationsSource.indexOf(nextMarker, markerIndex) : -1;
  const endIndex = nextMigrationIndex > markerIndex ? nextMigrationIndex : finalBraceIndex;
  return migrationsSource.slice(markerIndex, endIndex);
}

const migration30Body = sliceMigration(
  '// Migration 30: RavenCat proactive contact settings and point ledger',
  '// Migration 31:',
);
const migration71Body = sliceMigration(
  '// 迁移71：退役每日队列、联系尝试账本及其额度字段。',
  '// 迁移72b：',
);
const migration74Body = sliceMigration(
  '// 迁移74：退役 legacy contact route columns。',
  '// 迁移75：',
);

const { runMigration30 } = await import(transpileToModuleUrl(
  `export async function runMigration30(db) {\n${migration30Body}\n}`,
));
const { runMigration71 } = await import(transpileToModuleUrl(
  `export async function runMigration71(db) {\n${migration71Body}\n}`,
));
const { runMigration74 } = await import(transpileToModuleUrl(
  `export async function runMigration74(db) {\n${migration74Body}\n}`,
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

const TABLE = 'raven_cat_contact_settings';
const DEAD_ROUTE_COLUMNS = [
  'enabled_message_route',
  'enabled_screen_then_message_route',
  'enabled_video_call_route',
];
const LIVE_ONLY_COLUMNS = [
  'id',
  'quiet_hours_enabled',
  'quiet_hours_start_minutes',
  'quiet_hours_end_minutes',
  'user_screen_capture_blacklist_json',
  'created_at',
  'updated_at',
];

// 非默认 live 数据，用于证明 cleanup 后 live 值原样保留。
const LIVE_FIXTURE = {
  quiet_hours_enabled: 0,
  quiet_hours_start_minutes: 600,
  quiet_hours_end_minutes: 1320,
  user_screen_capture_blacklist_json: '["com.example.bank","com.example.social"]',
  created_at: '2026-08-29T00:00:00.000Z',
  updated_at: '2026-08-30T12:34:56.000Z',
};

const LIVE_ONLY_CREATE_SQL = `
  CREATE TABLE ${TABLE} (
    id TEXT PRIMARY KEY,
    quiet_hours_enabled INTEGER NOT NULL DEFAULT 1
      CHECK (quiet_hours_enabled IN (0, 1)),
    quiet_hours_start_minutes INTEGER NOT NULL DEFAULT 1380
      CHECK (quiet_hours_start_minutes BETWEEN 0 AND 1439),
    quiet_hours_end_minutes INTEGER NOT NULL DEFAULT 480
      CHECK (quiet_hours_end_minutes BETWEEN 0 AND 1439),
    user_screen_capture_blacklist_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

function columnNames(db) {
  return db.prepare(`PRAGMA table_info('${TABLE}')`).all().map((column) => column.name);
}

function readLiveRow(db) {
  return db.prepare(`
    SELECT id, quiet_hours_enabled, quiet_hours_start_minutes,
           quiet_hours_end_minutes, user_screen_capture_blacklist_json,
           created_at, updated_at
    FROM ${TABLE} WHERE id = 'default'
  `).get();
}

function insertLiveRow(db, fixture) {
  db.prepare(`
    INSERT INTO ${TABLE} (
      id, quiet_hours_enabled, quiet_hours_start_minutes,
      quiet_hours_end_minutes, user_screen_capture_blacklist_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'default',
    fixture.quiet_hours_enabled,
    fixture.quiet_hours_start_minutes,
    fixture.quiet_hours_end_minutes,
    fixture.user_screen_capture_blacklist_json,
    fixture.created_at,
    fixture.updated_at,
  );
}

function assertLiveOnlyShape(db) {
  assert.deepEqual(
    [...columnNames(db)].sort(),
    [...LIVE_ONLY_COLUMNS].sort(),
    '表必须收敛为 live-only 列集合',
  );
}

function assertLiveRowPreserved(db, fixture) {
  const row = readLiveRow(db);
  assert.ok(row, 'live row 必须存在');
  assert.equal(row.quiet_hours_enabled, fixture.quiet_hours_enabled, 'quiet_hours_enabled 必须保留');
  assert.equal(row.quiet_hours_start_minutes, fixture.quiet_hours_start_minutes, 'quiet_hours_start_minutes 必须保留');
  assert.equal(row.quiet_hours_end_minutes, fixture.quiet_hours_end_minutes, 'quiet_hours_end_minutes 必须保留');
  assert.equal(row.user_screen_capture_blacklist_json, fixture.user_screen_capture_blacklist_json, 'user_screen_capture_blacklist_json 必须保留');
  assert.equal(row.created_at, fixture.created_at, 'created_at 必须保留');
  assert.equal(row.updated_at, fixture.updated_at, 'updated_at 必须保留');
}

// ============================================================================
// A. fresh schema：schema.ts 不再定义三条 route columns
// ============================================================================
{
  const schemaSource = read('src/platform/persistence/sqlite/schema.ts');
  for (const column of DEAD_ROUTE_COLUMNS) {
    assert.doesNotMatch(
      schemaSource,
      new RegExp(`\\b${column}\\b`),
      `fresh schema 不得再定义 ${column}`,
    );
  }
}

// ============================================================================
// B. current-legacy shape：三条 route columns + 全部 live columns + 非默认 live 数据
//    → migration74 退役 route columns，live 数据原样保留
// ============================================================================
{
  const db = new DatabaseSync(':memory:');
  const adapter = createAdapter(db);

  db.exec(`
    CREATE TABLE ${TABLE} (
      id TEXT PRIMARY KEY,
      enabled_message_route INTEGER NOT NULL DEFAULT 1,
      enabled_screen_then_message_route INTEGER NOT NULL DEFAULT 0,
      enabled_video_call_route INTEGER NOT NULL DEFAULT 1,
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 1
        CHECK (quiet_hours_enabled IN (0, 1)),
      quiet_hours_start_minutes INTEGER NOT NULL DEFAULT 1380
        CHECK (quiet_hours_start_minutes BETWEEN 0 AND 1439),
      quiet_hours_end_minutes INTEGER NOT NULL DEFAULT 480
        CHECK (quiet_hours_end_minutes BETWEEN 0 AND 1439),
      user_screen_capture_blacklist_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  insertLiveRow(db, LIVE_FIXTURE);
  assert.ok(
    DEAD_ROUTE_COLUMNS.every((column) => columnNames(db).includes(column)),
    'current-legacy 预置必须包含三条 route columns',
  );

  await runMigration74(adapter);

  assertLiveOnlyShape(db);
  assertLiveRowPreserved(db, LIVE_FIXTURE);
  db.close();
}

// ============================================================================
// C. old historical shape：migration30/71 需要兼容的旧列 → 完整链 30 → 71 → 74
//    升级成功，末尾 cleanup 得到 live-only table，71a 黑名单合并仍成立
// ============================================================================
{
  const db = new DatabaseSync(':memory:');
  const adapter = createAdapter(db);

  db.exec(`
    CREATE TABLE ${TABLE} (
      id TEXT PRIMARY KEY,
      proactive_contact_enabled INTEGER NOT NULL DEFAULT 1,
      enabled_message_route INTEGER NOT NULL DEFAULT 1,
      enabled_screen_then_message_route INTEGER NOT NULL DEFAULT 0,
      enabled_video_call_route INTEGER NOT NULL DEFAULT 1,
      screen_capture_unobstructed_mode_enabled INTEGER NOT NULL DEFAULT 0,
      screen_capture_app_blacklist_json TEXT NOT NULL DEFAULT '["com.android.settings","com.android.permissioncontroller","com.google.android.permissioncontroller"]',
      screen_capture_retention_policy TEXT NOT NULL DEFAULT 'discard_after_use',
      global_contact_points INTEGER NOT NULL DEFAULT 20,
      last_point_recovery_at TEXT,
      quiet_hours_start_minutes INTEGER NOT NULL DEFAULT 1380
        CHECK (quiet_hours_start_minutes BETWEEN 0 AND 1439),
      quiet_hours_end_minutes INTEGER NOT NULL DEFAULT 480
        CHECK (quiet_hours_end_minutes BETWEEN 0 AND 1439),
      user_screen_capture_blacklist_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO ${TABLE} (
      id, proactive_contact_enabled, enabled_message_route,
      enabled_screen_then_message_route, enabled_video_call_route,
      screen_capture_unobstructed_mode_enabled, screen_capture_app_blacklist_json,
      screen_capture_retention_policy, global_contact_points, last_point_recovery_at,
      quiet_hours_start_minutes, quiet_hours_end_minutes,
      user_screen_capture_blacklist_json, created_at, updated_at
    ) VALUES (
      'default', 1, 1, 0, 1, 1,
      '["com.android.settings","com.android.permissioncontroller","com.google.android.permissioncontroller","com.example.bank","com.example.social"]',
      'discard_after_use', 20, '2026-08-01T00:00:00.000Z',
      600, 1320, '["com.example.existing"]',
      '2026-08-29T00:00:00.000Z', '2026-08-30T12:34:56.000Z'
    );
  `);

  await runMigration30(adapter);
  await runMigration71(adapter);
  await runMigration74(adapter);

  assertLiveOnlyShape(db);
  const row = readLiveRow(db);
  // 旧 shape 不含 quiet_hours_enabled，migration71 用默认值 1 兜底。
  assert.equal(row.quiet_hours_enabled, 1, '旧 shape 无 quiet_hours_enabled 时应兜底为 1');
  assert.equal(row.quiet_hours_start_minutes, 600, 'quiet_hours_start_minutes 必须保留');
  assert.equal(row.quiet_hours_end_minutes, 1320, 'quiet_hours_end_minutes 必须保留');
  assert.equal(row.created_at, '2026-08-29T00:00:00.000Z', 'created_at 必须保留');
  assert.equal(row.updated_at, '2026-08-30T12:34:56.000Z', 'updated_at 必须保留');
  // 71a：旧 screen_capture_app_blacklist_json 中的用户包合并进 user_screen_capture_blacklist_json，
  // 系统保护包被过滤。
  assert.deepEqual(
    JSON.parse(row.user_screen_capture_blacklist_json),
    ['com.example.bank', 'com.example.existing', 'com.example.social'],
    '71a 黑名单合并结果必须正确',
  );
  db.close();
}

// ============================================================================
// D/E. 第二次/第三次 bootstrap：live-only 表重复走 30 → 71 → 74 仍安全收敛，
//      migration30 不重补旧列，migration71 不因 enabled_message_route 缺失失败
// ============================================================================
{
  const db = new DatabaseSync(':memory:');
  const adapter = createAdapter(db);

  db.exec(LIVE_ONLY_CREATE_SQL);
  insertLiveRow(db, LIVE_FIXTURE);

  for (let round = 1; round <= 3; round += 1) {
    await runMigration30(adapter);
    assertLiveOnlyShape(db);
    assert.ok(
      !columnNames(db).some((column) => DEAD_ROUTE_COLUMNS.includes(column)),
      `第 ${round} 次 bootstrap 后 migration30 不得重新补回 route columns`,
    );

    await runMigration71(adapter);
    assertLiveOnlyShape(db);

    await runMigration74(adapter);
    assertLiveOnlyShape(db);
    assertLiveRowPreserved(db, LIVE_FIXTURE);
  }

  db.close();
}

console.log('RavenCat contact settings legacy route columns 退役回归通过。');
