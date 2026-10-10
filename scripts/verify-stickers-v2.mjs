/**
 * Sticker System V2 的确定性契约验证。
 *
 * 覆盖设计文档（docs/sticker-system-v2-implementation-plan.md 第 14 节）：
 * - sticker_annotation capability 已从代码与数据库清理；
 * - Sticker System 只保存模型引用，不复制 API Key / Base URL；
 * - recognition 只接受 enabled ocr 配置、embedding 只接受 enabled embedding 配置；
 * - 迁移 84 建立 semantic_revision / sticker_system_config / sticker_embeddings
 *   并删除旧 sticker_annotation binding / model config；
 * - 语义文本、向量有效性、hybrid rerank 与分组浏览分页的纯函数契约；
 * - 第 8 节起在真实 node:sqlite 上跑真实 repository / application 路径：
 *   semantic 候选集不被 UI 列表分页截断、收藏库 500 上限、semanticRevision
 *   三条写路径、无 Buffer 环境的 cursor、当前模型展示投影、模型切换唤醒信号。
 *
 * 真实 expo-sqlite 外键 / Android 真机行为仍需人工验收，见文档第 14 节 UI / queue 部分。
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

async function importSource(relativePath) {
  return import(transpileToModuleUrl(read(relativePath)));
}

// ---------------------------------------------------------------------------
// 1. Model selection / cleanup：capability 与 UI 分类中不存在 sticker_annotation
// ---------------------------------------------------------------------------
const auxiliaryModelModule = await importSource(
  'src/features/assistants/domain/AuxiliaryModel.ts',
);
const capabilityKinds = [...auxiliaryModelModule.CAPABILITY_KINDS];
assert.ok(
  !capabilityKinds.includes('sticker_annotation'),
  'CAPABILITY_KINDS 不得再包含 sticker_annotation',
);

const capabilityMetaModule = await importSource(
  'src/features/assistants/presentation/auxiliaryModels/constants.ts',
);
assert.ok(
  !Object.keys(capabilityMetaModule.CAPABILITY_META).includes('sticker_annotation'),
  '辅助模型中心分类卡不得再出现表情包识别模型',
);

// 全源码层面不允许出现旧 capability（包括 resolver / gateway / binding 特判）。
// 迁移 84 的 DELETE 清理 SQL 与说明性注释是文档明确要求的唯一合法出现位置。
function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return ['.ts', '.tsx', '.mjs'].includes(path.extname(entry.name)) ? [entryPath] : [];
  });
}
function stripCommentLines(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}
const legacyHits = [];
for (const filePath of collectSourceFiles(path.join(ROOT, 'src'))) {
  const source = stripCommentLines(fs.readFileSync(filePath, 'utf8'));
  if (!source.includes('sticker_annotation')) continue;
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.replaceAll('\\', '/') === 'src/platform/persistence/sqlite/migrations.ts') {
    // 清理 SQL 必须只出现在迁移 84 的 DELETE 语句里。
    const activeLines = source.split('\n').filter((line) => line.includes('sticker_annotation'));
    const nonDelete = activeLines.filter((line) => !line.includes('DELETE FROM'));
    assert.deepEqual(
      nonDelete,
      [],
      `migrations.ts 中 sticker_annotation 只能出现在 DELETE 清理语句里: ${nonDelete.join(' | ')}`,
    );
    continue;
  }
  legacyHits.push(relativePath);
}
assert.deepEqual(legacyHits, [], `sticker_annotation 残留于: ${legacyHits.join(', ')}`);

// ---------------------------------------------------------------------------
// 2. Sticker-owned 模型解析规则
// ---------------------------------------------------------------------------
const { evaluateStickerModelConfig } = await importSource(
  'src/features/stickers/domain/StickerSystemConfig.ts',
);

const validOcr = {
  id: 'ocr-1',
  capabilityKind: 'ocr',
  name: '视觉模型',
  enabled: true,
  baseUrl: 'https://example.com/v1',
  apiKey: 'key',
  model: 'vision-model',
  temperature: null,
  topP: null,
  maxTokens: null,
  updatedAt: '2026-09-14T00:00:00.000Z',
};

assert.ok(evaluateStickerModelConfig(null, 'ocr') === null, '未配置模型必须返回 null');
assert.ok(
  evaluateStickerModelConfig({ ...validOcr, enabled: false }, 'ocr') === null,
  'disabled 模型必须被判不可用',
);
assert.ok(
  evaluateStickerModelConfig(validOcr, 'embedding') === null,
  'recognition 不得选择非 ocr 配置',
);
assert.ok(
  evaluateStickerModelConfig({ ...validOcr, capabilityKind: 'embedding' }, 'embedding') !== null,
  'embedding 可以选择 enabled 的 embedding 配置',
);
assert.ok(
  evaluateStickerModelConfig(
    { ...validOcr, capabilityKind: 'embedding', enabled: false },
    'embedding',
  ) === null,
  'embedding 不得选择 disabled 配置',
);

// Sticker System 配置实体只保存模型引用；字段面不含任何连接信息。
const stickerSystemConfigSource = read('src/features/stickers/domain/StickerSystemConfig.ts');
assert.ok(
  !stickerSystemConfigSource.includes('apiKey') || stickerSystemConfigSource.indexOf('apiKey') > stickerSystemConfigSource.indexOf('StickerModelConfigRef'),
  'StickerSystemConfig 实体不得持有 API Key',
);

// ---------------------------------------------------------------------------
// 3. 迁移 84：schema 补齐 + 旧数据清理 + 级联删除
// ---------------------------------------------------------------------------
// 运行真实升级链，不再截取单个迁移函数体冻结当前实现。
const migrationModules = new Map();
function loadMigrationModule(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  if (migrationModules.has(absolutePath)) return migrationModules.get(absolutePath);
  const output = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  migrationModules.set(absolutePath, module.exports);
  new Function('exports', 'require', 'module', output)(module.exports,
    (specifier) => loadMigrationModule(path.resolve(path.dirname(absolutePath), `${specifier}.ts`)), module);
  return module.exports;
}
const { SCHEMAS } = loadMigrationModule('src/platform/persistence/sqlite/schema.ts');
const { runMigrations } = loadMigrationModule('src/platform/persistence/sqlite/migrations.ts');
const stickerSchemaModule = await importSource('src/platform/persistence/sqlite/stickerSchema.ts');

function createAdapter(db) {
  return {
    execAsync: async (sql) => db.exec(sql),
    getFirstAsync: async (sql, params = []) => {
      const rows = db.prepare(sql).all(...params);
      return rows.length > 0 ? rows[0] : null;
    },
    getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
    runAsync: async (sql, params = []) => db.prepare(sql).run(...params),
  };
}

function createLegacyDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const [key, sql] of Object.entries(SCHEMAS)) {
    if (key !== 'stickers' && key !== 'auxiliaryModelConfigs') db.exec(sql);
  }
  // 迁移 81 之后的 sticker 形态：无 semantic_revision。
  db.exec(`
    CREATE TABLE stickers (
      id TEXT PRIMARY KEY NOT NULL,
      media_asset_id TEXT NOT NULL UNIQUE,
      group_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      emotion TEXT,
      source_file_name TEXT,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      is_animated INTEGER NOT NULL DEFAULT 0,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      annotation_status TEXT NOT NULL DEFAULT 'pending',
      annotation_error TEXT,
      annotation_claim_id TEXT,
      annotation_claimed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE auxiliary_model_configs (
      id TEXT PRIMARY KEY NOT NULL,
      capability_kind TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT,
      model TEXT NOT NULL,
      temperature REAL,
      top_p REAL,
      max_tokens INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE capability_bindings (
      capability_kind TEXT NOT NULL,
      model_source TEXT NOT NULL,
      model_config_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (capability_kind)
    );
    CREATE TABLE assistant_capability_bindings (
      assistant_id TEXT NOT NULL,
      capability_kind TEXT NOT NULL,
      model_source TEXT NOT NULL,
      model_config_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (assistant_id, capability_kind)
    );
  `);
  db.prepare(
    `INSERT INTO stickers (id, media_asset_id, name, mime_type, annotation_status, created_at, updated_at)
     VALUES ('sticker-1', 'asset-1', '装无辜', 'image/png', 'ready', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run();
  const insertModel = db.prepare(
    `INSERT INTO auxiliary_model_configs (id, capability_kind, name, base_url, api_key, model, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 'https://example.com/v1', 'key', 'm', 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  );
  insertModel.run('cfg-legacy', 'sticker_annotation', '旧表情包识别模型');
  insertModel.run('cfg-ocr', 'ocr', '视觉模型');
  db.prepare(
    `INSERT INTO capability_bindings (capability_kind, model_source, model_config_id, enabled, updated_at)
     VALUES ('sticker_annotation', 'auxiliary_model', 'cfg-legacy', 1, '2026-09-01T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO assistant_capability_bindings (assistant_id, capability_kind, model_source, model_config_id, enabled, updated_at)
     VALUES ('ai-1', 'sticker_annotation', 'auxiliary_model', 'cfg-legacy', 1, '2026-09-01T00:00:00.000Z')`,
  ).run();
  return db;
}

{
  const db = createLegacyDatabase();
  await runMigrations(createAdapter(db));

  const stickerColumns = db.prepare(`PRAGMA table_info('stickers')`).all().map((c) => c.name);
  assert.ok(stickerColumns.includes('semantic_revision'), 'stickers 必须补齐 semantic_revision');
  const revisionRow = db.prepare(
    `SELECT semantic_revision FROM stickers WHERE id = 'sticker-1'`,
  ).get();
  assert.equal(revisionRow.semantic_revision, 1, '现有 Sticker 的 semantic_revision 必须初始化为 1');

  const configColumns = db.prepare(`PRAGMA table_info('sticker_system_config')`).all().map((c) => c.name);
  assert.deepEqual(
    configColumns.sort(),
    ['created_at', 'embedding_model_config_id', 'id', 'recognition_model_config_id', 'updated_at'],
    'sticker_system_config 只允许模型引用与时间列，不得保存 Base URL / API Key / model name',
  );

  const embeddingColumns = db.prepare(`PRAGMA table_info('sticker_embeddings')`).all().map((c) => c.name);
  for (const required of [
    'sticker_id', 'model_config_id', 'model_config_updated_at', 'semantic_revision',
    'dimension', 'vector_json', 'created_at', 'updated_at',
  ]) {
    assert.ok(embeddingColumns.includes(required), `sticker_embeddings 缺少 ${required}`);
  }

  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM auxiliary_model_configs WHERE capability_kind = 'sticker_annotation'`).get().n,
    0,
    '旧 sticker_annotation model config 必须被清理',
  );
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE name IN ('capability_bindings', 'assistant_capability_bindings')").all(),
    [],
    '旧绑定整体退休，不能留下 sticker_annotation 的默认选择路径',
  );
  assert.ok(
    db.prepare(`SELECT COUNT(*) AS n FROM auxiliary_model_configs WHERE id = 'cfg-ocr'`).get().n === 1,
    'ocr 配置不得被误删',
  );

  // 单例约束 + FK cascade。
  db.prepare(
    `INSERT INTO sticker_system_config (id, recognition_model_config_id, embedding_model_config_id, created_at, updated_at)
     VALUES ('global', 'cfg-ocr', NULL, '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`,
  ).run();
  assert.throws(
    () => db.prepare(
      `INSERT INTO sticker_system_config (id, recognition_model_config_id, embedding_model_config_id, created_at, updated_at)
       VALUES ('other', NULL, NULL, '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`,
    ).run(),
    'sticker_system_config 只允许 global 单例',
  );

  db.prepare(
    `INSERT INTO sticker_embeddings (sticker_id, model_config_id, model_config_updated_at, semantic_revision, dimension, vector_json, created_at, updated_at)
     VALUES ('sticker-1', 'cfg-ocr', '2026-09-14T00:00:00.000Z', 1, 3, '[1,2,3]', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')`,
  ).run();
  db.prepare(`DELETE FROM stickers WHERE id = 'sticker-1'`).run();
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM sticker_embeddings`).get().n,
    0,
    '删除 Sticker 必须级联删除向量',
  );
  db.close();
}

// ---------------------------------------------------------------------------
// 4. 语义文本 / 向量有效性 / 余弦
// ---------------------------------------------------------------------------
const { buildStickerSemanticText, isStickerEmbeddingValid, cosineSimilarity } =
  await importSource('src/features/stickers/domain/StickerEmbedding.ts');

const baseSticker = {
  id: 'sticker-1',
  mediaAssetId: 'asset-1',
  groupId: 'group-1',
  name: '装无辜',
  description: '被抓包以后装无辜的表情',
  tags: ['无辜', '心虚'],
  emotion: '心虚',
  sourceFileName: 'a.png',
  mimeType: 'image/png',
  width: 100,
  height: 100,
  isAnimated: false,
  isFavorite: true,
  useCount: 9,
  lastUsedAt: null,
  annotationStatus: 'ready',
  annotationError: null,
  semanticRevision: 3,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
};

const semanticText = buildStickerSemanticText(baseSticker);
assert.ok(semanticText.includes('名称：装无辜'), '语义文本必须包含名称');
assert.ok(semanticText.includes('描述：'), '语义文本必须包含描述');
assert.ok(semanticText.includes('标签：无辜、心虚'), '语义文本必须包含标签');
assert.ok(semanticText.includes('情绪：心虚'), '语义文本必须包含情绪');
assert.ok(!semanticText.includes('group-1'), '分组不进入语义文本');
assert.ok(!semanticText.includes('a.png'), '文件名不进入语义文本');
assert.ok(!semanticText.includes('sticker-1'), 'stickerId 不进入语义文本');
assert.ok(
  !buildStickerSemanticText({ ...baseSticker, description: null, emotion: null, tags: [] }).includes('undefined'),
  '空字段必须整行省略',
);

const validContext = {
  modelConfigId: 'cfg-ocr',
  modelConfigUpdatedAt: '2026-09-14T00:00:00.000Z',
  semanticRevision: 3,
  dimension: 4,
};
assert.ok(
  isStickerEmbeddingValid(
    { modelConfigId: 'cfg-ocr', modelConfigUpdatedAt: '2026-09-14T00:00:00.000Z', semanticRevision: 3, dimension: 4 },
    validContext,
  ),
  '四元组全部匹配时向量有效',
);
assert.ok(
  !isStickerEmbeddingValid(
    { modelConfigId: 'other', modelConfigUpdatedAt: '2026-09-14T00:00:00.000Z', semanticRevision: 3, dimension: 4 },
    validContext,
  ),
  '模型 ID 不同 -> stale',
);
assert.ok(
  !isStickerEmbeddingValid(
    { modelConfigId: 'cfg-ocr', modelConfigUpdatedAt: '2026-09-15T00:00:00.000Z', semanticRevision: 3, dimension: 4 },
    validContext,
  ),
  '模型配置 updatedAt 不同 -> stale',
);
assert.ok(
  !isStickerEmbeddingValid(
    { modelConfigId: 'cfg-ocr', modelConfigUpdatedAt: '2026-09-14T00:00:00.000Z', semanticRevision: 4, dimension: 4 },
    validContext,
  ),
  'semantic revision 不同 -> stale',
);
assert.ok(
  !isStickerEmbeddingValid(
    { modelConfigId: 'cfg-ocr', modelConfigUpdatedAt: '2026-09-14T00:00:00.000Z', semanticRevision: 3, dimension: 8 },
    validContext,
  ),
  '维度不同 -> 不参与 cosine',
);
assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9, '同向向量余弦为 1');
assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9, '正交向量余弦为 0');

// ---------------------------------------------------------------------------
// 5. Hybrid rerank 与分组浏览分页
// ---------------------------------------------------------------------------
const searchModule = await importSource('src/features/stickers/domain/StickerSearch.ts');
const { rankStickerSearchCandidates, encodeStickerGroupPageCursor, decodeStickerGroupPageCursor } = searchModule;

const ranked = rankStickerSearchCandidates([
  { stickerId: 'weak', lexicalScore: 1, isFavorite: true, useCount: 100 },
  { stickerId: 'semantic-top', semanticScore: 0.95, lexicalScore: 0, isFavorite: false, useCount: 0 },
  { stickerId: 'semantic-mid', semanticScore: 0.8, lexicalScore: 0.5, isFavorite: false, useCount: 3 },
], 10);
assert.equal(ranked[0].stickerId, 'semantic-top', '语义相似度必须主导排序');
assert.ok(
  ranked.findIndex((item) => item.stickerId === 'semantic-mid') < ranked.findIndex((item) => item.stickerId === 'weak'),
  'favorite / 使用历史只能轻微 rerank，不得绕过 semantic / lexical 相关性',
);

const cursorA = encodeStickerGroupPageCursor({ createdAt: '2026-09-01T00:00:00.000Z', stickerId: 'sticker-9' });
assert.deepEqual(
  decodeStickerGroupPageCursor(cursorA),
  { createdAt: '2026-09-01T00:00:00.000Z', stickerId: 'sticker-9' },
  'cursor 编解码必须稳定',
);
assert.ok(decodeStickerGroupPageCursor('not-a-cursor') === null, '非法 cursor 必须按第一页处理');

// ---------------------------------------------------------------------------
// 6. Agent 工具契约（limit、调用顺序提示、snapshot 不含媒体细节）
// ---------------------------------------------------------------------------
const agentToolsSource = read('src/features/stickers/aiTools/StickerAgentTools.ts');
assert.ok(
  agentToolsSource.includes("name: 'list_sticker_groups'"),
  '必须注册 list_sticker_groups 工具',
);
assert.ok(
  agentToolsSource.includes("name: 'list_stickers_in_group'"),
  '必须注册 list_stickers_in_group 工具',
);
assert.ok(
  agentToolsSource.includes('STICKER_AI_SEARCH_DEFAULT_LIMIT'),
  'search_stickers 必须使用降低后的默认 limit',
);
assert.ok(
  /STICKER_AI_SEARCH_DEFAULT_LIMIT = 10/.test(read('src/features/stickers/application/StickerSearch.ts')),
  'search_stickers 默认 limit 应为 10（8~12 区间）',
);
// 工具正文措辞归作者，不设字面断言；这里只校验行为契约：
// search_stickers 的描述必须把分组工具写成「搜索之后的补充路径」。
const searchStickersDefinition = agentToolsSource.slice(
  agentToolsSource.indexOf('export const searchStickersDefinition'),
  agentToolsSource.indexOf('export const listStickerGroupsDefinition'),
);
assert.ok(
  searchStickersDefinition.includes('list_sticker_groups'),
  'search_stickers 描述必须说明分组工具只是搜索之后的补充路径',
);
const groupItemSnapshotMatch = agentToolsSource.match(
  /export interface StickerAIGroupItemSnapshot \{[\s\S]*?\n\}/,
);
assert.ok(groupItemSnapshotMatch, '必须定义分组浏览轻量 snapshot');
assert.ok(
  !/mediaAssetId|uri|base64|sourceFileName/i.test(groupItemSnapshotMatch[0]),
  '分组浏览 snapshot 不得返回媒体 URI / base64 / 文件细节',
);
assert.ok(
  !/必须来自 search_stickers/.test(agentToolsSource),
  'select_sticker 不得再限制 ID 必须来自搜索',
);

// ---------------------------------------------------------------------------
// 7. searchStickersForAI 的 fallback 结构（未配置模型 / 请求失败退回词面）
// ---------------------------------------------------------------------------
const searchApplicationSource = read('src/features/stickers/application/StickerSearch.ts');
assert.ok(
  searchApplicationSource.includes('lexicalFallback'),
  '词面 fallback 必须是独立结构化路径',
);
assert.ok(
  /catch \(error\)/.test(searchApplicationSource),
  'query embedding 请求失败必须退回词面搜索',
);
assert.ok(
  searchApplicationSource.includes('resolveStickerEmbeddingModel()'),
  '语义搜索必须通过 Sticker-owned embedding resolver',
);

// ---------------------------------------------------------------------------
// 8. 真实 repository / application 行为
//
// 纯函数断言和源码字符串都证明不了“第 500 张 Sticker 仍能参与语义排序”这类
// 行为，因此这里把 Sticker 源码直接跑起来：相对导入递归内联，只把
// @platform/persistence 与 @features/media 两个真正的平台边界换成内存实现。
// 每个用例都在真实 node:sqlite 上执行真实 SQL。
// ---------------------------------------------------------------------------
const MODULE_STUBS = {
  '@platform/persistence': [
    'export const databaseCoordinator = {',
    '  openTaskExecutor() {',
    '    if (!globalThis.__stickerVerifyExecutor) {',
    '      throw new Error("Sticker 验证 executor 尚未装配");',
    '    }',
    '    return globalThis.__stickerVerifyExecutor;',
    '  },',
    '};',
  ].join('\n'),
  '@features/media':
    'export const MEDIA_ASSET_STORAGE_BACKEND = { persistentImage: "persistent_image" };\n',
};

function createModuleLoader(stubs) {
  const urlByPath = new Map();
  const urlBySpecifier = new Map();
  const aliasPrefixes = [
    ['@shared/', 'src/shared/'],
    ['@platform/', 'src/platform/'],
    ['@features/', 'src/features/'],
    ['@host/', 'src/host/'],
  ];

  function toDataUrl(code) {
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  }

  function resolvePath(specifier, fromDirectory) {
    let base = null;
    if (specifier.startsWith('.')) {
      base = path.posix.normalize(path.posix.join(fromDirectory, specifier));
    } else {
      const matched = aliasPrefixes.find(([alias]) => specifier.startsWith(alias));
      if (matched) base = `${matched[1]}${specifier.slice(matched[0].length)}`;
    }
    if (!base) throw new Error(`无法解析模块说明符：${specifier}`);
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
      if (fs.existsSync(path.join(ROOT, candidate))) return candidate;
    }
    throw new Error(`找不到模块文件：${specifier}（来自 ${fromDirectory}）`);
  }

  function specifierUrl(specifier, fromDirectory) {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) {
      if (!urlBySpecifier.has(specifier)) {
        urlBySpecifier.set(specifier, toDataUrl(stubs[specifier]));
      }
      return urlBySpecifier.get(specifier);
    }
    return moduleUrl(resolvePath(specifier, fromDirectory));
  }

  function moduleUrl(relativePath) {
    const key = path.posix.normalize(relativePath.replaceAll('\\', '/'));
    const cached = urlByPath.get(key);
    if (cached === 'RESOLVING') throw new Error(`检测到模块循环依赖：${key}`);
    if (cached) return cached;
    urlByPath.set(key, 'RESOLVING');
    const transpiled = ts.transpileModule(read(key), {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const fromDirectory = path.posix.dirname(key);
    const rewritten = transpiled.replace(
      /(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g,
      (match, prefix, quote, specifier) =>
        `${prefix}${quote}${specifierUrl(specifier, fromDirectory)}${quote}`,
    );
    const url = toDataUrl(rewritten);
    urlByPath.set(key, url);
    return url;
  }

  return {
    load(relativePath) {
      return import(moduleUrl(relativePath));
    },
  };
}

function createStickerDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  // 只保留 stickers 外键需要的最小 media_assets 形态；MediaAsset 由内存网关提供。
  db.exec(`
    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY NOT NULL,
      storage_backend TEXT NOT NULL DEFAULT 'persistent_image',
      storage_key TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'image/png',
      byte_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  db.exec(stickerSchemaModule.STICKER_SCHEMA);
  db.exec(stickerSchemaModule.STICKER_V2_SCHEMA);
  return db;
}

function createSqliteExecutor(db) {
  const executor = {
    getFirstAsync: async (sql, params = []) => {
      const rows = db.prepare(sql).all(...params);
      return rows.length > 0 ? rows[0] : null;
    },
    getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
    runAsync: async (sql, params = []) => {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    execAsync: async (sql) => {
      db.exec(sql);
    },
    withExclusiveTransactionAsync: async (task) => {
      db.exec('BEGIN EXCLUSIVE');
      try {
        const value = await task(executor);
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    withExclusiveWriteScopeAsync: async (task) => task(executor),
  };
  return executor;
}

function seedMediaAsset(db, id) {
  db.prepare('INSERT INTO media_assets (id) VALUES (?)').run(id);
}

function seedSticker(db, row) {
  db.prepare(
    `INSERT INTO stickers (
       id, media_asset_id, group_id, name, description, tags_json, emotion,
       mime_type, is_animated, is_favorite, use_count, last_used_at,
       annotation_status, semantic_revision, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.mediaAssetId,
    row.groupId ?? null,
    row.name,
    row.description ?? null,
    JSON.stringify(row.tags ?? []),
    row.emotion ?? null,
    row.mimeType ?? 'image/png',
    row.isAnimated ? 1 : 0,
    row.isFavorite ? 1 : 0,
    row.useCount ?? 0,
    row.lastUsedAt ?? null,
    row.annotationStatus ?? 'ready',
    row.semanticRevision ?? 1,
    row.createdAt ?? '2026-09-01T00:00:00.000Z',
    row.updatedAt ?? '2026-09-01T00:00:00.000Z',
  );
}

function seedEmbedding(db, row) {
  db.prepare(
    `INSERT INTO sticker_embeddings (
       sticker_id, model_config_id, model_config_updated_at, semantic_revision,
       dimension, vector_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.stickerId,
    row.modelConfigId,
    row.modelConfigUpdatedAt,
    row.semanticRevision ?? 1,
    row.vector.length,
    JSON.stringify(row.vector),
    '2026-09-15T00:00:00.000Z',
    '2026-09-15T00:00:00.000Z',
  );
}

function readStickerRow(db, id) {
  return db.prepare(
    `SELECT name, description, tags_json, emotion, annotation_status, semantic_revision
     FROM stickers WHERE id = ?`,
  ).get(id);
}

function countStickerRows(db) {
  return db.prepare('SELECT COUNT(*) AS total FROM stickers').get().total;
}

const EMBEDDING_MODEL_ID = 'cfg-embed';
const EMBEDDING_MODEL_ALT_ID = 'cfg-embed-alt';
const RECOGNITION_MODEL_ID = 'cfg-ocr';
const DISABLED_RECOGNITION_MODEL_ID = 'cfg-ocr-disabled';
const MODEL_UPDATED_AT = '2026-09-15T00:00:00.000Z';

function buildModelConfig(id, capabilityKind, name, enabled = true) {
  return {
    id,
    capabilityKind,
    name,
    enabled,
    baseUrl: 'https://example.com/v1',
    apiKey: 'verify-key',
    model: `${capabilityKind}-demo`,
    temperature: null,
    topP: null,
    maxTokens: null,
    updatedAt: MODEL_UPDATED_AT,
  };
}

const modelConfigs = new Map([
  [EMBEDDING_MODEL_ID, buildModelConfig(EMBEDDING_MODEL_ID, 'embedding', '语义向量模型')],
  [EMBEDDING_MODEL_ALT_ID, buildModelConfig(EMBEDDING_MODEL_ALT_ID, 'embedding', '语义向量模型 B')],
  [RECOGNITION_MODEL_ID, buildModelConfig(RECOGNITION_MODEL_ID, 'ocr', '视觉识别模型 A')],
  [
    DISABLED_RECOGNITION_MODEL_ID,
    buildModelConfig(DISABLED_RECOGNITION_MODEL_ID, 'ocr', '已停用视觉模型', false),
  ],
]);

// 先装配一个 executor，repository 模块顶层会实例化默认 repository。
const bootstrapDb = createStickerDatabase();
globalThis.__stickerVerifyExecutor = createSqliteExecutor(bootstrapDb);

const loader = createModuleLoader(MODULE_STUBS);
const stickerDomainModule = await loader.load('src/features/stickers/domain/Sticker.ts');
const repositoryModule = await loader.load(
  'src/features/stickers/infrastructure/SQLiteStickerRepository.ts',
);
const runtimeModule = await loader.load('src/features/stickers/application/StickerRuntime.ts');
const commandsModule = await loader.load('src/features/stickers/application/StickerCommands.ts');
const aiSearchModule = await loader.load('src/features/stickers/application/StickerSearch.ts');
const systemModelsModule = await loader.load(
  'src/features/stickers/application/StickerSystemModels.ts',
);
const annotationPendingModule = await loader.load(
  'src/features/stickers/application/StickerAnnotationPendingSignal.ts',
);
const embeddingPendingModule = await loader.load(
  'src/features/stickers/application/StickerEmbeddingPendingSignal.ts',
);
const { SQLiteStickerRepository } = repositoryModule;
const { StickerLibraryFullError } = stickerDomainModule;

function createStickerHarness({ maxEmbeddingBatchSize = Infinity } = {}) {
  const db = createStickerDatabase();
  const executor = createSqliteExecutor(db);
  const repository = new SQLiteStickerRepository(executor);
  const mediaAssetsByUri = new Map();
  const embeddingRequests = { calls: 0, batchSizes: [] };
  let idSequence = 0;
  let assetSequence = 0;
  let timeSequence = 0;

  function activate() {
    runtimeModule.configureStickersRuntime({
      repository,
      media: {
        async createMediaAssetWithReference(input, commitReference) {
          const known = mediaAssetsByUri.get(input.sourceUri) ?? null;
          const committed = await executor.withExclusiveTransactionAsync(async (transaction) => {
            let asset = known;
            if (!asset) {
              assetSequence += 1;
              asset = { id: `asset-${String(assetSequence).padStart(4, '0')}` };
              await transaction.runAsync('INSERT INTO media_assets (id) VALUES (?)', [asset.id]);
            }
            const value = await commitReference({ transaction, asset });
            return { asset, reused: known !== null, value };
          });
          if (!committed.reused) mediaAssetsByUri.set(input.sourceUri, committed.asset);
          return committed;
        },
        async resolveMediaAsset() {
          return { localUri: 'file:///verify/media' };
        },
        async releaseMediaAssetCandidates() {},
      },
      auxiliaryModels: {
        getModelConfigById: async (id) => modelConfigs.get(id) ?? null,
        listModelConfigsByRequirement: async (requirement) =>
          [...modelConfigs.values()].filter((config) => config.capabilityKind === requirement),
      },
      embeddings: {
        async embedTexts(texts) {
          assert.ok(texts.length <= maxEmbeddingBatchSize, '向量请求必须满足服务的单次输入上限');
          embeddingRequests.calls += 1;
          embeddingRequests.batchSizes.push(texts.length);
          // 固定返回同向向量，让语义排序的胜负完全由库里存的向量决定。
          return texts.map(() => [1, 0, 0]);
        },
      },
      generateId: () => {
        idSequence += 1;
        return `sticker-${String(idSequence).padStart(4, '0')}`;
      },
      now: () => {
        timeSequence += 1;
        return new Date(Date.UTC(2026, 8, 15, 0, 0, timeSequence)).toISOString();
      },
    });
  }

  return { db, executor, repository, embeddingRequests, activate };
}

const main = createStickerHarness();
main.activate();

// ---------------------------------------------------------------------------
// 9. semantic search 必须扫描当前过滤条件下的全部 ready Sticker
// ---------------------------------------------------------------------------
const SEED_TOTAL = 500;
const SEED_WINNER_ID = `sticker-${String(SEED_TOTAL).padStart(4, '0')}`;

main.db.exec('BEGIN EXCLUSIVE');
for (let index = 1; index <= SEED_TOTAL; index += 1) {
  const stickerId = `sticker-${String(index).padStart(4, '0')}`;
  const mediaAssetId = `asset-seed-${String(index).padStart(4, '0')}`;
  seedMediaAsset(main.db, mediaAssetId);
  seedSticker(main.db, {
    id: stickerId,
    mediaAssetId,
    name: `通用表情 ${index}`,
    tags: ['通用'],
    emotion: '平静',
  });
  seedEmbedding(main.db, {
    stickerId,
    modelConfigId: EMBEDDING_MODEL_ID,
    modelConfigUpdatedAt: MODEL_UPDATED_AT,
    vector: index === SEED_TOTAL ? [1, 0, 0] : [-1, 0, 0],
  });
}
main.db.exec('COMMIT');

await systemModelsModule.setStickerEmbeddingModel(EMBEDDING_MODEL_ID);

const uiPage = await main.repository.searchStickers({ readyOnly: true, limit: 200 });
assert.equal(uiPage.length, 200, '普通列表查询仍然按 STICKER_LIST_LIMIT 分页');
assert.ok(
  !uiPage.some((sticker) => sticker.id === SEED_WINNER_ID),
  '第 500 张必须落在 UI 分页之外，否则这个用例证明不了截断问题',
);

const semanticPool = await main.repository.listReadyStickersForSemanticSearch({});
assert.equal(
  semanticPool.length,
  SEED_TOTAL,
  '语义候选集必须覆盖当前过滤条件下的全部 ready Sticker，不得被 UI 列表分页截断',
);

const semanticResults = await aiSearchModule.searchStickersForAI({ query: '被抓包以后装无辜' });
assert.equal(semanticResults.length, 10, 'Agent observation 仍然只返回约 10 条');
assert.equal(
  semanticResults[0].id,
  SEED_WINNER_ID,
  '库里第 500 张 ready Sticker 必须仍能参与 semantic ranking',
);
assert.ok(
  !semanticResults[0].name.includes('被抓包'),
  '该命中必须来自语义相似度而不是词面关键词重合',
);

// ---------------------------------------------------------------------------
// 10. 收藏库 500 上限：499 -> 500 成功、500 -> 501 拒绝、复用不误报
// ---------------------------------------------------------------------------
const capacity = createStickerHarness();
capacity.activate();

function importPicture(index) {
  const fileName = `pic-${String(index).padStart(3, '0')}.png`;
  return commandsModule.importSticker({
    sourceUri: `file:///verify/${fileName}`,
    fileName,
    mimeType: 'image/png',
    fileSize: 4096,
    width: 64,
    height: 64,
    isAnimated: false,
  });
}

for (let index = 1; index <= 499; index += 1) {
  const imported = await importPicture(index);
  assert.equal(imported.stickerReused, false, '新内容不得被误判为复用');
}
assert.equal(countStickerRows(capacity.db), 499, '499 张时收藏库数量正确');

const importedFiveHundredth = await importPicture(500);
assert.equal(importedFiveHundredth.stickerReused, false);
assert.equal(countStickerRows(capacity.db), 500, '第 500 张必须导入成功');

await assert.rejects(
  () => importPicture(501),
  (error) => error instanceof StickerLibraryFullError,
  '达到 500 后必须拒绝新的非重复导入',
);
assert.equal(countStickerRows(capacity.db), 500, '被拒绝的导入不得留下半条记录');

const reusedAtCapacity = await importPicture(1);
assert.equal(reusedAtCapacity.stickerReused, true, '达到上限后复用既有 Sticker 不应误报容量已满');
assert.equal(reusedAtCapacity.mediaAssetReused, true, '同一份内容必须复用既有 MediaAsset');
assert.equal(countStickerRows(capacity.db), 500);

// ---------------------------------------------------------------------------
// 11. semanticRevision 三条写路径
// ---------------------------------------------------------------------------
const revision = createStickerHarness();
revision.activate();

seedMediaAsset(revision.db, 'asset-edit');
seedSticker(revision.db, {
  id: 'sticker-edit',
  mediaAssetId: 'asset-edit',
  name: '原名',
  description: '原描述',
  tags: ['旧标签'],
  emotion: '平静',
});
assert.equal(readStickerRow(revision.db, 'sticker-edit').semantic_revision, 1);

await commandsModule.editStickerMetadata('sticker-edit', { name: '新名' });
assert.equal(
  readStickerRow(revision.db, 'sticker-edit').semantic_revision,
  2,
  'metadata 编辑实际变化 -> revision +1',
);

await commandsModule.editStickerMetadata('sticker-edit', { name: '新名' });
assert.equal(
  readStickerRow(revision.db, 'sticker-edit').semantic_revision,
  2,
  'metadata 编辑无实际变化 -> revision 不变',
);

await commandsModule.editStickerMetadata('sticker-edit', { tags: ['旧标签'] });
await commandsModule.editStickerMetadata('sticker-edit', { description: '原描述' });
await commandsModule.editStickerMetadata('sticker-edit', { emotion: '平静' });
assert.equal(
  readStickerRow(revision.db, 'sticker-edit').semantic_revision,
  2,
  'tags / description / emotion 无实际变化都不得递增',
);

await commandsModule.editStickerMetadata('sticker-edit', { tags: ['新标签'] });
assert.equal(
  readStickerRow(revision.db, 'sticker-edit').semantic_revision,
  3,
  'tags 实际变化 -> revision +1',
);

await commandsModule.toggleStickerFavorite('sticker-edit');
await commandsModule.recordUserStickerUse('sticker-edit');
assert.equal(
  readStickerRow(revision.db, 'sticker-edit').semantic_revision,
  3,
  'favorite / useCount 变化不得递增 revision',
);

const group = await commandsModule.createStickerGroup({ name: '验证分组' });
await commandsModule.moveStickerToGroup('sticker-edit', group.id);
assert.equal(
  readStickerRow(revision.db, 'sticker-edit').semantic_revision,
  3,
  '移动分组只改变 groupId，不得递增 revision',
);

seedMediaAsset(revision.db, 'asset-auto');
seedSticker(revision.db, {
  id: 'sticker-auto',
  mediaAssetId: 'asset-auto',
  name: '待识别',
  annotationStatus: 'pending',
});
const autoClaim = await commandsModule.claimStickerAnnotation({ claimId: 'claim-auto' });
assert.equal(autoClaim?.sticker.id, 'sticker-auto');
assert.equal(readStickerRow(revision.db, 'sticker-auto').annotation_status, 'processing');
await commandsModule.completeStickerAnnotation({
  stickerId: 'sticker-auto',
  claimId: 'claim-auto',
  metadata: {
    name: '装无辜',
    description: '被抓包以后装无辜',
    tags: ['无辜', '心虚'],
    emotion: '心虚',
  },
});
const autoCompleted = readStickerRow(revision.db, 'sticker-auto');
assert.equal(autoCompleted.annotation_status, 'ready');
assert.equal(autoCompleted.semantic_revision, 2, '自动识别写入实际变化 -> revision +1');

seedMediaAsset(revision.db, 'asset-auto-same');
seedSticker(revision.db, {
  id: 'sticker-auto-same',
  mediaAssetId: 'asset-auto-same',
  name: '同名',
  description: '同描述',
  tags: ['同标签'],
  emotion: '平静',
  annotationStatus: 'pending',
});
const sameClaim = await commandsModule.claimStickerAnnotation({ claimId: 'claim-same' });
assert.equal(sameClaim?.sticker.id, 'sticker-auto-same');
await commandsModule.completeStickerAnnotation({
  stickerId: 'sticker-auto-same',
  claimId: 'claim-same',
  metadata: { name: '同名', description: '同描述', tags: ['同标签'], emotion: '平静' },
});
assert.equal(
  readStickerRow(revision.db, 'sticker-auto-same').semantic_revision,
  1,
  '自动识别结果与原值相同 -> revision 不变',
);

seedMediaAsset(revision.db, 'asset-manual');
seedSticker(revision.db, {
  id: 'sticker-manual',
  mediaAssetId: 'asset-manual',
  name: '动态表情',
  annotationStatus: 'manual_required',
  isAnimated: true,
});
await commandsModule.completeStickerAnnotationManually('sticker-manual', {
  description: '手动补充的含义',
});
const manualCompleted = readStickerRow(revision.db, 'sticker-manual');
assert.equal(manualCompleted.annotation_status, 'ready');
assert.equal(manualCompleted.semantic_revision, 2, '手动完成标注实际变化 -> revision +1');

seedMediaAsset(revision.db, 'asset-manual-same');
seedSticker(revision.db, {
  id: 'sticker-manual-same',
  mediaAssetId: 'asset-manual-same',
  name: '动态表情 2',
  description: '已有含义',
  annotationStatus: 'manual_required',
  isAnimated: true,
});
await commandsModule.completeStickerAnnotationManually('sticker-manual-same', {
  description: '已有含义',
});
assert.equal(
  readStickerRow(revision.db, 'sticker-manual-same').semantic_revision,
  1,
  '手动完成标注无实际变化 -> revision 不变',
);

// ---------------------------------------------------------------------------
// 12. 当前绑定模型的展示投影（与 picker candidate list 分离）
// ---------------------------------------------------------------------------
main.activate();
await systemModelsModule.setStickerRecognitionModel(RECOGNITION_MODEL_ID);

let selection = await systemModelsModule.getStickerSystemModelSelection();
assert.equal(selection.recognition.status, 'active', '正常启用的绑定模型必须显示为可用');
assert.equal(selection.recognition.name, '视觉识别模型 A', '必须给出真实模型名称而不是占位文案');
assert.equal(selection.embedding.status, 'active');
assert.equal(selection.embedding.name, '语义向量模型', 'embedding 也必须显示真实模型名称');

function bindRecognitionRaw(modelConfigId) {
  main.db
    .prepare(`UPDATE sticker_system_config SET recognition_model_config_id = ? WHERE id = 'global'`)
    .run(modelConfigId);
}

bindRecognitionRaw(DISABLED_RECOGNITION_MODEL_ID);
selection = await systemModelsModule.getStickerSystemModelSelection();
assert.equal(selection.recognition.status, 'disabled', 'disabled 模型必须被判不可用');
assert.equal(selection.recognition.name, null);
assert.equal(selection.embedding.status, 'active', 'recognition 失效不得污染 embedding 的展示');

bindRecognitionRaw('cfg-does-not-exist');
selection = await systemModelsModule.getStickerSystemModelSelection();
assert.equal(selection.recognition.status, 'deleted', '被删除的模型必须与 disabled 区分开');

bindRecognitionRaw(EMBEDDING_MODEL_ID);
selection = await systemModelsModule.getStickerSystemModelSelection();
assert.equal(
  selection.recognition.status,
  'capability_mismatch',
  'capability 不匹配的模型必须单独成一种状态',
);
assert.equal(selection.embedding.status, 'active');

bindRecognitionRaw(null);
selection = await systemModelsModule.getStickerSystemModelSelection();
assert.equal(selection.recognition.status, 'unconfigured', '未配置必须与不可用区分开');
assert.equal(selection.recognition.modelConfigId, null);

// ---------------------------------------------------------------------------
// 13. 模型切换后必须立刻唤醒对应 worker（信号发生在持久化成功之后）
// ---------------------------------------------------------------------------
let embeddingWakes = 0;
let annotationWakes = 0;
let embeddingPersistedAtWake = null;
let recognitionPersistedAtWake = null;

const unsubscribeEmbedding = embeddingPendingModule.subscribeStickerEmbeddingPending(() => {
  embeddingWakes += 1;
  embeddingPersistedAtWake = main.db
    .prepare(`SELECT embedding_model_config_id AS id FROM sticker_system_config WHERE id = 'global'`)
    .get().id;
});
const unsubscribeAnnotation = annotationPendingModule.subscribeStickerAnnotationPending(() => {
  annotationWakes += 1;
  recognitionPersistedAtWake = main.db
    .prepare(`SELECT recognition_model_config_id AS id FROM sticker_system_config WHERE id = 'global'`)
    .get().id;
});

await systemModelsModule.setStickerEmbeddingModel(EMBEDDING_MODEL_ALT_ID);
assert.equal(embeddingWakes, 1, '设置 embedding 模型必须立刻发出 embedding 队列唤醒信号');
assert.equal(
  embeddingPersistedAtWake,
  EMBEDDING_MODEL_ALT_ID,
  '唤醒信号必须发生在 embedding 配置持久化成功之后',
);

await systemModelsModule.setStickerRecognitionModel(RECOGNITION_MODEL_ID);
assert.equal(annotationWakes, 1, '设置识别模型必须立刻发出标注队列唤醒信号');
assert.equal(
  recognitionPersistedAtWake,
  RECOGNITION_MODEL_ID,
  '唤醒信号必须发生在识别模型配置持久化成功之后',
);

await systemModelsModule.setStickerEmbeddingModel(null);
await systemModelsModule.setStickerRecognitionModel(null);
assert.equal(embeddingWakes, 1, '清空 embedding 模型不得制造额外唤醒');
assert.equal(annotationWakes, 1, '清空识别模型不得制造额外唤醒');
assert.equal(await systemModelsModule.resolveStickerEmbeddingModel(), null, '清空后 resolver 必须返回 null');
assert.equal(await systemModelsModule.resolveStickerRecognitionModel(), null, '清空后 resolver 必须返回 null');
unsubscribeEmbedding();
unsubscribeAnnotation();

// ---------------------------------------------------------------------------
// 14. cursor 不得依赖运行时 Node global Buffer
//
// 先把模块的 data URL 构造好（构造本身需要 Node 的 Buffer），再把这些全局置空，
// 然后才导入并调用。这样验证的是“在只有 Hermes 那种环境里也能跑”，
// 而不是“Node 恰好自带 Buffer 所以碰巧通过”。
// ---------------------------------------------------------------------------
{
  const cursorModuleUrl = transpileToModuleUrl(read('src/features/stickers/domain/StickerSearch.ts'));
  const savedGlobals = {
    Buffer: globalThis.Buffer,
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  };
  globalThis.Buffer = undefined;
  globalThis.btoa = undefined;
  globalThis.atob = undefined;
  globalThis.TextEncoder = undefined;
  globalThis.TextDecoder = undefined;
  try {
    const { encodeStickerGroupPageCursor, decodeStickerGroupPageCursor } =
      await import(cursorModuleUrl);
    const cursor = {
      createdAt: '2026-09-01T00:00:00.000Z',
      stickerId: 'sticker-9f4c-中文-🎉',
    };
    const encoded = encodeStickerGroupPageCursor(cursor);
    assert.equal(typeof encoded, 'string');
    assert.ok(!/[+/=]/.test(encoded), 'cursor 必须是 base64url，不含标准 base64 的填充与符号');
    assert.deepEqual(
      decodeStickerGroupPageCursor(encoded),
      cursor,
      '没有 Buffer / btoa / atob / TextEncoder 时 cursor 编解码仍必须稳定',
    );
    assert.equal(decodeStickerGroupPageCursor('not-a-cursor'), null, '非法 cursor 必须安全返回 null');
    assert.equal(decodeStickerGroupPageCursor(''), null, '空 cursor 必须安全返回 null');
    assert.equal(decodeStickerGroupPageCursor('!!!!'), null, '非法字符必须安全返回 null');
    assert.equal(
      decodeStickerGroupPageCursor(encodeStickerGroupPageCursor({ createdAt: '', stickerId: '' })),
      null,
      '缺少有效字段的 cursor 必须返回 null',
    );
  } finally {
    Object.assign(globalThis, savedGlobals);
  }
}

// ---------------------------------------------------------------------------
// 15. semantic search 的 zero-valid-embedding fallback 边界
//
// 模型已配置、query embedding 成功、候选 Sticker 也非空，但候选里没有任何一条
// valid 向量（全缺失 / 全 stale / 维度不匹配）时，semanticScore 会全部缺省。
// 若仍进入 hybrid rerank，排序里只剩 lexical / favorite / usage，结果既不是
// 语义排序、也不等价于词面 fallback。契约要求 validEmbeddingCount === 0 时
// 整体退回 lexical，且这四元组判定必须继续用 isStickerEmbeddingValid。
// ---------------------------------------------------------------------------
const FALLBACK_QUERY = '装无辜';
const fallback = createStickerHarness();
fallback.activate();

// 命中词面的 4 张：favorite / useCount / lastUsedAt 各不相同，
// 使词面排序不是简单的 id 顺序，避免“顺序恰好一致”造成的假通过。
seedMediaAsset(fallback.db, 'asset-f1');
seedSticker(fallback.db, {
  id: 'sticker-0001',
  mediaAssetId: 'asset-f1',
  name: '装无辜',
  isFavorite: true,
});
seedMediaAsset(fallback.db, 'asset-f2');
seedSticker(fallback.db, {
  id: 'sticker-0002',
  mediaAssetId: 'asset-f2',
  name: '委屈',
  description: '被抓包以后装无辜',
  useCount: 5,
});
seedMediaAsset(fallback.db, 'asset-f3');
seedSticker(fallback.db, {
  id: 'sticker-0003',
  mediaAssetId: 'asset-f3',
  name: '委屈巴巴',
  tags: ['装无辜'],
  lastUsedAt: '2026-09-10T00:00:00.000Z',
});
seedMediaAsset(fallback.db, 'asset-f4');
seedSticker(fallback.db, { id: 'sticker-0004', mediaAssetId: 'asset-f4', name: '装无辜 2' });
// 词面完全不命中、但行为分最高：修复前它会被 hybrid 拉到前面，是主要破绽
seedMediaAsset(fallback.db, 'asset-f5');
seedSticker(fallback.db, {
  id: 'sticker-0005',
  mediaAssetId: 'asset-f5',
  name: '开心',
  isFavorite: true,
  useCount: 20,
});
seedMediaAsset(fallback.db, 'asset-f6');
seedSticker(fallback.db, { id: 'sticker-0006', mediaAssetId: 'asset-f6', name: '无语' });

await systemModelsModule.setStickerEmbeddingModel(EMBEDDING_MODEL_ID);

function stickerIds(stickers) {
  return stickers.map((sticker) => sticker.id);
}

const lexicalExpectation = stickerIds(
  await fallback.repository.searchStickers({ readyOnly: true, query: FALLBACK_QUERY, limit: 10 }),
);
assert.deepEqual(
  lexicalExpectation,
  ['sticker-0001', 'sticker-0002', 'sticker-0003', 'sticker-0004'],
  '词面 oracle 必须只含命中 query 的 Sticker，且顺序由 favorite / useCount / lastUsedAt / id 决定',
);

// Case A：模型已配置、query embedding 成功、候选非空，但库里一条 embedding 都没有
assert.equal(
  (
    await fallback.repository.listStickerEmbeddingsByStickerIds(
      ['sticker-0001', 'sticker-0005'],
      EMBEDDING_MODEL_ID,
    )
  ).length,
  0,
  'Case A 前置条件：候选里没有任何 embedding row',
);
const zeroEmbeddingResult = await aiSearchModule.searchStickersForAI({ query: FALLBACK_QUERY });
assert.deepEqual(
  stickerIds(zeroEmbeddingResult),
  lexicalExpectation,
  'Case A 零 embedding：结果必须与 lexical fallback 完全一致（含完整 ID 顺序）',
);

// Case B：库里确实存在 embedding row，但三条分别因 revision / 指纹 / 维度失效
seedEmbedding(fallback.db, {
  stickerId: 'sticker-0001',
  modelConfigId: EMBEDDING_MODEL_ID,
  modelConfigUpdatedAt: MODEL_UPDATED_AT,
  semanticRevision: 99,
  vector: [1, 0, 0],
});
seedEmbedding(fallback.db, {
  stickerId: 'sticker-0002',
  modelConfigId: EMBEDDING_MODEL_ID,
  modelConfigUpdatedAt: '2026-01-01T00:00:00.000Z',
  semanticRevision: 1,
  vector: [1, 0, 0],
});
seedEmbedding(fallback.db, {
  stickerId: 'sticker-0003',
  modelConfigId: EMBEDDING_MODEL_ID,
  modelConfigUpdatedAt: MODEL_UPDATED_AT,
  semanticRevision: 1,
  vector: [1, 0, 0, 0, 0],
});
assert.equal(
  (
    await fallback.repository.listStickerEmbeddingsByStickerIds(
      ['sticker-0001', 'sticker-0002', 'sticker-0003'],
      EMBEDDING_MODEL_ID,
    )
  ).length,
  3,
  'Case B 前置条件：库里确实存在 embedding row，只是全部 stale（不是“没有行”）',
);
const allStaleResult = await aiSearchModule.searchStickersForAI({ query: FALLBACK_QUERY });
assert.deepEqual(
  stickerIds(allStaleResult),
  lexicalExpectation,
  'Case B 全部 stale：存在 row 不等于有效，结果必须与 lexical fallback 完全一致（含完整 ID 顺序）',
);

// Case C：只要存在 1 条 valid embedding，就必须继续 hybrid rerank（partial-index 不降级）
fallback.db.prepare('DELETE FROM sticker_embeddings').run();
seedEmbedding(fallback.db, {
  stickerId: 'sticker-0006',
  modelConfigId: EMBEDDING_MODEL_ID,
  modelConfigUpdatedAt: MODEL_UPDATED_AT,
  semanticRevision: 1,
  vector: [1, 0, 0],
});
const partialValidResult = await aiSearchModule.searchStickersForAI({ query: FALLBACK_QUERY });
assert.equal(
  partialValidResult[0].id,
  'sticker-0006',
  'Case C 存在 valid 向量时必须进入 hybrid rerank：语义相似度可以压过词面与行为分',
);
// 不断言完整分数顺序（hybrid 权重不是持久 contract），只断言候选集没被整体降级。
assert.deepEqual(
  [...stickerIds(partialValidResult)].sort(),
  ['sticker-0001', 'sticker-0002', 'sticker-0003', 'sticker-0004', 'sticker-0005', 'sticker-0006'],
  'Case C 候选集仍是结构过滤后的全部 ready Sticker，partial-index 不得被整体降级',
);
assert.notDeepEqual(
  stickerIds(partialValidResult),
  lexicalExpectation,
  'Case C 存在 valid 向量时结果不得等于纯词面排序',
);

// ---------------------------------------------------------------------------
// 16. 向量批次查询与空索引重建：真实联表必须返回 Sticker 自身的字段
// ---------------------------------------------------------------------------
const embeddingsModule = await loader.load('src/features/stickers/application/StickerEmbeddings.ts');
const indexing = createStickerHarness({ maxEmbeddingBatchSize: 10 });
indexing.activate();
await systemModelsModule.setStickerEmbeddingModel(EMBEDDING_MODEL_ID);

const indexContext = {
  modelConfigId: EMBEDDING_MODEL_ID,
  modelConfigUpdatedAt: MODEL_UPDATED_AT,
  dimension: null,
};
const indexIds = ['missing', 'other-model', 'stale-model', 'stale-revision', 'valid', 'wrong-dimension'];
for (const id of [...indexIds, 'not-ready']) {
  seedMediaAsset(indexing.db, `asset-${id}`);
  seedSticker(indexing.db, {
    id,
    mediaAssetId: `asset-${id}`,
    name: id,
    tags: ['测试标签'],
    semanticRevision: 2,
    annotationStatus: id === 'not-ready' ? 'pending' : 'ready',
  });
}

assert.deepEqual(
  stickerIds(await indexing.repository.listReadyStickersNeedingEmbedding(indexContext, 16)),
  indexIds,
  '从未建过索引时，批次查询必须返回全部 ready Sticker',
);
for (const [id, modelId, updatedAt, revision, vector] of [
  ['other-model', EMBEDDING_MODEL_ALT_ID, MODEL_UPDATED_AT, 2, [1, 0, 0]],
  ['stale-model', EMBEDDING_MODEL_ID, '2026-01-01T00:00:00.000Z', 2, [1, 0, 0]],
  ['stale-revision', EMBEDDING_MODEL_ID, MODEL_UPDATED_AT, 1, [1, 0, 0]],
  ['valid', EMBEDDING_MODEL_ID, MODEL_UPDATED_AT, 2, [1, 0, 0]],
  ['wrong-dimension', EMBEDDING_MODEL_ID, MODEL_UPDATED_AT, 2, [1, 0]],
]) {
  seedEmbedding(indexing.db, {
    stickerId: id,
    modelConfigId: modelId,
    modelConfigUpdatedAt: updatedAt,
    semanticRevision: revision,
    vector,
  });
}

const pendingIndexStickers = await indexing.repository.listReadyStickersNeedingEmbedding(indexContext, 16);
assert.deepEqual(
  stickerIds(pendingIndexStickers),
  ['missing', 'other-model', 'stale-model', 'stale-revision'],
  '批次只选择当前模型缺失或语义版本、模型指纹过期的 ready Sticker',
);
for (const sticker of pendingIndexStickers) {
  assert.deepEqual(
    sticker,
    await indexing.repository.getStickerById(sticker.id),
    '联表返回的语义版本与时间等字段必须全部属于 Sticker，而非 embedding',
  );
}
assert.deepEqual(
  stickerIds(await indexing.repository.listReadyStickersNeedingEmbedding({ ...indexContext, dimension: 3 }, 16)),
  ['missing', 'other-model', 'stale-model', 'stale-revision', 'wrong-dimension'],
  '指定维度时，维度不匹配的向量也必须补建',
);
assert.deepEqual(
  stickerIds(await indexing.repository.listReadyStickersNeedingEmbedding(indexContext, 2)),
  ['missing', 'other-model'],
  '批次查询必须遵守数量上限',
);

await embeddingsModule.rebuildStickerEmbeddingIndex();
assert.deepEqual(
  await embeddingsModule.getStickerEmbeddingIndexStatus(),
  { readyStickers: 6, validEmbeddings: 0, pendingEmbeddings: 6 },
  '重建后从空索引开始，待建数量应覆盖全部 ready Sticker',
);
assert.deepEqual(
  await embeddingsModule.generateStickerEmbeddingBatch(),
  { embeddedCount: 6 },
  '空索引必须能通过真实批次查询、模型网关和 Repository 写入完成建索引',
);
assert.deepEqual(
  await embeddingsModule.getStickerEmbeddingIndexStatus(),
  { readyStickers: 6, validEmbeddings: 6, pendingEmbeddings: 0 },
  '新向量必须匹配当前模型指纹和 Sticker 语义版本',
);
assert.deepEqual(await embeddingsModule.generateStickerEmbeddingBatch(), { embeddedCount: 0 });
assert.equal(indexing.embeddingRequests.calls, 1, '索引齐全后不应再调用向量模型');
// 待建数量超过服务上限时，默认 worker 批次仍应持续补齐，而不是反复发送被拒绝的大请求。
for (let index = 0; index < 15; index++) {
  seedMediaAsset(indexing.db, `asset-batch-limit-${index}`);
  seedSticker(indexing.db, {
    id: `batch-limit-${index}`,
    mediaAssetId: `asset-batch-limit-${index}`,
    name: `批次上限 ${index}`,
    tags: ['测试标签'],
    annotationStatus: 'ready',
  });
}
let embeddedTotal = 0;
while (embeddedTotal < 15) {
  const result = await embeddingsModule.generateStickerEmbeddingBatch();
  assert.ok(result.embeddedCount > 0, '待建向量应持续推进');
  embeddedTotal += result.embeddedCount;
}
assert.equal(embeddedTotal, 15);
assert.equal((await embeddingsModule.getStickerEmbeddingIndexStatus()).pendingEmbeddings, 0);
indexing.db.close();

console.log('verify:stickers-v2 全部通过');
