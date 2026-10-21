import * as legacyWakeSchema from './legacy-self-wake-schema-fixture.mjs';
import { chatReplyVersionSql, chatMessageMutations, installChatTimelineSchema } from './chat-timeline-fixture.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadTypeScriptModule(relativePath, mocks = {}) {
  const sourcePath = path.join(repoRoot, relativePath);
  const compiled = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, [], `${relativePath} 无法编译`);
  const module = { exports: {} };
  new Function('exports', 'require', 'module', '__filename', '__dirname', compiled.outputText)(
    module.exports,
    (specifier) => {
      assert.ok(Object.hasOwn(mocks, specifier), `${relativePath} 缺少 mock：${specifier}`);
      return mocks[specifier];
    },
    module,
    sourcePath,
    path.dirname(sourcePath),
  );
  return module.exports;
}

const companionSchema = loadTypeScriptModule(
  'src/platform/persistence/sqlite/ravenCatCompanionSchema.ts',
);
const proactiveLifeDomain = loadTypeScriptModule(
  'src/features/companion/domain/ProactiveLifeReadRepository.ts',
);
const companionDb = new DatabaseSync(':memory:');
for (const sql of [
  legacyWakeSchema.RAVEN_CAT_SELF_WAKES_SCHEMA,
  legacyWakeSchema.RAVEN_CAT_SELF_WAKES_SCHEDULED_OWNER_INDEX,
  legacyWakeSchema.RAVEN_CAT_SELF_WAKES_CLAIMED_OWNER_INDEX,
  legacyWakeSchema.RAVEN_CAT_SELF_WAKES_CONSUMED_HISTORY_INDEX,
  legacyWakeSchema.RAVEN_CAT_SELF_WAKES_CONSUMED_OCCURRED_HISTORY_INDEX,
  companionSchema.RAVEN_CAT_AI_SCHEDULES_SCHEMA,
  companionSchema.RAVEN_CAT_AI_SCHEDULES_OWNER_STATUS_TIME_INDEX,
  companionSchema.RAVEN_CAT_AI_SCHEDULES_OWNER_TIME_INDEX,
  companionSchema.RAVEN_CAT_AI_SCHEDULES_CONSUMED_HISTORY_INDEX,
  companionSchema.RAVEN_CAT_AI_SCHEDULES_CONSUMED_OCCURRED_HISTORY_INDEX,
]) companionDb.exec(sql);

let overviewTransactionCount = 0;
let overviewTransactionActive = false;
let pendingSnapshotMutation = null;
let snapshotMutationQueued = false;
const companionExecutor = {
  getFirstAsync: async (sql, params = []) => {
    const result = companionDb.prepare(sql).get(...params) ?? null;
    if (
      params[0] === 'owner-snapshot'
      && sql.includes('unified_future')
      && !snapshotMutationQueued
    ) {
      const mutate = () => {
        companionDb.prepare(`
          UPDATE raven_cat_ai_schedules
          SET status = 'claimed', claimed_by_run_id = 'run-snapshot',
              claimed_at = '2026-09-10T08:01:00.000Z',
              updated_at = '2026-09-10T08:01:00.000Z'
          WHERE schedule_id = 'snapshot-future'
        `).run();
      };
      snapshotMutationQueued = true;
      if (overviewTransactionActive) pendingSnapshotMutation = mutate;
      else mutate();
    }
    return result;
  },
  getAllAsync: async (sql, params = []) => companionDb.prepare(sql).all(...params),
  withExclusiveTransactionAsync: async (task) => {
    overviewTransactionCount += 1;
    overviewTransactionActive = true;
    try {
      return await task(companionExecutor);
    } finally {
      overviewTransactionActive = false;
      pendingSnapshotMutation?.();
      pendingSnapshotMutation = null;
    }
  },
};
const proactiveLifeRepositoryModule = loadTypeScriptModule(
  'src/features/companion/infrastructure/SQLiteProactiveLifeReadRepository.ts',
  {
    '@platform/persistence': {
      databaseCoordinator: { openTaskExecutor: () => companionExecutor },
    },
    '../domain/ProactiveLifeReadRepository': proactiveLifeDomain,
  },
);
const proactiveLifeRepository = new proactiveLifeRepositoryModule.SQLiteProactiveLifeReadRepository();

