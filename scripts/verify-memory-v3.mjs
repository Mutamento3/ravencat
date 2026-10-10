/** 在隔离 SQLite 中验证 V3 产品行为与事务，不锁定源码写法。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kimiphone-memory-v3-'));
const databasePath = path.join(directory, 'memory.db');
const backupPath = path.join(directory, 'backup.db');
let database = new DatabaseSync(databasePath);
database.exec('PRAGMA foreign_keys = ON');
let chain = Promise.resolve();
const raw = {
  async execAsync(sql) { database.exec(sql); },
  async runAsync(sql, params = []) { const result = database.prepare(sql).run(...params); return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }; },
  async getFirstAsync(sql, params = []) { return database.prepare(sql).get(...params) ?? null; },
  async getAllAsync(sql, params = []) { return database.prepare(sql).all(...params); },
};
function scheduled(operation) {
  const result = chain.then(operation);
  chain = result.catch(() => {});
  return result;
}
const executor = {
  execAsync: (...args) => scheduled(() => raw.execAsync(...args)),
  runAsync: (...args) => scheduled(() => raw.runAsync(...args)),
  getFirstAsync: (...args) => scheduled(() => raw.getFirstAsync(...args)),
  getAllAsync: (...args) => scheduled(() => raw.getAllAsync(...args)),
  withExclusiveWriteScopeAsync: (operation) => scheduled(() => operation(raw)),
  withExclusiveTransactionAsync: (operation) => scheduled(async () => {
    database.exec('BEGIN');
    try { const result = await operation(raw); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  }),
};
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requireLocal = (specifier) => {
    if (specifier === '@platform/persistence') return { databaseCoordinator: { openTaskExecutor: () => executor } };
    if (specifier === 'expo-file-system/legacy') return {};
    if (filename === path.join(root, 'src/platform/persistence/helpers.ts') && specifier === './runtime'
      || filename === path.join(root, 'src/platform/persistence/sqlite/initialization.ts') && specifier === '../runtime') {
      return { databaseCoordinator: { openTaskExecutor: () => executor } };
    }
    if (filename === path.join(root, 'src/platform/persistence/helpers.ts') && specifier === './sqlite/connection'
      || filename === path.join(root, 'src/platform/persistence/sqlite/initialization.ts') && specifier === './connection') {
      return { closeDB: async () => {}, closeDBForRestoreRollback: async () => {}, getActiveDbName: () => 'memory.db' };
    }
    if (specifier === '@shared') return { SELF_USER_ID: 'self' };
    if (specifier === 'expo-crypto') return { randomUUID };
    if (specifier === '@features/protocol') return load('src/features/protocol/infrastructure/SQLiteProtocolRepository.ts');
    if (specifier === '@features/memory/composition') return {
      ...runtime, ...commands, memoryEntryRepository: repository, ...load('src/features/memory/application/MemorySignals.ts'),
    };
    let location;
    if (specifier.startsWith('.')) location = path.resolve(path.dirname(filename), specifier);
    else if (specifier.startsWith('@shared/')) location = path.join(root, 'src/shared', specifier.slice(8));
    else return nativeRequire(specifier);
    for (const suffix of ['.ts', '.tsx', '/index.ts']) if (fs.existsSync(location + suffix)) return load(location + suffix);
    throw new Error('无法加载测试依赖：' + specifier);
  };
  new Function('require', 'module', 'exports', compiled)(requireLocal, module, module.exports);
  return module.exports;
}
const { SCHEMAS, INDEXES } = load('src/platform/persistence/sqlite/schema.ts');
const { runMigrations } = load('src/platform/persistence/sqlite/migrations.ts');
const { migrateMemoryV3, migrateMemorySummary, MEMORY_PASSIVE_ASSOCIATION_SCHEMA } = load('src/platform/persistence/sqlite/memoryV3Schema.ts');
const domain = load('src/features/memory/domain/Memory.ts');
const { memoryEntryRepository: repository } = load('src/features/memory/infrastructure/SQLiteMemoryEntryRepository.ts');
const runtime = load('src/features/memory/application/MemoryRuntimeDependencies.ts');
const commands = load('src/features/memory/application/MemoryCommands.ts');
const recall = load('src/features/memory/application/RecallMemory.ts');
const worker = load('src/features/memory/application/MemoryEmbeddingWorker.ts');
const { SQLiteChatSummaryRepository } = load('src/features/chat/summary/infrastructure/SQLiteChatSummaryRepository.ts');
const summaryRuntime = load('src/features/chat/summary/application/ChatSummaryRuntime.ts');
const summaryApplication = load('src/features/chat/summary/application/ChatSummary.ts');
const { callRepository: calls } = load('src/features/calls/infrastructure/SQLiteCallRepository.ts');
const summary = new SQLiteChatSummaryRepository((tx, conversationId, boundary) => calls.readSummarySources(tx, {
  chatSessionId: conversationId, excludedCallIds: boundary.processedCallIds, after: boundary.historyStartsAfter,
}));
const timelineDomain = load('src/features/chat/summary/domain/ChatSummaryTimeline.ts');
const appendSummary = (claim, id, content, at) => summary.appendClaim(claim, [{ id, content, messages: claim.messages }], at);
const buildSummaryInput = (claim) => summaryApplication.buildChatSummaryModelInput({
  ...claim, part: { index: 1, total: 1 }, earlierAdditionsReadOnly: [],
});
const { timelineOrderedMessagesCte, timelineProjectionOrderBy } = load('src/features/chat/messages/infrastructure/ChatTimelineSql.ts');
const now = '2026-10-04T04:00:00.000Z';
const later = '2026-10-04T05:00:00.000Z';
const modelA = { id: 'model-a', name: '向量 A', fingerprint: 'model-a:r1', baseURL: 'https://example.invalid', apiKey: 'test', model: 'a', metadataJson: null };
const modelB = { ...modelA, fingerprint: 'model-a:r2', name: '向量 B' };
let currentModel = null;
let embedding = async () => [1, 0];
runtime.configureMemoryRuntimeDependencies({
  repository, listMemorySpaces: async () => [],
  resolveMemorySpace: async (id) => ({ poolId: id === 'a' ? 'pool-a' : 'pool-b', assistantId: id }),
  resolveEmbeddingModel: async () => currentModel,
  embed: (...args) => embedding(...args),
});
async function bootstrap() {
  const log = console.log; const warn = console.warn;
  try {
    console.log = () => {}; console.warn = () => {};
    for (const sql of Object.values(SCHEMAS)) await raw.execAsync(sql);
    await runMigrations(raw);
    for (const sql of Object.values(INDEXES)) await raw.execAsync(sql);
  } finally { console.log = log; console.warn = warn; }
  assert.deepEqual(await raw.getAllAsync('PRAGMA foreign_key_check'), []);
}
async function create(id, content, time = now, poolId = 'pool-a', writeKey = null) {
  return repository.createEntry({ id, poolId, content, summary: null, normalizedContent: domain.normalizeMemoryText(content), now: time, writeKey });
}
async function claim(id = randomUUID(), time = now) {
  return repository.claimEmbedding(currentModel.fingerprint, id, time, later);
}
function addMessage(id, content, role = 'user', timestamp = now, runId = null, index = null) {
  database.prepare(`INSERT INTO messages (id, session_id, text, is_me, sender_type, created_at, time, status, turn_run_id, turn_item_index)
    VALUES (?, 'conversation', ?, ?, ?, ?, ?, 'sent', ?, ?)`).run(id, content, role === 'user' ? 1 : 0, role, timestamp, timestamp, runId, index);
}
try {
  // 从真实旧列结构升级，失败时列与版本一起回滚；旧向量无需重建。
  const legacyMemory = new DatabaseSync(':memory:');
  try {
    legacyMemory.exec(`CREATE TABLE memory_items (id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, content TEXT NOT NULL,
      normalized_content TEXT NOT NULL, content_revision INTEGER NOT NULL, write_key TEXT,
      remembered_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO memory_items VALUES ('old', 'pool-a', '旧正文', '旧正文', 7, 'receipt', '1', '2', '3');
      CREATE TABLE memory_item_embeddings (memory_id TEXT, status TEXT, vector_json TEXT, content_revision INTEGER);
      INSERT INTO memory_item_embeddings VALUES ('old', 'ready', '[1,0]', 7); PRAGMA user_version = 106;`);
    const legacyExecutor = {
      execAsync: async (sql) => legacyMemory.exec(sql),
      getFirstAsync: async (sql) => legacyMemory.prepare(sql).get(),
      getAllAsync: async (sql) => legacyMemory.prepare(sql).all(),
    };
    const original = legacyMemory.prepare('SELECT * FROM memory_items').get();
    const originalVector = legacyMemory.prepare('SELECT * FROM memory_item_embeddings').get();
    await assert.rejects(migrateMemorySummary({ ...legacyExecutor, execAsync: async (sql) => {
      if (sql.includes('PRAGMA user_version = 107')) throw new Error('升级提交失败');
      return legacyExecutor.execAsync(sql);
    } }), /升级提交失败/);
    assert.deepEqual(legacyMemory.prepare('SELECT * FROM memory_items').get(), original);
    assert.equal(legacyMemory.prepare('PRAGMA user_version').get().user_version, 106);
    await migrateMemorySummary(legacyExecutor);
    const migrated = legacyMemory.prepare('SELECT * FROM memory_items').get();
    assert.deepEqual({ ...migrated }, { ...original, summary: null, normalized_summary: '' });
    assert.deepEqual(legacyMemory.prepare('SELECT * FROM memory_item_embeddings').get(), originalVector);
    await migrateMemorySummary(legacyExecutor);
    assert.deepEqual(legacyMemory.prepare('SELECT * FROM memory_items').get(), migrated);
    assert.equal(legacyMemory.prepare('PRAGMA user_version').get().user_version, 107);
  } finally { legacyMemory.close(); }
  // 既有触发词和关闭事实在新增关系表后保持原样，重复启动不清空手动绑定。
  const legacyTriggers = new DatabaseSync(':memory:');
  try {
    legacyTriggers.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE memory_items (id TEXT PRIMARY KEY);
      CREATE TABLE memory_passive_triggers (id TEXT PRIMARY KEY);
      CREATE TABLE memory_passive_disabled (trigger_id TEXT, memory_id TEXT);
      INSERT INTO memory_items VALUES ('old'); INSERT INTO memory_passive_triggers VALUES ('trigger');
      INSERT INTO memory_passive_disabled VALUES ('trigger', 'old');`);
    legacyTriggers.exec(MEMORY_PASSIVE_ASSOCIATION_SCHEMA);
    assert.equal(legacyTriggers.prepare('SELECT COUNT(*) AS count FROM memory_passive_disabled').get().count, 1);
    legacyTriggers.exec("INSERT INTO memory_passive_associations VALUES ('trigger', 'old')");
    legacyTriggers.exec(MEMORY_PASSIVE_ASSOCIATION_SCHEMA);
    assert.equal(legacyTriggers.prepare('SELECT COUNT(*) AS count FROM memory_passive_associations').get().count, 1);
    assert.deepEqual(legacyTriggers.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { legacyTriggers.close(); }
  await bootstrap();
  database.exec(`INSERT OR IGNORE INTO user_profile (id, name, updated_at) VALUES ('self', '枫渡', '${now}');
    INSERT INTO ai_assistants (id, agent_id, name, model, created_at, updated_at) VALUES ('a', 'actor-a', 'A', 'chat', '${now}', '${now}'), ('b', 'actor-b', 'B', 'chat', '${now}', '${now}');
    INSERT INTO memory_pools (id, user_profile_id, ai_assistant_id, created_at, updated_at) VALUES ('pool-a', 'self', 'a', '${now}', '${now}'), ('pool-b', 'self', 'b', '${now}', '${now}');
    INSERT INTO chat_conversations (id, kind) VALUES ('conversation', 'direct');
    INSERT INTO sessions (id, ai_assistant_id, name, created_at, updated_at) VALUES ('conversation', 'a', 'A', '${now}', '${now}');
    INSERT INTO conversation_turn_state (session_id, reply_cursor, revision, updated_at) VALUES ('conversation', 100, 0, '${now}');`);
  assert.equal(domain.requireMemoryContent('  ' + '猫'.repeat(500) + '  ').length, 500);
  assert.equal(Array.from(domain.requireMemoryContent('🐈'.repeat(500))).length, 500);
  assert.throws(() => domain.requireMemoryContent('猫'.repeat(501)), domain.MemoryInputError);
  assert.throws(() => domain.requireMemoryContent('   '), domain.MemoryInputError);
  assert.equal(domain.requireMemorySummary('  摘要  '), '摘要');
  assert.equal(domain.requireMemorySummary('  '), null);
  assert.equal(domain.requireMemorySummary('🐈'.repeat(50)), '🐈'.repeat(50));
  assert.throws(() => domain.requireMemorySummary('猫'.repeat(51)), domain.MemoryInputError);
  assert.equal(domain.countMemoryKeywordMatches({ content: 'ＡＢＣ 协议', summary: 'ABC' }, ['abc', '协议']), 2);
  assert.equal(domain.countMemoryKeywordMatches({ content: '正文', summary: '摘要' }, ['摘要\n正文']), 0);
  assert.equal(domain.normalizeMemoryText('ＡＢＣ'), 'abc');
  const saved = await commands.rememberMemory('a', '枫渡喜欢猫', 'run:tool');
  assert.equal((await commands.rememberMemory('a', '重复调用不能改正文', 'run:tool')).id, saved.id);
  await assert.rejects(commands.editMemory('b', saved.id, '越界'), domain.MemoryNotFoundError);
  assert.equal(await commands.forgetMemory('b', saved.id), false);
  assert.equal((await repository.getEntry('pool-a', saved.id)).content, '枫渡喜欢猫');
  await create('both', '猫与考试', later);
  await create('cat', '猫', now);
  await create('vector-only', '明天准备复习', later);
  await create('foreign', '猫与考试', later, 'pool-b');
  await commands.addMemoryTrigger('a', '猫');
  await commands.addMemoryTrigger('a', '考试');
  const triggers = await repository.listTriggers('pool-a');
  const catTrigger = triggers.find((item) => item.keyword === '猫');
  assert.equal(catTrigger.associatedCount, 3);
  await commands.setMemoryAutoRecall('a', catTrigger.id, 'both', false);
  assert.equal((await repository.recallPassive('pool-a', '猫')).some((item) => item.id === 'both'), false);
  assert.equal((await repository.recallPassive('pool-a', '考试')).some((item) => item.id === 'both'), true);
  assert.equal((await repository.recallPassive('pool-a', '无关键词')).length, 0);
  {
    const manual = await commands.rememberMemory('a', '难过时希望被抱抱');
    await commands.addMemoryTrigger('a', '安慰，低落、ＡＢＣ;abc；\n', manual.id);
    const linked = (await repository.listTriggers('pool-a')).filter((item) => ['安慰', '低落', 'abc'].includes(item.normalizedKeyword));
    assert.equal(linked.length, 3, '批量触发词按规范化去重');
    assert.ok(linked.every((item) => item.associatedCount === 1 && item.enabledCount === 1));
    for (const input of ['安慰', '低落', 'abc']) {
      assert.deepEqual((await repository.recallPassive('pool-a', input)).map((item) => item.id), [manual.id]);
    }
    assert.equal((await repository.recallPassive('pool-a', '安慰低落abc')).length, 1, '多个词命中同一记忆只带入一次');
    const comfort = linked.find((item) => item.keyword === '安慰');
    await commands.editMemory('a', manual.id, '换成不包含任何触发词的正文', '独立摘要');
    assert.equal((await repository.listTriggerMemories('pool-a', comfort.id))[0].memory.content, '换成不包含任何触发词的正文');
    await commands.setMemoryAutoRecall('a', comfort.id, manual.id, false);
    assert.equal((await repository.recallPassive('pool-a', '安慰')).length, 0);
    assert.equal((await repository.recallPassive('pool-a', '低落')).length, 1);
    await Promise.all([
      commands.addMemoryTrigger('a', '安慰', manual.id),
      commands.addMemoryTrigger('a', '安慰', manual.id),
    ]);
    assert.equal((await repository.recallPassive('pool-a', '安慰')).length, 1, '重复绑定复用触发词并恢复开关');
    assert.equal((await repository.listTriggers('pool-a')).filter((item) => item.keyword === '安慰').length, 1, '并发绑定只创建一个触发词');
    await commands.setMemoryAutoRecall('b', comfort.id, 'foreign', true);
    await commands.setMemoryAutoRecall('a', comfort.id, 'foreign', true);
    assert.equal((await repository.listTriggerMemories('pool-a', comfort.id)).length, 1, '手动关系不能跨空间');
    await assert.rejects(commands.addMemoryTrigger('b', '越界批量', manual.id), domain.MemoryNotFoundError);
    assert.equal((await repository.listTriggers('pool-b')).length, 0);
    await assert.rejects(commands.addMemoryTrigger('a', '，；\n'), domain.MemoryInputError);
    database.exec(`CREATE TRIGGER reject_manual_link BEFORE INSERT ON memory_passive_associations
      WHEN (SELECT keyword FROM memory_passive_triggers WHERE id = NEW.trigger_id) = '事务词二'
      BEGIN SELECT RAISE(ABORT, '绑定失败'); END;`);
    await assert.rejects(commands.addMemoryTrigger('a', '事务词一，事务词二', manual.id), /绑定失败/);
    database.exec('DROP TRIGGER reject_manual_link');
    assert.equal((await repository.listTriggers('pool-a')).some((item) => item.keyword.startsWith('事务词')), false, '失败不留下部分触发词');
    await commands.deleteMemoryTrigger('a', comfort.id);
    assert.equal((await repository.recallPassive('pool-a', '安慰')).length, 0);
    assert.equal((await repository.recallPassive('pool-a', '低落')).length, 1);
    await commands.forgetMemory('a', manual.id);
    for (const trigger of linked) await commands.deleteMemoryTrigger('a', trigger.id);
    assert.equal((await raw.getFirstAsync('SELECT COUNT(*) AS count FROM memory_passive_associations')).count, 0);
    await commands.setMemoryAutoRecall('a', catTrigger.id, 'vector-only', true);
    assert.ok((await repository.recallPassive('pool-a', '猫')).some((item) => item.id === 'vector-only'), '关联选择器可绑定已有触发词与无字面命中的记忆');
    await commands.setMemoryAutoRecall('a', catTrigger.id, 'vector-only', false);
    assert.equal((await repository.listTriggerMemories('pool-a', catTrigger.id)).find((item) => item.memory.id === 'vector-only').autoRecall, false);
  }
  await commands.setMemoryRecallSettings('a', { passiveLimit: 0, activePageSize: 5 });
  assert.equal((await repository.recallPassive('pool-a', '考试')).length, 0);
  await assert.rejects(commands.setMemoryRecallSettings('a', { passiveLimit: -1, activePageSize: 1 }), domain.MemoryInputError);
  for (let index = 0; index < 9; index++) await create('page-' + index, '猫 ' + index, now);
  const signal = new AbortController().signal;
  const nativeTools = load('src/features/memory/aiTools/MemoryAgentTools.ts');
  const nativeContext = { task: { assistantId: 'a' }, runId: 'native-run', toolCallId: 'save-1', abortSignal: signal };
  const nativeSaved = await nativeTools.RememberMemoryTool.execute({ content: '工具主动保存的正文' }, nativeContext);
  assert.equal(nativeSaved.status, 'success');
  assert.equal(nativeSaved.data.poolId, 'pool-a');
  assert.equal((await nativeTools.RememberMemoryTool.execute({ content: '不能重复写入' }, nativeContext)).data.id, nativeSaved.data.id);
  assert.equal((await nativeTools.RememberMemoryTool.execute({ content: '猫'.repeat(501) }, { ...nativeContext, toolCallId: 'save-2' })).status, 'error');
  const nativeUpdated = await nativeTools.UpdateMemoryTool.execute({ memoryId: nativeSaved.data.id, content: '工具更新后的完整正文' }, { ...nativeContext, toolCallId: 'update-1' });
  assert.equal(nativeUpdated.status, 'success');
  assert.equal(nativeUpdated.data.id, nativeSaved.data.id);
  assert.equal(nativeUpdated.data.content, '工具更新后的完整正文');
  assert.equal(nativeUpdated.data.rememberedAt, nativeSaved.data.rememberedAt);
  assert.equal(nativeUpdated.data.contentRevision, nativeSaved.data.contentRevision + 1);
  for (const content of [' ', '猫'.repeat(501)]) {
    assert.equal((await nativeTools.UpdateMemoryTool.execute({ memoryId: nativeSaved.data.id, content }, nativeContext)).status, 'error');
  }
  assert.equal((await nativeTools.UpdateMemoryTool.execute({ memoryId: nativeSaved.data.id, content: '不能越界覆盖' }, { ...nativeContext, task: { assistantId: 'b' } })).status, 'error');
  assert.equal((await repository.getEntry('pool-a', nativeSaved.data.id)).content, nativeUpdated.data.content);
  assert.equal((await nativeTools.ForgetMemoryTool.execute({ memoryId: nativeSaved.data.id }, { ...nativeContext, task: { assistantId: 'b' } })).data.deleted, false);
  const first = await recall.recallMemoryForRun('a', 'run', { keywords: ['考试', '猫'] }, signal);
  assert.equal(first.entries[0].id, 'both');
  assert.equal(first.entries.length, 5);
  const frozen = first.entries[0].content;
  await repository.updateEntry('pool-a', 'both', '已改写', '已改写', later);
  await create('new-match', '猫与考试与新事', later);
  const second = await recall.recallMemoryForRun('a', 'run', { keywords: ['猫', '考试'], offset: first.nextOffset }, signal);
  assert.equal(second.total, first.total);
  assert.equal(second.entries.some((item) => item.id === 'new-match'), false);
  assert.equal(first.entries[0].content, frozen);
  assert.equal(new Set([...first.entries, ...second.entries].map((item) => item.id)).size, 10);
  await assert.rejects(recall.recallMemoryForRun('a', 'run', { query: '不同搜索', offset: 5 }, signal), domain.MemoryInputError);
  recall.releaseMemoryRecallRun('run');
  await assert.rejects(recall.recallMemoryForRun('a', 'run', { keywords: ['猫'], offset: 5 }, signal), domain.MemoryInputError);
  const unavailable = await recall.recallMemoryForRun('a', 'empty-vector', { query: '用户原句' }, signal);
  assert.ok(unavailable.semanticUnavailable);
  await assert.rejects(recall.recallMemoryForRun('a', 'empty', {}, signal), domain.MemoryInputError);

  currentModel = modelA;
  await repository.syncEmbeddingModel(modelA);
  const vectorUpdated = await nativeTools.UpdateMemoryTool.execute({ memoryId: nativeSaved.data.id, content: '启用向量后更新正文' }, { ...nativeContext, toolCallId: 'update-2' });
  assert.equal(vectorUpdated.status, 'success');
  assert.equal(vectorUpdated.data.embeddingStatus, 'pending');
  const claimed = await claim();
  const loser = await claim();
  assert.notEqual(loser?.memoryId, claimed.memoryId);
  if (loser) await repository.releaseEmbedding(loser);
  await repository.updateEntry('pool-a', claimed.memoryId, '新版正文', '新版正文', later);
  assert.equal(await repository.completeEmbedding(claimed, [1, 0]), 'discarded');
  const fresh = await claim();
  assert.equal(await repository.completeEmbedding(fresh, [1, 0]), 'accepted');
  const bytes = database.prepare('SELECT vector_json FROM memory_item_embeddings WHERE memory_id = ?').get(fresh.memoryId).vector_json;
  await repository.updateEntry('pool-a', fresh.memoryId, '第三版', '第三版', later);
  assert.equal(database.prepare('SELECT vector_json FROM memory_item_embeddings WHERE memory_id = ?').get(fresh.memoryId).vector_json, bytes);
  assert.equal((await repository.readRecallCandidates('pool-a', modelA.fingerprint, 2)).vectors.some((item) => item.memoryId === fresh.memoryId), false);
  const deletedClaim = await claim();
  await repository.deleteEntry('pool-a', deletedClaim.memoryId);
  assert.equal(await repository.completeEmbedding(deletedClaim, [1, 0]), 'discarded');
  const modelClaim = await claim();
  currentModel = modelB; await repository.syncEmbeddingModel(modelB);
  assert.equal(await repository.completeEmbedding(modelClaim, [1, 0]), 'discarded');
  const failing = await claim();
  for (let attempt = 0; attempt < 3; attempt++) {
    const task = attempt === 0 ? failing : await claim('retry-' + attempt, later);
    assert.equal(task.memoryId, failing.memoryId);
    assert.equal(await repository.failEmbedding(task, '网络不可用', false, now, now), true);
  }
  assert.equal((await repository.getEntry('pool-a', failing.memoryId)).embeddingStatus, 'failed');
  await repository.syncEmbeddingModel(modelB);
  assert.equal(database.prepare('SELECT attempts FROM memory_item_embeddings WHERE memory_id = ?').get(failing.memoryId).attempts, 3);
  await repository.retryEmbedding('pool-a', failing.memoryId);
  const cancelled = await claim();
  await repository.releaseEmbedding(cancelled);
  assert.equal(database.prepare('SELECT attempts FROM memory_item_embeddings WHERE memory_id = ?').get(cancelled.memoryId).attempts, 0);
  const retry = await claim();
  await repository.completeEmbedding(retry, [1, 0]);
  const mismatch = await claim();
  assert.equal(await repository.completeEmbedding(mismatch, [1, 0, 0]), 'dimension_mismatch');
  await repository.releaseEmbedding(mismatch);
  await assert.rejects(repository.readRecallCandidates('pool-a', modelB.fingerprint, 3), domain.MemoryVectorDimensionError);
  // Worker 的第三次失败与手动重试、取消按真实持久任务执行。
  await repository.syncEmbeddingModel(null);
  database.prepare("DELETE FROM memory_items WHERE id <> 'vector-only'").run();
  currentModel = modelA;
  embedding = async () => { throw new runtime.MemoryEmbeddingError('网络不可用', false); };
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await worker.processNextMemoryEmbedding(signal);
    assert.equal(result.processed, true);
    assert.equal(result.failedMemoryId, attempt === 2 ? 'vector-only' : null);
    database.prepare('UPDATE memory_item_embeddings SET retry_at = ?').run(now);
  }
  assert.equal((await worker.processNextMemoryEmbedding(signal)).processed, false);
  await commands.retryMemoryEmbedding('a', 'vector-only');
  embedding = async () => [1, 0];
  await worker.processNextMemoryEmbedding(signal);
  await create('lexical', '猫 考试', now);
  const semantic = await recall.recallMemoryForRun('a', 'semantic', { query: '复习', keywords: ['考试', '猫'] }, signal);
  assert.deepEqual(semantic.entries.map((item) => item.id), ['lexical', 'vector-only']);
  assert.equal(semantic.semanticUnavailable, null);

  // N=20 在生成期间保留所有原文，提交后只保留 21～25；不会周期性漏 1～5。
  for (let id = 1; id <= 25; id++) addMessage(id, '消息 ' + id, id % 2 ? 'user' : 'assistant', new Date(Date.parse(now) + id * 1000).toISOString());
  const summaryClaim = await summary.claim('conversation', 20, 'summary-claim', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai');
  assert.equal(summaryClaim.messages.length, 20);
  assert.equal((await summary.readContext('conversation', [], [])).raw.length, 25);
  assert.equal(await summary.claim('conversation', 20, 'summary-loser', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai'), null);
  await summary.create('conversation', 'user-summary', '用户先写的摘要', now, 'Asia/Shanghai');
  await summary.edit('conversation', 'user-summary', '用户编辑后的摘要', later);
  assert.equal(await appendSummary(summaryClaim, 'summary-1', '新增一段', later), true);
  assert.equal(await appendSummary(summaryClaim, 'duplicate-summary', '不能重复追加', later), false);
  let context = await summary.readContext('conversation', [25], []);
  assert.deepEqual(context.raw.map((item) => item.messageId), [21, 22, 23, 24]);
  assert.deepEqual(context.segments.map((item) => item.content), ['用户编辑后的摘要', '新增一段']);
  await summary.delete('conversation', 'summary-1');
  assert.equal((await summary.readContext('conversation', [], [])).raw.length, 5);
  assert.equal(await summary.claim('conversation', 20, 'no-rebuild', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai'), null);
  // 已处理范围由稳定游标表达，删除游标对应行也不能让旧消息重新进入原文或摘要领取。
  database.prepare('DELETE FROM messages WHERE id = 20').run();
  assert.deepEqual((await summary.readContext('conversation', [], [])).raw.map((item) => item.messageId), [21, 22, 23, 24, 25]);
  assert.equal(await summary.claim('conversation', 20, 'deleted-cursor', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai'), null);
  database.prepare('DELETE FROM messages WHERE id = 1').run();
  database.prepare('UPDATE sessions SET visible_after_message_id = 25 WHERE id = ?').run('conversation');
  assert.equal((await summary.readContext('conversation', [], [])).segments[0].content, '用户编辑后的摘要');
  assert.equal((await summary.readContext('conversation', [], [])).raw.length, 0);
  for (let id = 26; id <= 45; id++) addMessage(id, '新消息 ' + id, id % 2 ? 'user' : 'assistant', later);
  const clearClaim = await summary.claim('conversation', 20, 'clear-claim', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai');
  await summary.clear('conversation');
  assert.equal(await appendSummary(clearClaim, 'zombie', '不能复活', later), false);
  assert.equal((await summary.readContext('conversation', [], [])).raw.length, 0);
  addMessage(46, '当前用户输入', 'user', later);
  database.prepare('UPDATE conversation_turn_state SET reply_cursor = 45').run();
  assert.equal(await summary.claim('conversation', 1, 'protected-input', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai'), null);
  assert.deepEqual((await summary.readContext('conversation', [46], [])).raw, []);
  // run item 顺序优先于物理 ID／创建时间；删锚点不能改变剩余成员的排序键。
  addMessage(48, 'run 第二项', 'assistant', now, 'ordered-run', 2);
  addMessage(47, 'run 首项', 'assistant', later, 'ordered-run', 1);
  const ordered = await raw.getAllAsync(timelineOrderedMessagesCte("m.session_id = 'conversation'") + ' SELECT * FROM ordered_messages ORDER BY ' + timelineProjectionOrderBy('ASC'));
  assert.ok(ordered.findIndex((row) => row.id === 47) < ordered.findIndex((row) => row.id === 48));
  const anchor = ordered.find((row) => row.id === 48).timeline_order_anchor_id;
  database.prepare('DELETE FROM messages WHERE id = 47').run();
  const remaining = await raw.getFirstAsync(timelineOrderedMessagesCte("m.session_id = 'conversation'") + ' SELECT * FROM ordered_messages WHERE id = 48');
  assert.equal(remaining.timeline_order_anchor_id, anchor);
  summaryRuntime.configureChatSummaryRuntime({ repository: summary, getBatchSize: async () => 1,
    generateAddition: async () => '{"content":"10 月 4 日讨论 10 月 10 日考试"}' });
  assert.throws(() => summaryApplication.parseChatSummaryAddition('{"content":"新增","replace":[]}'));
  assert.equal(summaryApplication.parseChatSummaryAddition('{"content":"新增"}'), '新增');
  assert.equal(summaryApplication.parseChatSummaryAddition(JSON.stringify({ content: '  ' + '🐈'.repeat(500) + '  ' })), '🐈'.repeat(500));
  assert.throws(() => summaryApplication.parseChatSummaryAddition(JSON.stringify({ content: '猫'.repeat(501) })), /500/);
  assert.throws(() => summaryApplication.parseChatSummaryAddition(JSON.stringify({ content: '🐈'.repeat(501) })), /500/);
  const dates = buildSummaryInput({ ...summaryClaim, messages: [{ ...summaryClaim.messages[0], content: '10 月 10 日考试' }] });
  assert.ok(JSON.parse(dates).newMessagesOnly[0].localDateTime.startsWith('2026-10-04'));

  // 失败、取消和插入失败都不能推进摘要范围；成功只追加一段。
  database.prepare('UPDATE conversation_turn_state SET reply_cursor = 100').run();
  const beforeFailure = await summary.readContext('conversation', [], []);
  summaryRuntime.configureChatSummaryRuntime({ repository: summary, getBatchSize: async () => 1, generateAddition: async () => '{"content":"新增","replace":[]}' });
  await assert.rejects(summaryApplication.processChatSummary('conversation', signal));
  assert.deepEqual((await summary.readContext('conversation', [], [])).raw, beforeFailure.raw);
  assert.equal(database.prepare('SELECT claim_id FROM chat_summary_state WHERE conversation_id = ?').get('conversation').claim_id, null);
  summaryRuntime.configureChatSummaryRuntime({ repository: summary, getBatchSize: async () => 1,
    generateAddition: async () => JSON.stringify({ content: '猫'.repeat(501) }) });
  await assert.rejects(summaryApplication.processChatSummary('conversation', signal), /500/);
  assert.deepEqual(await summary.readContext('conversation', [], []), beforeFailure, '超长输出不能追加摘要或推进原文范围');
  assert.equal(database.prepare('SELECT claim_id FROM chat_summary_state WHERE conversation_id = ?').get('conversation').claim_id, null);
  const cancelledSummary = new AbortController();
  summaryRuntime.configureChatSummaryRuntime({ repository: summary, getBatchSize: async () => 1, generateAddition: async () => {
    cancelledSummary.abort(); return '{"content":"取消后不能提交"}';
  } });
  await assert.rejects(summaryApplication.processChatSummary('conversation', cancelledSummary.signal));
  assert.deepEqual((await summary.readContext('conversation', [], [])).raw, beforeFailure.raw);
  await summary.create('conversation', 'collision', '用户维护的内容', now, 'Asia/Shanghai');
  const atomicClaim = await summary.claim('conversation', 1, 'atomic-claim', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai');
  await assert.rejects(appendSummary(atomicClaim, 'collision', '不能覆盖', later));
  assert.deepEqual((await summary.readContext('conversation', [], [])).raw, beforeFailure.raw);
  await summary.releaseClaim(atomicClaim);
  summaryRuntime.configureChatSummaryRuntime({ repository: summary, getBatchSize: async () => 1, generateAddition: async () => '{"content":"成功的新摘要"}' });
  assert.equal(await summaryApplication.processChatSummary('conversation', signal), true);
  const afterSuccess = await summary.readContext('conversation', [], []);
  assert.equal(afterSuccess.raw.length, beforeFailure.raw.length - 1);
  assert.deepEqual(afterSuccess.segments.map((item) => item.content), ['用户维护的内容', '成功的新摘要']);

  // 短通话共用 N；达到门槛时必须等待挂断，统一范围包含通话前原文。
  database.prepare("INSERT INTO ai_assistants (id, agent_id, name, model, created_at, updated_at) VALUES ('calls-ai', 'actor-calls-ai', '通话 AI', 'chat', ?, ?)").run(now, now);
  database.prepare("INSERT INTO chat_conversations (id, kind) VALUES ('call-summary', 'direct')").run();
  database.prepare("INSERT INTO sessions (id, ai_assistant_id, name, created_at, updated_at) VALUES ('call-summary', 'calls-ai', '通话 AI', ?, ?)").run(now, now);
  database.prepare("INSERT INTO conversation_turn_state (session_id, reply_cursor, revision, updated_at) VALUES ('call-summary', 901, 0, ?)").run(now);
  for (const [id, role] of [[900, 'user'], [901, 'assistant']]) database.prepare(`INSERT INTO messages
    (id, session_id, text, is_me, sender_type, created_at, time, status) VALUES (?, 'call-summary', '通话前聊天', ?, ?, ?, ?, 'sent')`)
    .run(id, role === 'user' ? 1 : 0, role, '2026-10-04T03:59:00.000Z', now);
  const createCall = (id, patch = {}) => calls.createSession({ id, chatSessionId: 'call-summary', aiAssistantId: 'calls-ai',
    agentId: 'actor-calls-ai', direction: 'outgoing', requestedMode: 'video', source: 'user', state: 'ended',
    startedAt: '2026-10-04T03:59:30.000Z', acceptedAt: now, endedAt: later, ...patch });
  await createCall('short-call');
  for (const [index, kind] of ['userSpeechText', 'aiSpeechText'].entries()) await calls.appendEvent({
    id: 'short-' + index, callId: 'short-call', chatSessionId: 'call-summary', kind,
    actorType: index ? 'ai' : 'user', text: '通话里的问候', includeInAIContext: true,
    createdAt: new Date(Date.parse(now) + (index + 1) * 1000).toISOString(),
  });
  let modelInputs = [];
  summaryRuntime.configureChatSummaryRuntime({ repository: summary, getBatchSize: async () => 20,
    generateAddition: async (input) => { modelInputs.push(input); return '{"content":"我们在电话里聊了复习计划。"}'; } });
  assert.equal(await summaryApplication.processChatSummary('call-summary', signal), false, '四条对话不足 N，挂断不额外调用 AI');
  assert.equal(modelInputs.length, 0);
  let callContext = await summaryApplication.getChatSummaryContext('call-summary');
  assert.equal(timelineDomain.conversationDialogueStartIndexes(callContext.timeline).length, 4);
  assert.equal(callContext.timeline[0].source, 'chat', '统一时间线先提供通话前聊天');
  assert.equal(callContext.pendingCalls[0].transcripts.length, 2);
  await createCall('active-call', { state: 'active', endedAt: null });
  for (let index = 0; index < 121; index++) await calls.appendEvent({ id: 'speech-' + index, callId: 'active-call',
    chatSessionId: 'call-summary', kind: index % 2 ? 'aiSpeechText' : 'userSpeechText', actorType: index % 2 ? 'ai' : 'user',
    text: index === 0 ? '有点焦虑，担心复习进度' : index === 120 ? '商量好复习计划后放松了' : '讨论复习计划 ' + index,
    includeInAIContext: true, createdAt: new Date(Date.parse(now) + 130_000 + index * 1000).toISOString() });
  assert.equal(await summaryApplication.processChatSummary('call-summary', signal), false, '通话中越过 N 不能领取摘要');
  assert.equal(modelInputs.length, 0);
  callContext = await summaryApplication.getChatSummaryContext('call-summary');
  assert.equal(callContext.pendingCalls.find((call) => call.info.callId === 'active-call').transcripts.length, 121, '进行中通话不受 100 条窗口限制');
  await calls.updateSession('active-call', { state: 'ended', endedAt: later });
  const callClaim = await summary.claim('call-summary', 20, 'call-winner', now, '2099-01-01T00:00:00.000Z', 'Asia/Shanghai');
  assert.equal(await summary.claim('call-summary', 1, 'call-loser', now, later, 'Asia/Shanghai'), null, '聊天和通话只有一个持久 claim winner');
  const callInput = JSON.parse(buildSummaryInput(callClaim));
  assert.equal(callInput.sourceKind, 'conversation');
  assert.equal(callInput.newMessagesOnly[0].source, 'chat');
  assert.ok(callInput.newMessagesOnly.some((item) => item.source === 'call' && item.speaker === 'user'));
  assert.equal(callInput.newMessagesOnly.filter((item) => item.source === 'call' && item.speaker !== 'application').length, 123, '跨入通话后完整延伸到挂断，不按 N 留半通电话');
  await summary.create('call-summary', 'call-collision', '手动记录', now, 'Asia/Shanghai');
  await assert.rejects(appendSummary(callClaim, 'call-collision', '不能覆盖', later));
  assert.equal((await summaryApplication.getChatSummaryContext('call-summary')).pendingCalls.length, 2, '事务失败不能消费通话');
  await summary.edit('call-summary', 'call-collision', '用户改好的记录', later);
  assert.equal(await appendSummary(callClaim, 'call-segment', '通话前聊起复习，电话中制定计划，焦虑逐渐缓解。', later), true);
  assert.equal(await appendSummary(callClaim, 'duplicate-call', '不能重复', later), false);
  callContext = await summaryApplication.getChatSummaryContext('call-summary');
  assert.equal(callContext.pendingCalls.length, 0);
  assert.deepEqual(callContext.raw, [], '统一提交同时推进聊天游标与整通电话进度');
  assert.equal(callContext.segments[1].content, '通话前聊起复习，电话中制定计划，焦虑逐渐缓解。');
  assert.equal(callContext.segments[1].messageCount, 125);
  await summary.edit('call-summary', 'call-segment', '用户修改共同经历', later);
  assert.equal((await summaryApplication.getChatSummaryContext('call-summary')).segments[1].content, '用户修改共同经历');
  await summary.delete('call-summary', 'call-segment');
  assert.equal((await summaryApplication.getChatSummaryContext('call-summary')).pendingCalls.length, 0, '用户删段不能重建已消费通话');

  // 5000 字顺序分批；后一分片失败不提前切换原文，成功一次交接所有分片。
  await createCall('long-call', { acceptedAt: later, endedAt: '2026-10-04T06:00:00.000Z' });
  for (let index = 0; index < 24; index++) await calls.appendEvent({ callId: 'long-call', chatSessionId: 'call-summary',
    kind: index % 2 ? 'aiSpeechText' : 'userSpeechText', actorType: index % 2 ? 'ai' : 'user', text: '🐈'.repeat(500),
    includeInAIContext: true, createdAt: new Date(Date.parse(later) + index * 1000).toISOString() });
  const longContext = await summaryApplication.getChatSummaryContext('call-summary');
  let requests = 0;
  summaryRuntime.configureChatSummaryRuntime({ repository: summary, getBatchSize: async () => 20, generateAddition: async (input) => {
    assert.ok(input.messages.reduce((count, item) => count + Array.from(item.content).length, 0) <= 5000);
    if (++requests === 2) throw new Error('第二分片失败');
    return '{"content":"第一分片。"}';
  } });
  await assert.rejects(summaryApplication.processChatSummary('call-summary', signal), /第二分片失败/);
  assert.deepEqual(await summaryApplication.getChatSummaryContext('call-summary'), longContext, '分片失败保留整个尚未交接范围');
  modelInputs = [];
  summaryRuntime.configureChatSummaryRuntime({ repository: summary, getBatchSize: async () => 20, generateAddition: async (input) => {
    modelInputs.push(input);
    assert.ok(input.messages.reduce((count, item) => count + Array.from(item.content).length, 0) <= 5000);
    assert.equal(input.earlierAdditionsReadOnly.length, input.part.index - 1);
    return JSON.stringify({ content: '长通话第' + input.part.index + '段。' });
  } });
  assert.equal(await summaryApplication.processChatSummary('call-summary', signal), true);
  assert.ok(modelInputs.length > 1);
  assert.deepEqual(modelInputs.flatMap((input) => input.messages).map((item) => item.content), longContext.timeline.map((item) => item.content), '分批不重排或丢弃原文');
  const longSegments = (await summaryApplication.getChatSummaryContext('call-summary')).segments.slice(1);
  assert.equal(longSegments.reduce((count, item) => count + item.messageCount, 0), 24);
  assert.equal((await summaryApplication.getChatSummaryContext('call-summary')).pendingCalls.length, 0);
  const singleLongMessage = { ...longContext.timeline.find((item) => item.kind === 'dialogue'), content: '🐈'.repeat(10_001) };
  const singleParts = timelineDomain.splitSummaryMessages([singleLongMessage]);
  assert.deepEqual(singleParts.map((part) => Array.from(part[0].content).length), [5000, 5000, 1]);
  assert.equal(singleParts.flat().map((item) => item.content).join(''), singleLongMessage.content);
  assert.deepEqual(singleParts.flat().map((item) => item.continuation.index), [1, 2, 3]);

  // 摘要上限前后均按真实时间选取，不抢先消费下一通电话或漏掉电话后的文字。
  const chatItem = (identity, timestamp) => ({ source: 'chat', kind: 'dialogue', speaker: 'user',
    timestamp, content: identity, logicalIdentity: identity });
  const before = [chatItem('之前1', '2026-10-04T03:00:00.000Z'), chatItem('之前2', '2026-10-04T03:01:00.000Z')];
  const callItems = longContext.timeline;
  const after = [chatItem('之后1', '2026-10-04T07:00:00.000Z')];
  assert.deepEqual(timelineDomain.selectSummaryRange([...before, ...callItems, ...after], 2), before, '门槛在通话前满足时不吞入下一通电话');
  assert.deepEqual(timelineDomain.selectSummaryRange([...before, ...callItems, ...after], 27), [...before, ...callItems, ...after], '不足门槛的短尾部可以和通话后消息一起累计');

  // 旧开发版备份可能已有孤立关联；退休两种旧表均不能触碰正文、通话与处理进度。
  for (const primaryKey of ['PRIMARY KEY (segment_id)', 'PRIMARY KEY (segment_id, call_id)']) {
    const migrationDb = new DatabaseSync(':memory:');
    migrationDb.exec(`PRAGMA foreign_keys = OFF;
      CREATE TABLE chat_summary_segments (id TEXT PRIMARY KEY, content TEXT);
      INSERT INTO chat_summary_segments VALUES ('old-segment', '已有摘要不能改写');
      CREATE TABLE chat_summary_state (conversation_id TEXT PRIMARY KEY, processed_cursor TEXT);
      INSERT INTO chat_summary_state VALUES ('conversation', '已总结到这里');
      CREATE TABLE chat_summary_processed_calls (conversation_id TEXT, call_id TEXT);
      INSERT INTO chat_summary_processed_calls VALUES ('conversation', 'old-call');
      CREATE TABLE call_sessions (id TEXT PRIMARY KEY);
      INSERT INTO call_sessions VALUES ('old-call');
      CREATE TABLE chat_summary_call_segments (
        segment_id TEXT NOT NULL REFERENCES chat_summary_segments(id) ON DELETE CASCADE,
        call_id TEXT NOT NULL, media_mode TEXT NOT NULL, direction TEXT NOT NULL,
        accepted_at TEXT NOT NULL, ended_at TEXT NOT NULL, duration_seconds INTEGER NOT NULL,
        ${primaryKey});
      INSERT INTO chat_summary_call_segments VALUES ('old-segment', 'old-call', 'video', 'outgoing', '${now}', '${later}', 3600);
      INSERT INTO chat_summary_call_segments VALUES ('missing-segment', 'old-call', 'video', 'outgoing', '${now}', '${later}', 3600);
      PRAGMA foreign_keys = ON;`);
    const preservedTables = ['chat_summary_segments', 'chat_summary_state', 'chat_summary_processed_calls', 'call_sessions'];
    const before = preservedTables.map((table) => migrationDb.prepare('SELECT * FROM ' + table).all());
    try {
      assert.equal(migrationDb.prepare('PRAGMA foreign_key_check').all().length, 1);
      const { retireChatSummaryCallAssociations } = load('src/platform/persistence/sqlite/chatSummarySchema.ts');
      const migrationExecutor = { execAsync: async (sql) => migrationDb.exec(sql) };
      await retireChatSummaryCallAssociations(migrationExecutor);
      await retireChatSummaryCallAssociations(migrationExecutor);
      assert.deepEqual(preservedTables.map((table) => migrationDb.prepare('SELECT * FROM ' + table).all()), before);
      assert.equal(migrationDb.prepare("SELECT name FROM sqlite_master WHERE name = 'chat_summary_call_segments'").get(), undefined);
      assert.deepEqual(migrationDb.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { migrationDb.close(); }
  }

  // 清空使在途 claim 失效；进行中通话只保留边界后文字，未接事实不占消息额度。
  await createCall('clear-call');
  await calls.appendEvent({ callId: 'clear-call', chatSessionId: 'call-summary', kind: 'userSpeechText', actorType: 'user', text: '清空前', includeInAIContext: true, createdAt: now });
  const clearCallClaim = await summary.claim('call-summary', 1, 'call-clear', now, '2099-01-01T00:00:00.000Z', 'Asia/Shanghai');
  await summary.clear('call-summary');
  assert.equal(await appendSummary(clearCallClaim, 'call-zombie', '不能复活', later), false);
  assert.equal(await summary.renewClaim(clearCallClaim, now, later), false);
  assert.equal((await summaryApplication.getChatSummaryContext('call-summary')).pendingCalls.length, 0);
  const boundaryAt = database.prepare('SELECT cleared_at FROM chat_summary_call_boundary WHERE conversation_id = ?').get('call-summary').cleared_at;
  await createCall('post-clear-call', { state: 'active', endedAt: null });
  const postClearSpeechAt = new Date(Date.parse(boundaryAt) + 1000).toISOString();
  const postClearEndedAt = new Date(Date.parse(boundaryAt) + 2000).toISOString();
  await calls.appendEvent({ callId: 'post-clear-call', chatSessionId: 'call-summary', kind: 'userSpeechText', actorType: 'user', text: '清空前的内容', includeInAIContext: true, createdAt: now });
  await calls.appendEvent({ callId: 'post-clear-call', chatSessionId: 'call-summary', kind: 'userSpeechText', actorType: 'user', text: '清空后的约定', includeInAIContext: true, createdAt: postClearSpeechAt });
  await calls.updateSession('post-clear-call', { state: 'failed', endedAt: postClearEndedAt, endReason: 'runtimeError' });
  const partialCall = (await summaryApplication.getChatSummaryContext('call-summary')).pendingCalls[0];
  assert.deepEqual(partialCall.transcripts.map((item) => item.content), ['清空后的约定']);
  assert.equal(partialCall.historyStartsAfter, boundaryAt);
  summaryRuntime.configureChatSummaryRuntime({ repository: summary, getBatchSize: async () => 1, generateAddition: async () => '{"content":"清空后约好继续复习。"}' });
  assert.equal(await summaryApplication.processChatSummary('call-summary', signal), true);
  database.prepare("UPDATE sessions SET visible_after_at = ? WHERE id = 'call-summary'").run(postClearEndedAt);
  assert.equal((await summaryApplication.getChatSummaryContext('call-summary')).segments.length, 1, '清消息保留已有摘要');
  await calls.deleteSession('post-clear-call');
  assert.equal((await summaryApplication.getChatSummaryContext('call-summary')).segments[0].content, '清空后约好继续复习。', '删除通话保留已有摘要正文');
  await createCall('missed-call', { state: 'missed', acceptedAt: null, endedAt: new Date(Date.parse(postClearEndedAt) + 1000).toISOString() });
  const missedContext = await summaryApplication.getChatSummaryContext('call-summary');
  assert.equal(timelineDomain.conversationDialogueStartIndexes(missedContext.timeline).length, 0, '未接通话事实不占消息额度');
  assert.equal(await summaryApplication.processChatSummary('call-summary', signal), false);

  // N 只数对话，应用事件仍按 canonical 顺序进入 raw 和同一摘要事务。
  database.prepare("INSERT INTO chat_conversations (id, kind) VALUES ('events', 'direct')").run();
  database.prepare("INSERT INTO sessions (id, ai_assistant_id, name, created_at, updated_at) VALUES ('events', 'b', 'B', ?, ?)").run(now, now);
  database.prepare("INSERT INTO conversation_turn_state (session_id, reply_cursor, revision, updated_at) VALUES ('events', 106, 0, ?)").run(now);
  const insertEvent = database.prepare(`INSERT INTO messages (id, session_id, text, is_me, sender_type, created_at, time, status, metadata_json, delivery_status)
    VALUES (?, 'events', ?, ?, ?, ?, ?, ?, ?, ?)`);
  const errorMetadata = { kind: 'error', actorName: 'A' };
  const toolMetadata = { type: 'toolStatus', source: 'chatToolFlow', status: 'failed', toolNames: ['aiCreateMoment'],
    displayNames: ['发布时刻'], displayText: '调用失败：发布时刻', actorName: 'A' };
  const insert = (id, text, sender, metadata = null, status = 'sent', delivery = 'delivered') =>
    insertEvent.run(id, text, sender === 'user' ? 1 : 0, sender, now, now, status, metadata && JSON.stringify(metadata), delivery);
  insert(101, '发个朋友圈', 'user');
  insert(102, 'API Key 无效或已过期', 'system', errorMetadata);
  insert(103, '调用失败：发布时刻', 'system', toolMetadata, 'failed');
  insert(104, '正在调用工具', 'system', { ...toolMetadata, status: 'running' }, 'streaming');
  insert(105, '内部推理', 'reasoning');
  insert(106, '工具调用失败了', 'assistant');
  insert(107, '网络不可用', 'system', errorMetadata);
  insert(108, '现在能听见我吗', 'user');
  insert(109, '未完成回复', 'assistant', null, 'streaming');
  insert(110, '撤销的工具', 'system', toolMetadata, 'failed', 'cancelled');
  insert(111, '其他展示条目', 'system');
  const eventsRaw = (await summary.readContext('events', [108], [])).raw;
  assert.deepEqual(eventsRaw.map((item) => item.messageId), [101, 102, 103, 104, 106, 107]);
  assert.deepEqual(eventsRaw.map((item) => item.kind), ['dialogue', 'app_event', 'app_event', 'app_event', 'dialogue', 'app_event']);
  assert.ok(eventsRaw[1].content.includes('API Key 无效或已过期'));
  assert.ok(eventsRaw[2].content.includes('aiCreateMoment'));
  assert.equal(eventsRaw[3].pending, true, '流式行动进入原文，但尚不能交接给摘要');
  assert.equal(await summary.claim('events', 2, 'pending-activity', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai'), null,
    '摘要不能跨过尚未写完的行动，否则同一行后续增量会被游标吞掉');
  database.prepare("UPDATE messages SET text = ?, status = 'failed', metadata_json = ? WHERE id = 104")
    .run('执行因故障中断，保留已收到的输出', JSON.stringify({ ...toolMetadata, displayText: '执行因故障中断，保留已收到的输出' }));
  assert.equal(await summary.claim('events', 3, 'too-few-dialogues', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai'), null);
  const eventsClaim = await summary.claim('events', 2, 'events-claim', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai');
  assert.deepEqual(eventsClaim.messages.map((item) => item.messageId), [101, 102, 103, 104, 106, 107]);
  assert.ok(eventsClaim.messages[3].content.includes('保留已收到的输出'), '终态后摘要读取同一行的完整已保存内容');
  assert.equal(JSON.parse(buildSummaryInput(eventsClaim)).newMessagesOnly[1].speaker, 'application');
  assert.equal(await appendSummary(eventsClaim, 'events-summary', '曾因认证和网络问题断联，发布时刻工具记录为失败。', later), true);
  const eventsContext = await summary.readContext('events', [], []);
  assert.deepEqual(eventsContext.raw.map((item) => item.messageId), [108]);
  assert.equal(eventsContext.segments[0].messageCount, 2);
  assert.equal(eventsContext.segments[0].batchSize, 2);
  assert.equal(await summary.claim('events', 1, 'pending-current-input', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai'), null);
  await summary.clear('events');
  assert.deepEqual((await summary.readContext('events', [], [])).raw, []);

  // 自主 run 等待首个响应或下一工具时没有流式行，仍不能跨过整个 run。
  database.prepare("INSERT INTO ai_assistants (id, agent_id, name, model, created_at, updated_at) VALUES ('ongoing-ai', 'ongoing-actor', 'C', 'chat', ?, ?)").run(now, now);
  database.prepare("INSERT INTO chat_conversations (id, kind) VALUES ('ongoing-wake', 'direct')").run();
  database.prepare("INSERT INTO sessions (id, ai_assistant_id, name, created_at, updated_at) VALUES ('ongoing-wake', 'ongoing-ai', 'C', ?, ?)").run(now, now);
  database.prepare("INSERT INTO conversation_turn_state (session_id, reply_cursor, revision, updated_at) VALUES ('ongoing-wake', 202, 0, ?)").run(now);
  const insertOngoing = database.prepare(`INSERT INTO messages
    (id, session_id, text, is_me, sender_type, created_at, time, status, metadata_json, turn_run_id, turn_item_index)
    VALUES (?, 'ongoing-wake', ?, 0, ?, ?, ?, 'sent', ?, ?, ?)`);
  const wakeMetadata = (phase) => JSON.stringify({ type: 'agentActivity', source: 'chatAgentRun', phase, replyRunId: 'ongoing-run' });
  insertOngoing.run(200, '已开始', 'system', now, now, wakeMetadata('started'), 'ongoing-run', 1);
  insertOngoing.run(201, '完整收到的第一步', 'system', now, now, wakeMetadata('assistant'), 'ongoing-run', 2);
  insertOngoing.run(202, '后来回复的普通聊天', 'assistant', later, later, null, null, null);
  assert.equal(await summary.claim('ongoing-wake', 1, 'waiting-for-next-output', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai'), null,
    '没有 streaming 行时也不能把摘要游标推进到后来的聊天');
  insertOngoing.run(203, '下一步已经收到了', 'system', later, later, wakeMetadata('assistant'), 'ongoing-run', 3);
  insertOngoing.run(204, '执行结束', 'system', later, later,
    JSON.stringify({ ...JSON.parse(wakeMetadata('terminal')), terminalCode: 'COMPLETED' }), 'ongoing-run', 4);
  const finishedWakeClaim = await summary.claim('ongoing-wake', 1, 'finished-wake', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai');
  assert.ok(finishedWakeClaim.messages.some((item) => item.content.includes('下一步已经收到了')),
    '整个 run 到达终态后，追加输出进入同一次摘要交接');
  await summary.releaseClaim(finishedWakeClaim);

  // 图文发送与 AI 分段按逻辑消息计数，应用事件不占额度、不切断同一回复。
  database.prepare("INSERT INTO ai_assistants (id, agent_id, name, model, created_at, updated_at) VALUES ('logical-ai', 'logical-actor', 'C', 'chat', ?, ?)").run(now, now);
  database.prepare("INSERT INTO chat_conversations (id, kind) VALUES ('logical', 'direct')").run();
  database.prepare("INSERT INTO sessions (id, ai_assistant_id, name, created_at, updated_at) VALUES ('logical', 'logical-ai', 'C', ?, ?)").run(now, now);
  database.prepare("INSERT INTO conversation_turn_state (session_id, reply_cursor, revision, updated_at) VALUES ('logical', 303, 0, ?)").run(now);
  const insertLogical = database.prepare(`INSERT INTO messages
    (id, session_id, text, is_me, sender_type, created_at, time, status, logical_message_id, metadata_json)
    VALUES (?, 'logical', ?, ?, ?, ?, ?, 'sent', ?, ?)`);
  const logical = (id, sender, identity = null, metadata = null) => insertLogical.run(
    id, '相同正文', sender === 'user' ? 1 : 0, sender, now, now, identity, metadata && JSON.stringify(metadata));
  logical(301, 'user', 'user_submission:images');
  logical(302, 'user', 'user_submission:images');
  logical(303, 'user', 'user_submission:images');
  logical(304, 'assistant', 'reply-segments');
  logical(305, 'system', null, toolMetadata);
  logical(306, 'assistant', 'reply-segments');
  logical(307, 'system', null, errorMetadata);
  logical(308, 'user');
  logical(309, 'user');
  assert.equal(await summary.claim('logical', 3, 'not-enough-logical', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai'), null);
  const firstLogical = await summary.claim('logical', 1, 'first-logical', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai');
  assert.deepEqual(firstLogical.messages.map((item) => item.messageId), [301, 302, 303], '批次边界不能切开同次图文发送');
  await summary.releaseClaim(firstLogical);
  database.prepare("UPDATE conversation_turn_state SET reply_cursor = 309 WHERE session_id = 'logical'").run();
  const logicalClaim = await summary.claim('logical', 2, 'logical-claim', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai');
  assert.deepEqual(logicalClaim.messages.map((item) => item.messageId), [301, 302, 303, 304, 305, 306, 307]);
  assert.equal((await summary.readContext('logical', [], [])).raw.length, 9, '生成期间保留每个原始气泡');
  assert.equal(await appendSummary(logicalClaim, 'logical-summary', '整组图文和完整回复的摘要', later), true);
  const logicalContext = await summary.readContext('logical', [], []);
  assert.equal(logicalContext.segments[0].messageCount, 2);
  assert.equal(logicalContext.segments[0].batchSize, 2);
  assert.deepEqual(logicalContext.raw.map((item) => item.messageId), [308, 309]);
  const separateSends = await summary.claim('logical', 2, 'separate-sends', now, "2099-01-01T00:00:00.000Z", 'Asia/Shanghai');
  assert.deepEqual(separateSends.messages.map((item) => item.messageId), [308, 309], '连续发送即使正文相同也各算一条');
  await summary.releaseClaim(separateSends);

  // 外部 embedding 的响应边界，不使用网络或真实凭据。
  const { BaseAIClient } = load('src/platform/ai/BaseAIClient.ts');
  const client = new BaseAIClient({ baseURL: 'https://example.invalid/v1', apiKey: 'test', model: 'embedding' });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).input, 'US 原话');
      return { ok: true, json: async () => ({ data: [{ index: 0, embedding: [1, 2] }] }) };
    };
    assert.deepEqual((await client.embed('US 原话')).embeddings, [[1, 2]]);
    for (const payload of [null, {}, { data: [] }, { data: [{ index: 1, embedding: [1] }] },
      { data: [{ index: 0, embedding: [NaN] }] }, { data: [{ index: 0, embedding: [0, 0] }] }]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => payload });
      assert.equal((await client.embed('输入')).errorCode, 'invalid_response');
    }
    for (const [status, code] of [[401, 'authentication'], [404, 'model_unavailable'], [429, 'rate_limit'], [503, 'service'], [400, 'configuration']]) {
      globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ error: { message: '外部错误' } }) });
      assert.equal((await client.embed('输入')).errorCode, code);
    }
    globalThis.fetch = async () => { throw new DOMException('取消', 'AbortError'); };
    await assert.rejects(client.embed('输入'), (error) => error.name === 'AbortError');
  } finally { globalThis.fetch = originalFetch; }


  // 定向清旧不触及模型资产、业务选择与正文；事务失败完整回滚。
  database.exec(`CREATE TABLE memory_topics (id TEXT PRIMARY KEY); INSERT INTO memory_topics VALUES ('legacy');
    INSERT INTO auxiliary_model_configs (id, capability_kind, name, base_url, model, created_at, updated_at) VALUES ('retired-asset', 'memory_admin', '保留模型', 'https://example.invalid', 'm', '${now}', '${now}');
    UPDATE memory_model_settings SET embedding_model_config_id = 'retained-choice';
    CREATE TRIGGER reject_prompt_cleanup BEFORE DELETE ON assistant_prompt_definition_states BEGIN SELECT RAISE(ABORT, '注入升级失败'); END;
    INSERT INTO assistant_prompt_definition_states (assistant_id, definition_id, enabled, updated_at) VALUES ('a', 'context.recent_memory_capsules', 1, '${now}');`);
  await assert.rejects(migrateMemoryV3(raw), /注入升级失败/);
  assert.ok(database.prepare("SELECT id FROM memory_topics WHERE id = 'legacy'").get());
  database.exec('DROP TRIGGER reject_prompt_cleanup');
  await migrateMemoryV3(raw);
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_topics'").get(), undefined);
  assert.ok(database.prepare("SELECT id FROM auxiliary_model_configs WHERE id = 'retired-asset'").get());
  assert.equal(await repository.getEmbeddingModelId(), 'retained-choice');
  await summary.create('conversation', 'durable-summary', '长期保留的摘要', now, 'Asia/Shanghai');
  await commands.addMemoryTrigger('a', '备份绑定词', 'vector-only');
  await commands.setMemoryRecallSettings('a', { passiveLimit: 5, activePageSize: 10 });
  await bootstrap();
  assert.ok(await repository.getEntry('pool-a', 'vector-only'));
  assert.ok((await summary.readContext('conversation', [], [])).segments.some((item) => item.id === 'durable-summary'));
  database.prepare("UPDATE sessions SET visible_after_at = '2098-01-01T00:00:00.000Z' WHERE id = 'call-summary'").run();
  const retainedCallSummary = (await summary.readContext('call-summary', [], [])).segments;
  assert.equal(retainedCallSummary.length, 1, '第二次 bootstrap 保留通话摘要');
  database.close(); fs.copyFileSync(databasePath, backupPath);
  database = new DatabaseSync(databasePath); database.exec('PRAGMA foreign_keys = ON');
  await commands.forgetMemory('a', 'vector-only');
  database.close(); fs.copyFileSync(backupPath, databasePath);
  database = new DatabaseSync(databasePath); database.exec('PRAGMA foreign_keys = ON');
  await bootstrap();
  assert.equal((await repository.getEntry('pool-a', 'vector-only')).embeddingStatus, 'ready');
  assert.equal((await repository.recallPassive('pool-a', '备份绑定词'))[0].id, 'vector-only', '升级与备份恢复保留手动关系');
  assert.equal((await repository.listTriggerMemories('pool-a', catTrigger.id)).find((item) => item.memory.id === 'vector-only').autoRecall, false, '备份恢复保留手动关系的关闭开关');
  assert.ok((await summary.readContext('conversation', [], [])).segments.some((item) => item.id === 'durable-summary'));
  assert.deepEqual((await summary.readContext('call-summary', [], [])).segments, retainedCallSummary, '备份恢复保留通话事实与正文');
  assert.deepEqual(await raw.getAllAsync('PRAGMA foreign_key_check'), []);
  {
    // 摘要检索、摘要编辑 fence 与工具省略／清空摘要都使用正式链路。
    currentModel = modelA;
    await repository.syncEmbeddingModel(modelA);
    const withSummary = await repository.createEntry({ id: 'summary-case', poolId: 'pool-a', content: '约定每天互道晚安',
      summary: '纪念协议', normalizedContent: '约定每天互道晚安', now: '2000-01-01T00:00:00.000Z', writeKey: null });
    const oldSummaryClaim = await claim('summary-old');
    assert.equal(oldSummaryClaim.memoryId, withSummary.id);
    const changedSummary = await commands.editMemory('a', withSummary.id, withSummary.content, '晚安协议');
    assert.equal(changedSummary.contentRevision, withSummary.contentRevision + 1);
    assert.equal(changedSummary.rememberedAt, withSummary.rememberedAt);
    assert.equal(await repository.completeEmbedding(oldSummaryClaim, [1, 0]), 'discarded');
    embedding = async (text) => { assert.equal(text, '晚安协议\n约定每天互道晚安'); return [1, 0]; };
    await worker.processNextMemoryEmbedding(signal);
    assert.equal((await repository.getEntry('pool-a', withSummary.id)).embeddingStatus, 'ready');
    const summaryPage = await recall.recallMemoryForRun('a', 'summary-search', { keywords: ['晚安协议'] }, signal);
    assert.deepEqual(summaryPage.entries.map((entry) => entry.id), [withSummary.id]);
    await commands.addMemoryTrigger('a', '晚安协议');
    const summaryTrigger = (await repository.listTriggers('pool-a')).find((trigger) => trigger.keyword === '晚安协议');
    assert.equal(summaryTrigger.associatedCount, 1);
    assert.equal((await repository.listTriggerMemories('pool-a', summaryTrigger.id))[0].memory.summary, '晚安协议');
    await commands.setMemoryRecallSettings('a', { passiveLimit: 5, activePageSize: 10 });
    assert.equal((await repository.recallPassive('pool-a', '晚安协议'))[0].id, withSummary.id);
    await commands.setMemoryAutoRecall('a', summaryTrigger.id, withSummary.id, false);
    assert.deepEqual(await repository.recallPassive('pool-a', '晚安协议'), []);
    const summaryToolContext = { ...nativeContext, toolCallId: 'summary-create' };
    const summaryToolSaved = await nativeTools.RememberMemoryTool.execute({ content: '工具正文', summary: '工具摘要' }, summaryToolContext);
    assert.equal(summaryToolSaved.data.summary, '工具摘要');
    const preserved = await nativeTools.UpdateMemoryTool.execute({ memoryId: summaryToolSaved.data.id, content: '新版工具正文' }, summaryToolContext);
    assert.equal(preserved.data.summary, '工具摘要');
    const cleared = await nativeTools.UpdateMemoryTool.execute({ memoryId: summaryToolSaved.data.id, content: '新版工具正文', summary: '' }, summaryToolContext);
    assert.equal(cleared.data.summary, null);
    await assert.rejects(commands.editMemory('a', withSummary.id, withSummary.content, '猫'.repeat(51)), domain.MemoryInputError);
    assert.equal((await repository.getEntry('pool-a', withSummary.id)).summary, '晚安协议');

    // 跨 Feature 转存是一个 commit；拒绝删除时正文、摘要与向量待处理状态全部回滚。
    const protocols = load('src/features/protocol/infrastructure/SQLiteProtocolRepository.ts').protocolRepository;
    const { transferProtocolToMemory } = load('src/host/application/TransferProtocolToMemory.ts');
    const signals = load('src/features/memory/application/MemorySignals.ts');
    const values = (protocol) => ({ content: protocol.content, summary: protocol.summary ?? null });
    const countMemories = () => database.prepare('SELECT COUNT(*) AS count FROM memory_items').get().count;
    const conversionSource = await protocols.insert({ aiAssistantId: 'a', content: '猫'.repeat(500), summary: '协议'.repeat(25) });
    const beforeConversion = countMemories();
    let changes = 0;
    const unsubscribe = signals.subscribeMemoryChanged(() => { changes++; });
    const conversions = await Promise.allSettled([
      transferProtocolToMemory('a', conversionSource, values(conversionSource)),
      transferProtocolToMemory('a', conversionSource, values(conversionSource)),
    ]);
    assert.equal(conversions.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(countMemories(), beforeConversion + 1);
    assert.equal(changes, 1);
    assert.equal(await protocols.getById(conversionSource.id), null);
    assert.equal((await protocols.getPromptText('a')).includes(conversionSource.content), false);
    const transferred = (await repository.listEntries('pool-a')).find((entry) => entry.content === conversionSource.content);
    assert.equal(transferred.summary, conversionSource.summary);
    assert.equal(transferred.embeddingStatus, 'pending');
    assert.equal((await repository.listEntries('pool-b')).some((entry) => entry.id === transferred.id), false);
    const failingSource = await protocols.insert({ aiAssistantId: 'a', content: '失败时保留协议', summary: '回滚协议' });
    const beforeFailure = countMemories();
    const embeddingsBeforeFailure = database.prepare('SELECT COUNT(*) AS count FROM memory_item_embeddings').get().count;
    database.exec("CREATE TRIGGER reject_protocol_transfer BEFORE DELETE ON protocols BEGIN SELECT RAISE(ABORT, '协议删除失败'); END;");
    await assert.rejects(transferProtocolToMemory('a', failingSource, values(failingSource)), /协议删除失败/);
    assert.equal(countMemories(), beforeFailure);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM memory_item_embeddings').get().count, embeddingsBeforeFailure);
    assert.ok(await protocols.getById(failingSource.id));
    assert.equal(changes, 1, '回滚不能发布刷新信号');
    database.exec('DROP TRIGGER reject_protocol_transfer');
    database.exec("CREATE TRIGGER reject_memory_transfer BEFORE INSERT ON memory_items BEGIN SELECT RAISE(ABORT, '记忆创建失败'); END;");
    await assert.rejects(transferProtocolToMemory('a', failingSource, values(failingSource)), /记忆创建失败/);
    assert.ok(await protocols.getById(failingSource.id));
    database.exec('DROP TRIGGER reject_memory_transfer');
    await assert.rejects(transferProtocolToMemory('b', failingSource, values(failingSource)), /不属于当前 AI/);
    await protocols.update(failingSource.id, { content: 'AI 更新后的协议' });
    database.prepare('UPDATE protocols SET updated_at = ? WHERE id = ?').run(failingSource.updatedAt, failingSource.id);
    await assert.rejects(transferProtocolToMemory('a', failingSource, values(failingSource)), /协议已被修改/);
    const freshSource = await protocols.getById(failingSource.id);
    await assert.rejects(transferProtocolToMemory('a', freshSource, { content: '猫'.repeat(501), summary: freshSource.summary }), domain.MemoryInputError);
    assert.equal(countMemories(), beforeFailure);
    assert.equal((await protocols.getById(failingSource.id)).content, 'AI 更新后的协议');
    currentModel = null;
    await repository.syncEmbeddingModel(null);
    const plainSource = await protocols.insert({ aiAssistantId: 'a', content: '没有摘要的协议' });
    await transferProtocolToMemory('a', plainSource, { content: '编辑后直接转存的正文', summary: null });
    assert.equal(await protocols.getById(plainSource.id), null);
    const plainMemory = (await repository.listEntries('pool-a')).find((entry) => entry.content === '编辑后直接转存的正文');
    assert.equal(plainMemory.summary, null);
    assert.equal(plainMemory.embeddingStatus, 'not_requested');
    unsubscribe();
    // 新摘要在第二次启动和完整 SQLite 快照恢复后仍保留。
    await bootstrap();
    assert.equal((await repository.getEntry('pool-a', withSummary.id)).summary, '晚安协议');
    database.close(); fs.copyFileSync(databasePath, backupPath);
    database = new DatabaseSync(databasePath); database.exec('PRAGMA foreign_keys = ON');
    await commands.editMemory('a', withSummary.id, '临时改写', null);
    database.close(); fs.copyFileSync(backupPath, databasePath);
    database = new DatabaseSync(databasePath); database.exec('PRAGMA foreign_keys = ON');
    await bootstrap();
    assert.equal((await repository.getEntry('pool-a', withSummary.id)).summary, '晚安协议');
    assert.equal((await repository.getEntry('pool-a', withSummary.id)).content, '约定每天互道晚安');
    assert.equal((await repository.getEntry('pool-a', transferred.id)).summary, conversionSource.summary);
    assert.equal(await protocols.getById(conversionSource.id), null);
  }

  // 同一 JS runtime：恢复出厂后不能沿用“已初始化”缓存，默认记录必须在队列运行前重建。
  const { initDatabase } = load('src/platform/persistence/sqlite/initialization.ts');
  const { clearDB } = load('src/platform/persistence/helpers.ts');
  await initDatabase();
  assert.equal(await repository.getEmbeddingModelId(), 'retained-choice', '普通重启初始化不能覆盖用户模型选择');
  database.exec("CREATE TRIGGER reject_reset BEFORE DELETE ON memory_model_settings BEGIN SELECT RAISE(ABORT, '注入清库失败'); END;");
  await assert.rejects(clearDB(), /清空应用表失败/u);
  assert.equal(await repository.getEmbeddingModelId(), 'retained-choice', '清库回滚不能丢失用户配置');
  database.exec('DROP TRIGGER reject_reset');
  runtime.configureMemoryRuntimeDependencies({
    ...runtime.getMemoryRuntimeDependencies(),
    resolveEmbeddingModel: async () => await repository.getEmbeddingModelId() === modelA.id ? modelA : null,
  });
  for (let reset = 0; reset < 2; reset++) {
    await repository.setEmbeddingModelId(modelA.id);
    await clearDB();
    await initDatabase();
    assert.equal(await repository.getEmbeddingModelId(), null);
    assert.equal(await repository.getPreferredAssistantId(), null);
    assert.equal((await raw.getFirstAsync('SELECT model_config_id FROM speech_recognition_settings WHERE id = 1')).model_config_id, null);
    assert.equal((await raw.getFirstAsync('SELECT COUNT(*) AS count FROM auxiliary_model_configs')).count, 0);
    assert.equal((await raw.getFirstAsync('SELECT COUNT(*) AS count FROM messages')).count, 0);
    for (const table of ['chat_summary_processed_calls', 'chat_summary_call_boundary']) {
      assert.equal((await raw.getFirstAsync('SELECT COUNT(*) AS count FROM ' + table)).count, 0, '全应用重置清除通话摘要状态');
    }
    for (let route = 0; route < 3; route++) {
      assert.deepEqual(await worker.processNextMemoryEmbedding(new AbortController().signal), {
        processed: false, nextWakeAt: null, failedMemoryId: null,
      });
    }
    assert.deepEqual(await raw.getAllAsync('PRAGMA foreign_key_check'), []);
  }
  console.log('Memory V3：正文、授权、触发关系、冻结分页、向量 CAS／三次上限、摘要交接／清理、重启与备份恢复通过');
} finally {
  database.close();
  for (const filename of [databasePath, backupPath]) if (fs.existsSync(filename)) fs.unlinkSync(filename);
  fs.rmdirSync(directory);
}
