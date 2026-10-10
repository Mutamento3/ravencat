/**
 * RavenCat legacy raven_cat_proactive user prompt 归档与退役回归。
 *
 * 覆盖五类数据库终态：
 *   A. fresh 库：current CHECK 拒绝 raven_cat_proactive；archive table 存在且为空。
 *   B. legacy 库（旧 CHECK + 正常行 + legacy proactive 行）经迁移75后：
 *      legacy row 离开 active、正常 row 原样保留、archive 恰好一条且字段无损、
 *      active CHECK 收敛、再 INSERT proactive 失败。
 *   C. 重复迁移75 幂等：不报错、archive 不重复、active 无 legacy、正常 prompt 不变。
 *   D. migration42 在已收敛 active table 上重入：普通 prompt 正常生成、
 *      proactive 不进入 active、再次迁移75 不产生 archive 重复污染。
 *   E. 第二次 bootstrap（42 → 75 → 42 → 75）：active legacy count = 0、archive 稳定、无 CHECK failure。
 *
 * 与 verify-raven-cat-contact-trace-retirement.mjs 相同，本 fixture 不运行完整 production
 * migration runner，而是按 marker 切片并转译被验证的历史迁移（42）与末尾 forward migration（75），
 * 在 node:sqlite 隔离实例上证明真实迁移代码的归档 / 收敛语义。
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

// ============================================================================
// 提取真实 PROMPTING_SCHEMA 与迁移42 / 迁移75 源码
// ============================================================================
const schemaSource = read('src/platform/persistence/sqlite/promptingSchema.ts');
const compiledSchema = ts.transpileModule(schemaSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: 'promptingSchema.ts',
}).outputText;
const schemaModule = { exports: {} };
Function('module', 'exports', compiledSchema)(schemaModule, schemaModule.exports);
const PROMPTING_SCHEMA = schemaModule.exports.PROMPTING_SCHEMA;

const migrationsSource = read('src/platform/persistence/sqlite/migrations.ts');

function sliceMigration(marker, nextMarker) {
  const markerIndex = migrationsSource.indexOf(marker);
  assert.ok(markerIndex > 0, `migrations.ts 必须存在标记：${marker}`);
  const finalBraceIndex = migrationsSource.trimEnd().length - 1;
  const nextMigrationIndex = nextMarker ? migrationsSource.indexOf(nextMarker, markerIndex) : -1;
  const endIndex = nextMigrationIndex > markerIndex ? nextMigrationIndex : finalBraceIndex;
  return migrationsSource.slice(markerIndex, endIndex);
}

const migration42Body = sliceMigration(
  '// 迁移42：按 AI 保存语言、内置覆盖和用户提示词；旧编排数据只复制不删除',
  '// 迁移43：',
);
const migration75Body = sliceMigration(
  '// 迁移75：归档并退役 legacy raven_cat_proactive user prompt rows。',
  '// 迁移76：',
);

// 把 PROMPTING_SCHEMA 作为模块级常量注入，迁移42 与迁移75 均引用它。
const { runMigration42, runMigration75 } = await import(transpileToModuleUrl(
  `const PROMPTING_SCHEMA = ${JSON.stringify(PROMPTING_SCHEMA)};\n` +
  `export async function runMigration42(db) {\n${migration42Body}\n}\n` +
  `export async function runMigration75(db) {\n${migration75Body}\n}\n`,
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

// ============================================================================
// fixture helper
// ============================================================================

/** 打开内存库并建立 migration42/75 依赖的基础表。 */
function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE ai_assistants (id TEXT PRIMARY KEY);
    CREATE TABLE group_chats (id TEXT PRIMARY KEY);
    INSERT INTO ai_assistants (id) VALUES ('assistant-1');
    INSERT INTO group_chats (id) VALUES ('group-1');
  `);
  return db;
}

/** 旧 active table 的 DDL：CHECK 允许 raven_cat_proactive。 */
const LEGACY_ACTIVE_TABLE_DDL = `
  CREATE TABLE assistant_user_prompts (
    id TEXT PRIMARY KEY,
    assistant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    condition TEXT NOT NULL DEFAULT 'always'
      CHECK (condition IN ('always', 'private_chat', 'group_chat', 'call', 'moments', 'raven_cat_proactive', 'image_present', 'tools_enabled')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_assistant_user_prompts_order
    ON assistant_user_prompts(assistant_id, condition, sort_order, id);
`;

/** 预置旧 active table：CHECK 允许 raven_cat_proactive。 */
function createLegacyActiveTable(db) {
  db.exec(LEGACY_ACTIVE_TABLE_DDL);
}

/** 建立 source tables 与 legacy active table，并注入 migration42 的 source 数据。 */
function setupLegacyDbWithSources(db) {
  db.exec(PROMPTING_SCHEMA);
  // 用 legacy active table 替换 fresh active table，模拟旧升级库。
  db.exec(`
    DROP TABLE assistant_user_prompts;
    ${LEGACY_ACTIVE_TABLE_DDL}
  `);
  seedMigration42Sources(db);
}

/** 预置 migration42 的真实 source：一个普通 binding + 一个 proactive binding。 */
function seedMigration42Sources(db) {
  db.exec(`
    INSERT INTO prompt_custom_blocks (
      id, name, content, category, default_slot, placement, created_at, updated_at
    ) VALUES
      ('custom-normal', '正常规则', '正常正文', 'user_rules', 'user_rules', 'system', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('custom-proactive', '主动联系规则', '主动联系正文', 'user_rules', 'user_rules', 'system', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

    INSERT INTO prompt_presets (
      id, name, scenario_id, base_preset_id, is_system, created_at, updated_at
    ) VALUES
      ('preset-normal', '正常预设', 'chat.private_reply', NULL, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('preset-proactive', '主动联系预设', 'raven_cat.proactive_message', NULL, 0, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

    INSERT INTO prompt_preset_items (
      id, preset_id, definition_id, slot, sort_order, enabled, created_at, updated_at
    ) VALUES
      ('item-normal', 'preset-normal', 'custom-normal', 'user_rules', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('item-proactive', 'preset-proactive', 'custom-proactive', 'user_rules', 1, 1, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');

    INSERT INTO prompt_bindings (
      id, scenario_id, target_type, target_id, preset_id, created_at, updated_at
    ) VALUES
      ('binding-normal', 'chat.private_reply', 'assistant', 'assistant-1', 'preset-normal', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('binding-proactive', 'raven_cat.proactive_message', 'assistant', 'assistant-1', 'preset-proactive', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
  `);
}

function tableExists(db, name) {
  return db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(name) !== undefined;
}

function activeCreateSql(db) {
  return db.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assistant_user_prompts'`,
  ).get().sql;
}

function activePrompts(db) {
  return db.prepare('SELECT * FROM assistant_user_prompts ORDER BY id').all();
}

function archiveRows(db) {
  return db.prepare('SELECT * FROM assistant_user_prompt_archive ORDER BY source_prompt_id').all();
}

function proactiveActiveCount(db) {
  return db.prepare(
    `SELECT COUNT(*) AS count FROM assistant_user_prompts WHERE condition = 'raven_cat_proactive'`,
  ).get().count;
}

/** node:sqlite 返回 null-prototype row，展开成普通对象以便 deepEqual。 */
function plain(row) {
  return { ...row };
}

// ============================================================================
// A. fresh：current CHECK 拒绝 proactive；archive table 存在且为空
// ============================================================================
{
  const db = openDb();
  db.exec(PROMPTING_SCHEMA);
  assert.throws(() => db.exec(`
    INSERT INTO assistant_user_prompts (
      id, assistant_id, name, content, condition, enabled, sort_order, created_at, updated_at
    ) VALUES ('legacy-proactive', 'assistant-1', '遗留', 'x', 'raven_cat_proactive', 1, 99, 'now', 'now');
  `), /CHECK constraint failed/, 'fresh CHECK 必须拒绝 raven_cat_proactive');
  assert.equal(tableExists(db, 'assistant_user_prompt_archive'), true, 'fresh schema 必须存在 archive table');
  assert.equal(archiveRows(db).length, 0, 'fresh archive 必须为空');
  db.close();
}

// ============================================================================
// B. legacy：旧 CHECK + 正常行 + legacy proactive 行，迁移75 后收敛
// ============================================================================
{
  const db = openDb();
  createLegacyActiveTable(db);
  db.exec(`
    INSERT INTO assistant_user_prompts (
      id, assistant_id, name, content, condition, enabled, sort_order, created_at, updated_at
    ) VALUES
      ('normal-1', 'assistant-1', '正常规则', '正常正文', 'always', 1, 10, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('legacy-proactive', 'assistant-1', '主动联系规则', '主动联系正文', 'raven_cat_proactive', 0, 99, '2026-02-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z');
  `);

  await runMigration75(createAdapter(db));

  // legacy row 离开 active，正常 row 原样保留
  const active = activePrompts(db);
  assert.deepEqual(active.map((row) => row.id), ['normal-1'], 'legacy row 必须离开 active，正常 row 保留');
  assert.deepEqual(
    plain(active[0]),
    {
      id: 'normal-1', assistant_id: 'assistant-1', name: '正常规则', content: '正常正文',
      condition: 'always', enabled: 1, sort_order: 10,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
    },
    '正常 prompt 字段必须原样保留',
  );

  // archive 恰好一条，字段无损
  const archived = archiveRows(db);
  assert.equal(archived.length, 1, 'archive 必须恰好一条');
  const archivedRow = plain(archived[0]);
  assert.deepEqual(
    {
      source_prompt_id: archivedRow.source_prompt_id,
      assistant_id: archivedRow.assistant_id,
      name: archivedRow.name,
      content: archivedRow.content,
      original_condition: archivedRow.original_condition,
      original_enabled: archivedRow.original_enabled,
      original_sort_order: archivedRow.original_sort_order,
      original_created_at: archivedRow.original_created_at,
      original_updated_at: archivedRow.original_updated_at,
      archive_reason: archivedRow.archive_reason,
    },
    {
      source_prompt_id: 'legacy-proactive',
      assistant_id: 'assistant-1',
      name: '主动联系规则',
      content: '主动联系正文',
      original_condition: 'raven_cat_proactive',
      original_enabled: 0,
      original_sort_order: 99,
      original_created_at: '2026-02-01T00:00:00.000Z',
      original_updated_at: '2026-02-02T00:00:00.000Z',
      archive_reason: 'retired_raven_cat_proactive_condition',
    },
    'archive 必须无损保存 name/content/original_condition/enabled/sort_order/timestamps',
  );
  assert.ok(archivedRow.archived_at, 'archive 必须记录 archived_at');

  // active CHECK 收敛到 current contract
  assert.ok(
    !activeCreateSql(db).includes('raven_cat_proactive'),
    'rebuild 后 active table 不得再允许 raven_cat_proactive',
  );
  assert.throws(() => db.exec(`
    INSERT INTO assistant_user_prompts (
      id, assistant_id, name, content, condition, enabled, sort_order, created_at, updated_at
    ) VALUES ('legacy-proactive-2', 'assistant-1', 'x', 'x', 'raven_cat_proactive', 1, 1, 'now', 'now');
  `), /CHECK constraint failed/, '收敛后 INSERT proactive 必须失败');

  // 恢复的 index 仍存在
  assert.ok(
    db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_assistant_user_prompts_order'`,
    ).get() !== undefined,
    'rebuild 后必须恢复 idx_assistant_user_prompts_order',
  );
  db.close();
}

// ============================================================================
// C. 重复迁移75 幂等：不报错、archive 不重复、active 无 legacy、正常 prompt 不变
// ============================================================================
{
  const db = openDb();
  createLegacyActiveTable(db);
  db.exec(`
    INSERT INTO assistant_user_prompts (
      id, assistant_id, name, content, condition, enabled, sort_order, created_at, updated_at
    ) VALUES
      ('normal-1', 'assistant-1', '正常规则', '正常正文', 'always', 1, 10, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
      ('legacy-proactive', 'assistant-1', '主动联系规则', '主动联系正文', 'raven_cat_proactive', 0, 99, '2026-02-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z');
  `);
  const adapter = createAdapter(db);

  await runMigration75(adapter);
  await runMigration75(adapter);

  assert.equal(archiveRows(db).length, 1, '重复迁移不得产生重复 archive row');
  assert.equal(proactiveActiveCount(db), 0, '重复迁移后 active 不得出现 legacy row');
  assert.deepEqual(activePrompts(db).map((row) => row.id), ['normal-1'], '重复迁移后正常 prompt 不变');
  db.close();
}

// ============================================================================
// D. migration42 在已收敛 active table 上重入
// ============================================================================
{
  const db = openDb();
  createLegacyActiveTable(db);
  db.exec(`
    INSERT INTO assistant_user_prompts (
      id, assistant_id, name, content, condition, enabled, sort_order, created_at, updated_at
    ) VALUES ('legacy-proactive', 'assistant-1', '主动联系规则', '主动联系正文', 'raven_cat_proactive', 0, 99, '2026-02-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z');
  `);
  const adapter = createAdapter(db);

  // 先收敛 active table
  await runMigration75(adapter);
  assert.equal(archiveRows(db).length, 1, '初始 legacy row 应已归档');

  // 构造真实 migration42 source，在已收敛的 active table 上重跑真实 migration42
  seedMigration42Sources(db);
  await runMigration42(adapter);

  const activeIds = activePrompts(db).map((row) => row.id);
  assert.ok(activeIds.includes('legacy:binding-normal:custom-normal'), '普通 user prompt 必须正常生成');
  assert.ok(!activeIds.includes('legacy:binding-proactive:custom-proactive'), 'proactive 不得进入 active');
  assert.equal(proactiveActiveCount(db), 0, 'migration42 重入后 active 不得有 proactive');

  // 再次迁移75：active 仍无 legacy，archive 不产生重复污染
  await runMigration75(adapter);
  assert.equal(proactiveActiveCount(db), 0, '再次迁移75 后 active 仍无 legacy');
  assert.equal(archiveRows(db).length, 1, '再次迁移75 不得产生 archive 重复污染');
  db.close();
}

// ============================================================================
// E. 第二次 bootstrap：42 → 75 → 42 → 75
// ============================================================================
{
  const db = openDb();
  setupLegacyDbWithSources(db);
  const adapter = createAdapter(db);

  // 第一次 bootstrap：迁移42 在旧 CHECK 上生成 proactive + 普通行，迁移75 归档并收敛
  await runMigration42(adapter);
  assert.equal(proactiveActiveCount(db), 1, '旧 CHECK 下迁移42 必须生成 proactive row（作为迁移75 的输入）');
  await runMigration75(adapter);
  assert.equal(proactiveActiveCount(db), 0, '第一次 bootstrap 后 proactive 必须离开 active');
  const archiveCountAfterFirst = archiveRows(db).length;
  assert.equal(archiveCountAfterFirst, 1, '第一次 bootstrap 归档恰好一条 proactive');

  // 第二次 bootstrap：迁移42 在已收敛 CHECK 上重入（proactive 被 CHECK 忽略），迁移75 幂等
  await runMigration42(adapter);
  await runMigration75(adapter);

  assert.equal(proactiveActiveCount(db), 0, '第二次 bootstrap 后 active legacy count 必须为 0');
  assert.equal(archiveRows(db).length, archiveCountAfterFirst, '第二次 bootstrap 后 archive 必须稳定');
  assert.ok(
    activePrompts(db).some((row) => row.id === 'legacy:binding-normal:custom-normal'),
    '第二次 bootstrap 后普通 prompt 必须仍在 active',
  );
  db.close();
}

console.log('RavenCat legacy raven_cat_proactive user prompt 归档与退役回归通过。');