const insertWake = companionDb.prepare(`
  INSERT INTO raven_cat_self_wakes (
    wake_id, owner_ai_id, wake_at, note, status,
    created_by_run_id, claimed_by_run_id, created_at, updated_at,
    claimed_at, consumed_at, superseded_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertSchedule = companionDb.prepare(`
  INSERT INTO raven_cat_ai_schedules (
    schedule_id, owner_ai_id, remind_at, summary, details,
    source_conversation_id, source_message_ids_json, source_excerpt,
    status, claimed_by_run_id, claimed_at, consumed_at, completion_disposition, cancelled_at,
    cancelled_reason, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const createdAt = '2026-09-01T08:00:00.000Z';

function addWake({
  wakeId, ownerAIId = 'owner-a', status,
  wakeAt = '2026-09-11T08:00:00.000Z', note = null, runId = null,
  claimedAt = null, consumedAt = null, supersededAt = null,
}) {
  insertWake.run(
    wakeId, ownerAIId, wakeAt, note, status, null, runId, createdAt,
    consumedAt ?? claimedAt ?? supersededAt ?? createdAt,
    claimedAt, consumedAt, supersededAt,
  );
}

function addSchedule({
  scheduleId, ownerAIId = 'owner-a', status, remindAt, summary,
  runId = null, claimedAt = null, consumedAt = null,
  completionDisposition = consumedAt ? 'agent_terminal' : null,
  cancelledAt = null, cancelledReason = null,
}) {
  insertSchedule.run(
    scheduleId, ownerAIId, remindAt, summary, `${summary} details`, status,
    runId, claimedAt, consumedAt, completionDisposition, cancelledAt, cancelledReason, createdAt,
    consumedAt ?? claimedAt ?? cancelledAt ?? createdAt,
  );
}

const now = '2026-09-09T08:00:00.000Z';

// Future：AI Schedule 早于 Self Wake；同一绝对时间按 source rank，再按 id。
addWake({ wakeId: 'wake-future', status: 'scheduled', note: '未来醒来' });
addSchedule({ scheduleId: 'schedule-early', status: 'scheduled', remindAt: '2026-09-10T07:00:00.000Z', summary: '更早日程' });
addSchedule({ scheduleId: 'schedule-tie', status: 'scheduled', remindAt: '2026-09-11T16:00:00.000+08:00', summary: '同一时刻日程' });
addSchedule({ scheduleId: 'schedule-late', status: 'scheduled', remindAt: '2026-09-12T08:00:00.000Z', summary: '更晚日程' });
addSchedule({ scheduleId: 'schedule-overdue', ownerAIId: 'owner-unexecuted', status: 'scheduled', remindAt: '2026-09-09T07:59:59.000Z', summary: '已到期未 claim' });

// A/C：独立 owner 覆盖 Self Wake-only 与 Self Wake 更早。
addWake({ wakeId: 'wake-only', ownerAIId: 'owner-self-only', status: 'scheduled', wakeAt: '2026-09-10T00:00:00.000Z', note: '只有 Self Wake' });
addWake({ wakeId: 'wake-earlier', ownerAIId: 'owner-self-earlier', status: 'scheduled', wakeAt: '2026-09-10T00:00:00.000Z' });
addSchedule({ scheduleId: 'schedule-after-wake', ownerAIId: 'owner-self-earlier', status: 'scheduled', remindAt: '2026-09-10T01:00:00.000Z', summary: '晚于 Self Wake' });

// Running：一个 Self Wake 与多个 AI Schedule 同时 claimed。
addWake({ wakeId: 'wake-running', status: 'claimed', runId: 'run-running-wake', claimedAt: '2026-09-09T08:01:00.000Z', note: '正在醒来' });
addSchedule({ scheduleId: 'schedule-running-a', status: 'claimed', remindAt: '2026-09-09T07:30:00.000Z', summary: '运行日程 A', runId: 'run-running-a', claimedAt: '2026-09-09T08:00:00.000Z' });
addSchedule({ scheduleId: 'schedule-running-b', status: 'claimed', remindAt: '2026-09-09T07:45:00.000Z', summary: '运行日程 B', runId: 'run-running-b', claimedAt: '2026-09-09T08:01:00.000Z' });

// History：按 occurredAt（claimed_at）跨午夜、跨 source 与同 source 都必须稳定分页。
addSchedule({ scheduleId: 'history-newest', status: 'consumed', remindAt: '2026-09-08T10:00:00.000Z', summary: '最新完成', runId: 'run-history-newest', claimedAt: '2026-09-08T11:50:00.000Z', consumedAt: '2026-09-08T12:00:00.000Z' });
addSchedule({ scheduleId: 'history-schedule-b', status: 'consumed', remindAt: '2026-09-08T09:00:00.000Z', summary: '日程历史 B', runId: 'run-history-schedule-b', claimedAt: '2026-09-08T10:45:00.000Z', consumedAt: '2026-09-08T11:00:00.000Z' });
addSchedule({ scheduleId: 'history-schedule-a', status: 'consumed', remindAt: '2026-09-08T09:00:00.000Z', summary: '日程历史 A', runId: 'run-history-schedule-a', claimedAt: '2026-09-08T10:40:00.000Z', consumedAt: '2026-09-08T11:00:00.000Z', completionDisposition: 'interrupted' });
addWake({ wakeId: 'history-wake-z', status: 'consumed', wakeAt: '2026-09-08T08:00:00.000Z', runId: 'run-history-wake-z', claimedAt: '2026-09-08T10:35:00.000Z', consumedAt: '2026-09-08T11:00:00.000Z' });
addWake({ wakeId: 'history-wake-a', status: 'consumed', wakeAt: '2026-09-08T08:00:00.000Z', runId: 'run-history-wake-a', claimedAt: '2026-09-08T10:30:00.000Z', consumedAt: '2026-09-08T11:00:00.000Z' });
addWake({ wakeId: 'history-oldest', status: 'consumed', wakeAt: '2026-09-08T07:00:00.000Z', runId: 'run-history-oldest', claimedAt: '2026-09-08T09:50:00.000Z', consumedAt: '2026-09-08T10:00:00.000Z' });
addWake({ wakeId: 'history-cross-midnight-wake', ownerAIId: 'owner-cross-midnight', status: 'consumed', wakeAt: '2026-09-08T22:00:00.000Z', runId: 'run-cross-midnight-wake', claimedAt: '2026-09-08T23:59:00.000Z', consumedAt: '2026-09-09T00:10:00.000Z' });
addSchedule({ scheduleId: 'history-cross-midnight-schedule', ownerAIId: 'owner-cross-midnight', status: 'consumed', remindAt: '2026-09-08T22:30:00.000Z', summary: '跨午夜日程', runId: 'run-cross-midnight-schedule', claimedAt: '2026-09-09T00:05:00.000Z', consumedAt: '2026-09-09T00:06:00.000Z', completionDisposition: 'interrupted' });
addSchedule({ scheduleId: 'snapshot-future', ownerAIId: 'owner-snapshot', status: 'scheduled', remindAt: '2026-09-10T08:00:00.000Z', summary: '快照未来' });
addWake({ wakeId: 'wake-superseded', status: 'superseded', supersededAt: '2026-09-08T09:00:00.000Z' });
addSchedule({ scheduleId: 'schedule-cancelled', status: 'cancelled', remindAt: '2026-09-10T08:00:00.000Z', summary: '已取消', cancelledAt: '2026-09-08T09:00:00.000Z' });
addSchedule({ scheduleId: 'schedule-owner-revoked', status: 'cancelled', remindAt: '2026-09-10T09:00:00.000Z', summary: 'owner 已失效', cancelledAt: '2026-09-08T09:01:00.000Z', cancelledReason: 'owner_revoked' });

const migration = loadTypeScriptModule('src/platform/persistence/sqlite/companionScheduleMigration.ts');
companionDb.exec('CREATE TABLE assistant_tool_permissions (assistant_id TEXT, tool_name TEXT, enabled INTEGER, updated_at TEXT, PRIMARY KEY (assistant_id, tool_name))');
await migration.migrateCompanionSchedules({ execAsync: async (sql) => companionDb.exec(sql), getAllAsync: async (sql) => companionDb.prepare(sql).all(), runAsync: async (sql, params) => companionDb.prepare(sql).run(...params) });

// Chat durable timeline fixture：global runId 能跨 session 定位，并遵守 canonical ordering。
const chatDb = new DatabaseSync(':memory:');
chatDb.exec(`
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, agent_id TEXT,
    text TEXT NOT NULL, is_me INTEGER NOT NULL, sender_type TEXT NOT NULL,
    api_message_id TEXT, client_message_id TEXT, time TEXT NOT NULL,
    created_at TEXT NOT NULL, show_time_separator_before INTEGER, updated_at TEXT,
    reply_to_id INTEGER, reply_to_text TEXT, logical_message_id TEXT,
    segment_index INTEGER, segment_total INTEGER, delivery_status TEXT,
    status TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT, is_read INTEGER, voice_played_at TEXT, turn_run_id TEXT, turn_item_index INTEGER
  );
  CREATE UNIQUE INDEX idx_messages_turn_item
    ON messages(turn_run_id, turn_item_index) WHERE turn_run_id IS NOT NULL;
`);
chatDb.exec(`CREATE TABLE chat_conversations (id TEXT PRIMARY KEY, kind TEXT NOT NULL); INSERT INTO chat_conversations VALUES ('session-history','direct'), ('session-other','direct'), ('session-mixed','direct');`);
installChatTimelineSchema(chatDb);
const insertMessage = chatDb.prepare(`
  INSERT INTO messages (
    session_id, text, is_me, sender_type, time, created_at, status,
    metadata_json, turn_run_id, turn_item_index
  ) VALUES (?, ?, 0, ?, '12:00', ?, 'sent', ?, ?, ?)
`);
const scheduleMetadata = JSON.stringify({ relatedEntityType: 'raven_cat_ai_schedule', relatedEntityId: 'history-newest' });
insertMessage.run('session-history', '思考', 'reasoning', '2026-09-08T12:00:00.000Z', scheduleMetadata, 'run-history-newest', 1);
insertMessage.run('session-history', '工具状态', 'system', '2026-09-08T12:01:00.000Z', scheduleMetadata, 'run-history-newest', 2);
insertMessage.run('session-other', 'send_message', 'assistant', '2026-09-08T11:00:00.000Z', null, 'run-history-schedule-b', null);
insertMessage.run('session-mixed', '稍后 canonical', 'reasoning', '2026-09-08T11:05:00.000Z', null, 'run-history-wake-z', 1);
insertMessage.run('session-mixed', '较早 external', 'assistant', '2026-09-08T11:04:00.000Z', null, 'run-history-wake-z', null);

const chatExecutor = {
  getFirstAsync: async (sql, params = []) => chatDb.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql, params = []) => chatDb.prepare(sql).all(...params),
  runAsync: async (sql, params = []) => {
    const result = chatDb.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  },
  withExclusiveTransactionAsync: async (task) => {
    chatDb.exec('BEGIN');
    try { const result = await task(chatExecutor); chatDb.exec('COMMIT'); return result; }
    catch (error) { chatDb.exec('ROLLBACK'); throw error; }
  },
};
const messageRepositoryModule = loadTypeScriptModule(
  'src/features/chat/messages/infrastructure/SQLiteMessageRepository.ts',
  {
    '@platform/persistence': { databaseCoordinator: { openTaskExecutor: () => chatExecutor } },
    './ChatMessageMutationSql': chatMessageMutations,
      '../../reply/infrastructure/ChatReplyVersionSql': chatReplyVersionSql,
      './ChatTimelineSql': loadTypeScriptModule('src/features/chat/messages/infrastructure/ChatTimelineSql.ts'),
    '../domain/MessageTimeSeparator': { shouldShowTimeSeparatorBefore: () => false },
  },
);
const messageRepository = new messageRepositoryModule.MessageRepository();
const chatReadQueries = loadTypeScriptModule(
  'src/features/chat/messages/application/ChatReadQueries.ts',
  {
    '../../reply/delivery/AssistantMessageArrival': {},
    '../domain/chatMessageMetadata': {},
    './ChatMessageRuntime': {
      getChatMessageRuntimeDependencies: () => ({ messages: messageRepository }),
    },
  },
);
const runtimeDependencies = {
  repositories: { proactiveLife: proactiveLifeRepository },
  chat: {
    listAgentActivityEvidence: async (runIds) => runIds.map((runId) => ({
      runId, respondedAt: '2026-09-08T10:00:00.000Z',
      terminalCode: runId.includes('schedule-a') || runId.includes('cross-midnight-schedule') ? 'INTERRUPTED' : 'COMPLETED',
    })),
    findFirstVisibleTimelineAnchorsByRunIds: chatReadQueries.findFirstVisibleTimelineAnchorsByRunIds,
  },
};
const proactiveLifeQueries = loadTypeScriptModule(
  'src/features/companion/application/ProactiveLifeReadQueries.ts',
  {
    '@features/chat': chatReadQueries,
    './CompanionRuntimeDependencies': {
      getCompanionRuntimeDependencies: () => runtimeDependencies,
    },
    '../domain/ProactiveLifeReadRepository': proactiveLifeDomain,
  },
);

// A. Self Wake future only。
const selfOnlyOverview = await proactiveLifeQueries.loadProactiveLifeOverview({
  ownerAIId: 'owner-self-only', now, historyLimit: 2,
});
assert.equal(selfOnlyOverview.nextFuture.sourceType, 'ai_schedule');
assert.equal(selfOnlyOverview.futureCount, 1);

// B/F/G/H/J/M/N. Overview 是 History-first 的统一首屏。
const overview = await proactiveLifeQueries.loadProactiveLifeOverview({
  ownerAIId: 'owner-a', now, historyLimit: 2,
});
assert.deepEqual(overview.nextFuture, {
  sourceType: 'ai_schedule', sourceId: 'schedule-early', ownerAIId: 'owner-a',
  plannedAt: '2026-09-10T07:00:00.000Z', summary: '更早日程',
});
assert.equal(overview.futureCount, 4, 'overdue scheduled 不得计入真正 future');
assert.deepEqual(overview.runningItems.map((item) => [item.sourceId, item.runId]), [
  ['schedule-running-a', 'run-running-a'],
  ['schedule-running-b', 'run-running-b'],
  ['wake-running', 'run-running-wake'],
]);
assert.deepEqual(overview.recentHistory.map((item) => item.sourceId), [
  'history-newest', 'history-schedule-b',
]);
assert.deepEqual(overview.recentHistory[0].chatAnchor, {
  sessionId: 'session-history', messageId: 1, runId: 'run-history-newest',
});
assert.deepEqual(overview.recentHistory[1].chatAnchor, {
  sessionId: 'session-other', messageId: 3, runId: 'run-history-schedule-b',
});
assert.deepEqual(overview.historyNextCursor, {
  occurredAt: '2026-09-08T10:45:00.000Z',
  sourceType: 'ai_schedule',
  sourceId: 'history-schedule-b',
});

// O. overview 的三组读取必须共享一个 snapshot；模拟首个 SELECT 后排队的写入，不能污染同一 overview。
const transactionCountBeforeSnapshot = overviewTransactionCount;
const snapshotOverview = await proactiveLifeRepository.loadOverview({
  ownerAIId: 'owner-snapshot', now, historyLimit: 1,
});
assert.equal(overviewTransactionCount - transactionCountBeforeSnapshot, 1);
assert.equal(snapshotOverview.nextFuture?.sourceId, 'snapshot-future');
assert.deepEqual(snapshotOverview.runningItems, []);
assert.equal(
  companionDb.prepare('SELECT status FROM raven_cat_ai_schedules WHERE schedule_id = ?').get('snapshot-future').status,
  'claimed',
  '快照结束后排队写入才可见于后续读取',
);

// C. Self Wake 真正更早时成为 nextFuture。
const selfEarlierOverview = await proactiveLifeQueries.loadProactiveLifeOverview({
  ownerAIId: 'owner-self-earlier', now, historyLimit: 1,
});
assert.equal(selfEarlierOverview.nextFuture.sourceId, 'wake-earlier');

// D/E. Future 全局 keyset：跨 source 同一绝对时间不重不漏。
const futureIds = [];
let futureCursor = null;
do {
  const page = await proactiveLifeQueries.listProactiveLifeFuture({
    ownerAIId: 'owner-a', now, after: futureCursor, limit: 2,
  });
  futureIds.push(...page.items.map((item) => item.sourceId));
  futureCursor = page.nextCursor;
} while (futureCursor);
assert.deepEqual(futureIds, ['schedule-early', 'schedule-tie', 'wake-future', 'schedule-late']);
assert.equal(new Set(futureIds).size, futureIds.length);
assert.ok(!futureIds.includes('schedule-overdue'));

// H/I/K. History 使用单一 occurredAt global cursor 一直翻到最早。
const historyItems = [];
let historyCursor = null;
do {
  const page = await proactiveLifeQueries.listProactiveLifeHistory({
    ownerAIId: 'owner-a', now, before: historyCursor, limit: 2,
  });
  historyItems.push(...page.items);
  historyCursor = page.nextCursor;
} while (historyCursor);
assert.deepEqual(historyItems.map((item) => item.sourceId), [
  'history-newest', 'history-schedule-b', 'history-schedule-a',
  'history-wake-z', 'history-wake-a', 'history-oldest',
]);
assert.equal(new Set(historyItems.map((item) => item.sourceId)).size, historyItems.length);
assert.deepEqual(
  historyItems.map((item) => item.completionDisposition),
  ['completed', 'completed', 'interrupted', 'completed', 'completed', 'completed'],
);
assert.ok(!historyItems.some((item) => [
  'wake-superseded', 'schedule-cancelled', 'schedule-owner-revoked',
  'schedule-overdue', 'wake-running',
].includes(item.sourceId)));
assert.equal(
  historyItems.find((item) => item.sourceId === 'history-wake-z').chatAnchor.messageId,
  5,
  'mixed run 的 external item 必须按 Chat canonical timeline 成为 anchor',
);
assert.equal(
  historyItems.find((item) => item.sourceId === 'history-schedule-a').chatAnchor,
  null,
  '只有 internal final completion 时没有 durable Chat anchor',
);

// P. occurredAt 跨午夜且 terminalAt 逆序时，global cursor 仍按 claimed_at 稳定不重不漏。
const crossMidnightItems = [];
let crossMidnightCursor = null;
do {
  const page = await proactiveLifeQueries.listProactiveLifeHistory({
    ownerAIId: 'owner-cross-midnight', now, before: crossMidnightCursor, limit: 1,
  });
  crossMidnightItems.push(...page.items);
  crossMidnightCursor = page.nextCursor;
} while (crossMidnightCursor);
assert.deepEqual(crossMidnightItems.map((item) => item.sourceId), [
  'history-cross-midnight-schedule', 'history-cross-midnight-wake',
]);
assert.deepEqual(crossMidnightItems.map((item) => item.completionDisposition), [
  'interrupted', 'completed',
]);
assert.equal(new Set(crossMidnightItems.map((item) => item.sourceId)).size, 2);

// L/M/N. 单条 global anchor 不需要 sessionId，batch 对缺失 run 不返回。
assert.deepEqual(
  await chatReadQueries.findFirstVisibleTimelineMessageByRunId({ runId: 'run-history-schedule-b' }),
  { sessionId: 'session-other', messageId: 3, runId: 'run-history-schedule-b' },
);
assert.equal(
  await chatReadQueries.findFirstVisibleTimelineMessageByRunId({ runId: 'run-internal-final-only' }),
  null,
);
assert.deepEqual(
  (await chatReadQueries.findFirstVisibleTimelineAnchorsByRunIds({
    runIds: ['run-history-newest', 'run-history-newest', 'run-missing'],
  })).map((anchor) => anchor.runId),
  ['run-history-newest'],
);

// O. 新 repository instance 仍完全由 SQLite durable truth 恢复。
const restartedRepository = new proactiveLifeRepositoryModule.SQLiteProactiveLifeReadRepository();
assert.deepEqual(
  (await restartedRepository.listFuture({ ownerAIId: 'owner-a', now, limit: 10 })).items.map((item) => item.sourceId),
  futureIds,
);
assert.deepEqual(
  (await restartedRepository.loadOverview({ ownerAIId: 'owner-a', now, historyLimit: 10 })).runningItems.map((item) => item.runId),
  ['run-running-a', 'run-running-b', 'run-running-wake'],
);
assert.deepEqual(
  (await restartedRepository.listHistory({ ownerAIId: 'owner-a', now, limit: 10 })).items.map((item) => item.sourceId),
  historyItems.map((item) => item.sourceId),
);
const restartedMessageRepository = new messageRepositoryModule.MessageRepository();
assert.deepEqual(
  await restartedMessageRepository.findFirstVisibleTimelineMessageByRunId('run-history-newest'),
  overview.recentHistory[0].chatAnchor,
);

await assert.rejects(
  proactiveLifeQueries.loadProactiveLifeOverview({ ownerAIId: 'owner-a', now, historyLimit: 0 }),
  /正整数/,
);
await assert.rejects(
  proactiveLifeQueries.listProactiveLifeFuture({ ownerAIId: 'owner-a', now, limit: 0 }),
  /正整数/,
);

assert.ok(
  companionDb.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index'
      AND name = 'idx_raven_cat_ai_schedules_owner_consumed_occurred'
  `).get(),
  'AI Schedule occurredAt history partial index 必须存在',
);
const scheduleHistoryPlan = companionDb.prepare(`
  EXPLAIN QUERY PLAN
  SELECT schedule_id, claimed_at FROM raven_cat_ai_schedules
  WHERE owner_ai_id = ? AND status = 'consumed'
  ORDER BY claimed_at DESC, schedule_id DESC LIMIT ?
`).all('owner-a', 3);
assert.ok(
  scheduleHistoryPlan.some((step) => String(step.detail).includes(
    'idx_raven_cat_ai_schedules_owner_consumed_occurred',
  )),
  'AI Schedule occurredAt history 查询必须使用对应 partial index',
);

// 没有 claim 的过期安排明确显示未执行，也没有伪造 runId 或 Chat 锚点。
const missed = await proactiveLifeQueries.loadProactiveLifeOverview({ ownerAIId: 'owner-unexecuted', now, historyLimit: 5 });
assert.equal(missed.recentHistory[0].completionDisposition, 'unexecuted');
assert.equal(missed.recentHistory[0].runId, null);
assert.equal(missed.recentHistory[0].chatAnchor, null);
assert.equal(missed.recentHistory[0].modelResponded, false);

// 用真实 SQLite 验证半段正文存档、更新原行、重启结算和严格响应证据。
const activityTime = '2026-09-09T07:00:00.000Z';
const activityInput = (runId, phase, text, index, status = 'sent') => ({
  sessionId: 'session-history', text, isMe: false, senderType: phase === 'reasoning' ? 'reasoning' : 'system',
  time: '15:00', createdAt: activityTime, status, isRead: true,
  turnRunId: runId, turnItemIndex: index, clientMessageId: `${runId}:${phase}`,
  metadataJson: JSON.stringify({ type: 'agentActivity', source: 'chatAgentRun', phase, replyRunId: runId }),
});
for (const runId of ['abandoned-partial', 'active-partial', 'no-response']) {
  await messageRepository.upsertStatefulTimelineEntry({ message: activityInput(runId, 'started', '已开始', 1), previewText: null });
}
await messageRepository.upsertStatefulTimelineEntry({ message: activityInput('abandoned-partial', 'responded', 'AI 已响应', 2), previewText: null });
const initialPartial = await messageRepository.upsertStatefulTimelineEntry({
  message: activityInput('abandoned-partial', 'reasoning', '半段', 3, 'streaming'), previewText: null,
});
const expandedPartial = await messageRepository.upsertStatefulTimelineEntry({
  message: activityInput('abandoned-partial', 'reasoning', '半段思考原文', 3, 'streaming'), previewText: null,
});
assert.equal(initialPartial.message.id, expandedPartial.message.id);
assert.equal(expandedPartial.message.text, '半段思考原文');
await messageRepository.interruptInactiveAgentActivities(['active-partial'], now);
const durablePartial = chatDb.prepare('SELECT text, status FROM messages WHERE id = ?').get(initialPartial.message.id);
assert.equal(durablePartial.text, '半段思考原文');
assert.equal(durablePartial.status, 'failed');
const facts = await messageRepository.listAgentActivityEvidence(['abandoned-partial', 'active-partial', 'no-response']);
assert.equal(facts.find((item) => item.runId === 'abandoned-partial').terminalCode, 'INTERRUPTED');
assert.equal(facts.find((item) => item.runId === 'abandoned-partial').respondedAt, activityTime);
assert.equal(facts.find((item) => item.runId === 'active-partial').terminalCode, null);
assert.equal(facts.find((item) => item.runId === 'no-response').respondedAt, null);
const countBeforeSecondSettlement = chatDb.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
await messageRepository.interruptInactiveAgentActivities(['active-partial'], now);
assert.equal(chatDb.prepare('SELECT COUNT(*) AS count FROM messages').get().count, countBeforeSecondSettlement);

console.log('RavenCat Proactive Life：统一历史、未执行、增量存档与不补跑的中断结算检查通过。');
