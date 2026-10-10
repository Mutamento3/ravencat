/**
 * RavenCat companion_state 迁移链验证：正规化兼容多种历史 shape + 连续启动两次无 churn。
 *
 * 背景：迁移46 曾无条件给 raven_cat_companion_state 补建 wake-plan 五列并回填，
 * 而迁移72b 已退役这批列（Self Wake 有自己的持久真值）。于是每个 boot：
 * 46 加回来 → 72b 再退役（物理重建）→ 下次 boot 重复，形成无限 churn。
 *
 * 收口方式：
 * 1. 迁移71 对自己的 source schema 负责（缺列落 NULL），任何合法历史 shape 都能正规化；
 * 2. 迁移46 不再复活已退役列；
 * 3. 迁移72b 继续负责最终退役。
 *
 * 本 verifier 跑真实 `runMigrations()`（不是切片段），并且**连续跑两次**：
 * 只验证"旧库 → runMigrations → 最终 schema 正确"抓不到 churn，必须断言第二次启动
 * 既不 ALTER companion_state，也不出现 `raven_cat_companion_state_new` 这种重建 SQL。
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQLITE_DIR = 'src/platform/persistence/sqlite';
const tempDir = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'companion-state-migration-'));

// ---- 把整个 sqlite 目录转成 CommonJS 临时副本（迁移链的真实模块图）----
for (const entry of fs.readdirSync(path.join(ROOT, SQLITE_DIR))) {
  if (!entry.endsWith('.ts')) continue;
  const sourcePath = path.join(ROOT, SQLITE_DIR, entry);
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  fs.writeFileSync(path.join(tempDir, entry.replace(/\.ts$/, '.js')), output, 'utf8');
}
const { SCHEMAS } = require(path.join(tempDir, 'schema.js'));
const { runMigrations } = require(path.join(tempDir, 'migrations.js'));

const T = '2026-01-01T00:00:00.000Z';
const STATE_ID = 'companion-state-1';

/** 目标结构：迁移72b 之后的 CompanionState 核心列。 */
const FINAL_COLUMNS = [
  'id',
  'desired_enabled',
  'activation_status',
  'schedule_revision',
  'host_ai_id',
  'last_failure_code',
  'last_failure_at',
  'created_at',
  'updated_at',
];
/** 迁移46 曾 ALTER 添加的 wake-plan 列。 */
const WAKE_PLAN_COLUMNS = [
  'desired_wake_at',
  'continuity_deadline',
  'effective_wake_at',
  'wake_intent_summary',
  'wake_adjustment_reason',
];
/** 旧版共享 schema 常量带过、已由迁移72b 退役的列。 */
const LEGACY_WAKE_COLUMNS = ['next_wake_at', 'next_wake_source'];
/** 迁移71 用来判断"需要正规化"的历史 marker 列。 */
const REBUILD_MARKER_COLUMNS = [
  'activation_revision',
  'quota_window_id',
  'quota_day_key',
  'quota_reset_at',
  'recovery_wake_at',
  'active_attempt_id',
  'last_plan_succeeded_at',
];

function createRecorder(db) {
  const statements = [];
  return {
    statements,
    getFirstAsync: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
    runAsync: async (sql, params = []) => {
      statements.push(sql);
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    execAsync: async (sql) => {
      statements.push(sql);
      db.exec(sql);
    },
  };
}

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => row.name);
const hasCompanionStateRebuild = (statements) =>
  statements.some((sql) => sql.includes('raven_cat_companion_state_new'));
const hasCompanionStateAddColumn = (statements) =>
  statements.some((sql) => /ALTER TABLE raven_cat_companion_state\s+ADD COLUMN/i.test(sql));

/** 按 shape 覆写 companion_state：核心九列恒在（全历史无 ALTER 触及），只叠加该版本的可选列。 */
function applyCompanionStateShape(db, columns) {
  db.exec(`
    DROP TABLE IF EXISTS raven_cat_companion_state;
    CREATE TABLE raven_cat_companion_state (
      id TEXT PRIMARY KEY,
      desired_enabled INTEGER NOT NULL DEFAULT 0 CHECK (desired_enabled IN (0, 1)),
      activation_status TEXT NOT NULL DEFAULT 'disabled',
      schedule_revision INTEGER NOT NULL DEFAULT 0,
      host_ai_id TEXT,
      last_failure_code TEXT,
      last_failure_at TEXT,
      ${columns.map((name) => `${name} TEXT`).join(',\n      ')}${columns.length > 0 ? ',' : ''}
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function seedCompanionStateRow(db, columns) {
  const valueFor = (name) => {
    switch (name) {
      case 'id': return STATE_ID;
      case 'desired_enabled': return 1;
      case 'activation_status': return 'enabled';
      case 'schedule_revision': return 3;
      case 'created_at':
      case 'updated_at': return T;
      default:
        return WAKE_PLAN_COLUMNS.includes(name) || LEGACY_WAKE_COLUMNS.includes(name)
          ? 'legacy-value'
          : null;
    }
  };
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(
    `INSERT INTO raven_cat_companion_state (${columns.join(', ')}) VALUES (${placeholders})`,
  ).run(...columns.map(valueFor));
}

function createBootDatabase(shapeColumns) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const sql of Object.values(SCHEMAS)) db.exec(sql);
  if (shapeColumns !== null) applyCompanionStateShape(db, shapeColumns);
  seedCompanionStateRow(db, columnsOf(db, 'raven_cat_companion_state'));
  return db;
}

async function migrateCapturingWarnings(db) {
  const recorder = createRecorder(db);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((value) => String(value)).join(' '));
  };
  try {
    await runMigrations(recorder);
  } finally {
    console.warn = originalWarn;
  }
  return { statements: recorder.statements, warnings };
}

const SHAPES = [
  { name: 'fresh（共享 schema 常量建表）', columns: null, expectsRetirementOnFirstBoot: false },
  { name: 'post-72b（当前形态，已退役列全无）', columns: [], expectsRetirementOnFirstBoot: false },
  {
    name: 'pre-46（只有 legacy wake 列，无 wake-plan / 无 71 marker）',
    columns: [...LEGACY_WAKE_COLUMNS],
    expectsRetirementOnFirstBoot: true,
  },
  {
    name: 'post-46（wake-plan 五列 + legacy wake 列都在）',
    columns: [...WAKE_PLAN_COLUMNS, ...LEGACY_WAKE_COLUMNS],
    expectsRetirementOnFirstBoot: true,
  },
  {
    name: '危险 shape（71 marker 在，wake-plan 五列不在）',
    columns: [...REBUILD_MARKER_COLUMNS],
    expectsRetirementOnFirstBoot: true,
  },
];

for (const shape of SHAPES) {
  const db = createBootDatabase(shape.columns);

  // ---- 第一次启动：允许退役，但不得硬失败 ----
  const first = await migrateCapturingWarnings(db);
  assert.deepEqual(
    first.warnings.filter((line) => line.includes('continuity and message group migration failed')),
    [],
    `${shape.name}：迁移46 不得再报 next_wake_at 缺失`,
  );
  assert.deepEqual(
    columnsOf(db, 'raven_cat_companion_state'),
    FINAL_COLUMNS,
    `${shape.name}：第一次启动后必须正规化到最终 CompanionState 结构`,
  );
  const firstRow = db.prepare(
    `SELECT desired_enabled AS enabled, activation_status AS status,
            schedule_revision AS revision, created_at AS createdAt
     FROM raven_cat_companion_state WHERE id = ?`,
  ).get(STATE_ID);
  assert.deepEqual(
    { ...firstRow },
    { enabled: 1, status: 'enabled', revision: 3, createdAt: T },
    `${shape.name}：正规化/退役必须保留生命周期事实`,
  );
  assert.equal(
    hasCompanionStateRebuild(first.statements),
    shape.expectsRetirementOnFirstBoot,
    shape.expectsRetirementOnFirstBoot
      ? `${shape.name}：第一次启动必须真的退役 legacy wake 列`
      : `${shape.name}：第一次启动就不该重建 companion_state`,
  );

  // ---- 第二次启动：churn 必须彻底消失 ----
  const second = await migrateCapturingWarnings(db);
  assert.equal(
    hasCompanionStateRebuild(second.statements),
    false,
    `${shape.name}：第二次启动不得再重建 raven_cat_companion_state（这就是 churn）`,
  );
  assert.equal(
    hasCompanionStateAddColumn(second.statements),
    false,
    `${shape.name}：第二次启动不得再给 companion_state 加任何列`,
  );
  assert.deepEqual(
    columnsOf(db, 'raven_cat_companion_state'),
    FINAL_COLUMNS,
    `${shape.name}：第二次启动后结构必须不变`,
  );
  assert.deepEqual(
    { ...db.prepare(
      `SELECT desired_enabled AS enabled, activation_status AS status, schedule_revision AS revision
       FROM raven_cat_companion_state WHERE id = ?`,
    ).get(STATE_ID) },
    { enabled: 1, status: 'enabled', revision: 3 },
    `${shape.name}：第二次启动不得破坏状态行`,
  );
  db.close();
}

// ---- Self Wake 真值表与退役结果必须共存 ----
{
  const db = createBootDatabase([...WAKE_PLAN_COLUMNS, ...LEGACY_WAKE_COLUMNS]);
  await migrateCapturingWarnings(db);
  const selfWakeTables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'raven_cat_self_wakes'`,
  ).all();
  assert.equal(selfWakeTables.length, 0, '迁移72a 的 Self Wake 真值表必须存在');
  assert.deepEqual(
    columnsOf(db, 'raven_cat_companion_state').filter((column) => (
      WAKE_PLAN_COLUMNS.includes(column) || LEGACY_WAKE_COLUMNS.includes(column)
    )),
    [],
    '迁移72b 退役后 companion_state 不得残留任何 wake 单值列',
  );
  db.close();
}

fs.rmSync(tempDir, { recursive: true, force: true });
console.log(
  'CompanionState 迁移链验证通过（fresh / post-72b / pre-46 / post-46 / 71-marker 危险 shape，'
  + '连续两次 runMigrations 均无 churn）',
);
