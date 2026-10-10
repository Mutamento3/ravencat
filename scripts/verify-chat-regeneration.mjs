/** 验证重写的持久 owner、原输入、原子替换与页面隐藏；不访问用户数据库。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { installChatTimelineSchema } from './chat-timeline-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const db = new DatabaseSync(':memory:');
let writer = Promise.resolve();
const executor = {
  execAsync: async (sql) => db.exec(sql),
  getFirstAsync: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
  runAsync: async (sql, params = []) => {
    const result = db.prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  },
};
const databaseCoordinator = {
  read: async (_metadata, work) => work(executor),
  transaction(_metadata, work) {
    const next = writer.then(async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const value = await work(executor); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    });
    writer = next.catch(() => {});
    return next;
  },
  openTaskExecutor: () => ({ ...executor, withExclusiveTransactionAsync: (work) => databaseCoordinator.transaction({}, work) }),
};
const notices = [];
const releases = [];
const mocks = {
  '@platform/persistence': { databaseCoordinator },
  '@features/media': { releaseMediaAssetCandidates: async (ids) => releases.push(ids) },
  '@shared/diagnostics/TurnTimelineLog': { logTurnTimeline() {} },
  '@features/assistants': { aiAssistantRepository: {} },
  '@platform/device': {},
  'react': require('react'),
  'react-native': { ToastAndroid: { SHORT: 0, LONG: 1, show: (text) => notices.push(text) } },
};
const overrides = new Map();
const cache = new Map();
function load(relative) {
  let file = path.resolve(root, relative);
  if (!path.extname(file)) file = fs.existsSync(`${file}.ts`) ? `${file}.ts` : path.join(file, 'index.ts');
  if (overrides.has(file)) return overrides.get(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === '@shared/runtime/RuntimeSlot') return load('src/shared/runtime/RuntimeSlot.ts');
    assert.ok(id.startsWith('.'), `缺少环境依赖 ${id}`);
    return load(path.resolve(path.dirname(file), id));
  }, module, module.exports);
  return module.exports;
}
const override = (relative, value) => overrides.set(path.resolve(root, relative), value);
const { SCHEMAS, INDEXES } = load('src/platform/persistence/sqlite/schema.ts');
db.exec(`PRAGMA foreign_keys = ON;
  CREATE TABLE chat_conversations(id TEXT PRIMARY KEY, kind TEXT NOT NULL);
  CREATE TABLE ai_assistants(id TEXT PRIMARY KEY);
  INSERT INTO ai_assistants VALUES ('ai');
  CREATE TABLE sessions(id TEXT PRIMARY KEY, last_message TEXT, last_time TEXT, updated_at TEXT, visible_after_message_id INTEGER, visible_after_at TEXT);
  CREATE TABLE media_assets(id TEXT PRIMARY KEY);
`);
db.exec(SCHEMAS.messages);
installChatTimelineSchema(db);
db.exec(SCHEMAS.chatToolPackageExposure);
db.exec(INDEXES.idxTurnRunsSingleActive);
db.exec(INDEXES.idxMessagesTurnItem);
const { migrateChatRegeneration } = load('src/platform/persistence/sqlite/chatRegenerationSchema.ts');
await migrateChatRegeneration(executor);
await migrateChatRegeneration(executor);
const { messageRepository: messages } = load('src/features/chat/messages/infrastructure/SQLiteMessageRepository.ts');
const { conversationTurnRepository: turns } = load('src/features/chat/reply/infrastructure/SQLiteConversationTurnRepository.ts');
const events = load('src/features/chat/messages/events/ChatEvents.ts');
const runtime = load('src/features/chat/messages/application/ChatMessageRuntime.ts');
const time = '2026-10-09T10:00:00.000Z';
const ai = { id: 'ai', agentId: 'agent-ai', name: 'AI', model: 'current-model', apiKey: '', apiBaseUrl: '', enableTools: true };
const makeMessage = (sessionId, text, extra = {}) => ({
  sessionId, text, senderType: 'assistant', isMe: false, createdAt: time, time: '18:00', status: 'sent', ...extra,
});
const commit = (run, values) => turns.commitTurn(run, values.map((message) => ({ message })), { assistantId: 'ai', openedPackageIds: [] });
async function initial(sessionId) {
  db.prepare('INSERT INTO chat_conversations VALUES (?, ?)').run(sessionId, 'direct');
  db.prepare('INSERT INTO sessions(id, last_message, last_time, updated_at) VALUES (?, ?, ?, ?)').run(sessionId, '', time, time);
  db.prepare('INSERT INTO media_assets VALUES (?)').run(`audio-${sessionId}`);
  await databaseCoordinator.transaction({}, (tx) => turns.ensureTurnStateRowInTransaction(tx, sessionId));
  const users = await messages.commitMessages({ messages: [
    makeMessage(sessionId, '第一条用户输入', { isMe: true, senderType: 'user' }),
    makeMessage(sessionId, '第二条用户输入', { isMe: true, senderType: 'user' }),
  ], previewText: '第二条用户输入' });
  const source = await turns.claimIfIdle(sessionId, 'user_reply');
  const result = await commit(source, [
    makeMessage(sessionId, '旧思考', { senderType: 'reasoning' }),
    makeMessage(sessionId, '旧前言'),
    makeMessage(sessionId, '旧工具记录', { senderType: 'tool', metadataJson: '{"type":"toolStatus"}' }),
    makeMessage(sessionId, '旧语音', { metadataJson: JSON.stringify({ kind: 'voice', voice: { mediaAssetId: `audio-${sessionId}` } }) }),
    makeMessage(sessionId, '', { metadataJson: '{"kind":"sticker"}' }),
  ]);
  return { source, users, old: result.messages, target: result.messages.at(-1) };
}

// 用户消息、群聊、旧回合均不能重写；多气泡、语音、表情和工具不限制资格。
const first = await initial('first');
assert.equal((await turns.getRegenerationState('first')).eligibleRunId, first.source.runId);
await assert.rejects(turns.requestRegeneration('first', first.users[0].id), /只能重写/u);
await assert.rejects(turns.requestRegeneration('group', first.target.id), /只能重写/u);
const requests = await Promise.allSettled([
  turns.requestRegeneration('first', first.old[1].id), turns.requestRegeneration('first', first.target.id),
]);
assert.equal(requests.filter((value) => value.status === 'fulfilled').length, 1);
assert.equal((await turns.getRegenerationState('first')).hiddenMessageIds.length, first.old.length);
const pendingCursor = db.prepare('SELECT reply_cursor FROM conversation_turn_state WHERE session_id = ?').get('first').reply_cursor;
const rerun = await turns.claimIfIdle('first', 'user_reply');
assert.equal(rerun.kind, 'regenerate');
assert.equal(rerun.replyCursorAtClaim, pendingCursor);
assert.equal(rerun.inputCursorAtClaim, first.source.replyCursorAtClaim);
assert.equal(rerun.inputHighWatermark, first.source.inputHighWatermark);
assert.equal(await turns.claimIfIdle('first', 'user_reply'), null);

// 已发生的业务卡片和已有摘要仍保存。
const external = await messages.commitMessage({ message: makeMessage('first', '已发生的工具业务事实', {
  senderType: 'system', turnRunId: first.source.runId, turnItemIndex: null,
}), previewText: null });
db.prepare(`INSERT INTO chat_summary_segments
  (id, conversation_id, sequence, content, time_zone, created_at, updated_at)
  VALUES ('summary', 'first', 1, '已保存的旧摘要', 'Asia/Shanghai', ?, ?)`).run(time, time);
const replacement = await commit(rerun, [makeMessage('first', '新回复一'), makeMessage('first', '新回复二')]);
assert.equal(replacement.outcome, 'committed');
assert.deepEqual(replacement.mediaAssetCandidates, ['audio-first']);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE turn_run_id = ? AND turn_item_index IS NOT NULL').get(first.source.runId).n, 0);
assert.equal((await messages.getMessageById(external.id)).text, external.text);
assert.equal(db.prepare('SELECT content FROM chat_summary_segments').get().content, '已保存的旧摘要');
assert.equal(db.prepare('SELECT reply_cursor FROM conversation_turn_state WHERE session_id = ?').get('first').reply_cursor, pendingCursor);
assert.equal((await turns.getRegenerationState('first')).eligibleRunId, rerun.runId);
const { sortChatTimelineMessages } = load('src/features/chat/messages/domain/ChatTimelineOrdering.ts');
const replacementPage = await messages.getMessages('first', { limit: 50 });
assert.deepEqual(
  replacementPage.messages.map((message) => message.id),
  sortChatTimelineMessages(replacementPage.messages).map((message) => message.id),
  '旧 run 的业务卡片必须恢复自身时间顺序，SQL 与页面排序一致',
);
await turns.requestRegeneration('first', replacement.messages[0].id);
const again = await turns.claimIfIdle('first', 'user_reply');
assert.equal(again.inputCursorAtClaim, first.source.replyCursorAtClaim);
await turns.revoke(again, 'failed', 'network_error');
assert.ok(await messages.getMessageById(replacement.messages[0].id));
assert.equal((await turns.getRegenerationState('first')).sourceRunId, null);

// T3 写入失败整体回滚，不能先删除旧回复。
await turns.requestRegeneration('first', replacement.messages[0].id);
const rollback = await turns.claimIfIdle('first', 'user_reply');
db.exec("CREATE TRIGGER fail_new_reply BEFORE INSERT ON messages WHEN NEW.text = '失败插入' BEGIN SELECT RAISE(ABORT, 'insert failure'); END;");
await assert.rejects(commit(rollback, [makeMessage('first', '失败插入')]), /insert failure/u);
assert.ok(await messages.getMessageById(replacement.messages[0].id));
assert.equal(db.prepare('SELECT status FROM conversation_turn_runs WHERE run_id = ?').get(rollback.runId).status, 'active');
db.exec('DROP TRIGGER fail_new_reply');
await turns.revoke(rollback, 'failed', 'insert_failure');

// 新用户输入、手动编辑、删除、清历史都撤销提交资格；孤儿不隐式重跑工具。
for (const change of ['send', 'edit', 'delete', 'clear', 'orphan']) {
  const fixture = await initial(change);
  await turns.requestRegeneration(change, fixture.target.id);
  const run = await turns.claimIfIdle(change, 'user_reply');
  if (change === 'send') {
    await databaseCoordinator.transaction({}, async (tx) => {
      await messages.commitMessageInTransaction(tx, { message: makeMessage(change, '新用户消息', { senderType: 'user', isMe: true }), previewText: '新用户消息' });
      await turns.supersedeActiveRunInTransaction(tx, change);
    });
  } else if (change === 'edit') {
    await databaseCoordinator.transaction({}, (tx) => messages.editMessageTextInTransaction(tx, {
      messageId: fixture.users[0].id, text: '编辑原输入', previewText: '编辑原输入',
    }));
  } else if (change === 'delete') {
    await messages.deleteMessagesWithMediaCandidates([fixture.users[0].id]);
  } else if (change === 'clear') {
    await load('src/features/chat/conversation/infrastructure/SQLiteSessionRepository.ts').sessionRepository.clearConversationHistory(change);
  } else {
    assert.equal(await turns.takeOverOrphan(change, 'user_reply'), null);
  }
  assert.equal((await commit(run, [makeMessage(change, '迟到结果')])).outcome, 'fence_failed');
  assert.ok(await messages.getMessageById(fixture.target.id));
  assert.equal((await turns.getRegenerationState(change)).sourceRunId, null);
  if (change === 'send' || change === 'clear') assert.equal((await turns.getRegenerationState(change)).eligibleRunId, null);
}

// 模型输入仍通过既有执行入口，原输入区间与当前配置复用；页面只发起原生宿主。
const calls = [];
let modelBehavior = 'success';
override('src/features/chat/reply/application/BuildChatTurnAIInput.ts', {
  buildChatTurnAIInput: async (params) => {
    const users = await messages.listUserMessagesInRange(params.sessionId, params.replyCursorAtClaim, params.inputHighWatermark);
    return { userMessages: users, displayText: users.map((value) => value.text).join('\n'), turnInputMessages: users.map((value) => ({ role: 'user', content: value.text })) };
  },
});
override('src/features/chat/reply/application/AssistantReplyPersistence.ts', { normalizeAssistantResponseText: (text) => ({ text, segments: [text] }) });
override('src/features/chat/reply/application/AssistantTurnCommit.ts', { buildAssistantTurnItems: () => { throw new Error('本用例使用 Agent timeline 提交'); } });
override('src/features/chat/reply/application/CommittedAssistantSegmentDelivery.ts', { deliverCommittedAssistantSegment: async () => {} });
let arrivalRegistered = false;
const replacementReloads = [];
const stopReloadObservation = events.setChatEventBus({ emit: (name) => {
  if (name === 'messagesReloadRequested') replacementReloads.push(arrivalRegistered);
} });
override('src/features/chat/reply/delivery/AssistantMessageArrival.ts', {
  beginAssistantMessageArrival: async () => { arrivalRegistered = true; },
  finishAssistantMessageArrival: async () => { arrivalRegistered = false; },
});
override('src/features/chat/reply/application/ProcessAIReply.ts', {
  processAIReply: async (sessionId, text, config, userId, repository, callbacks, context, persistence) => {
    calls.push({ sessionId, text, config, userId, context });
    if (modelBehavior === 'failure') throw new Error('模拟网络失败');
    const items = modelBehavior === 'empty' ? [] : [{ message: makeMessage(sessionId, '宿主重写完成') }];
    await persistence.commitAgentTimeline({ sessionId, response: { text: '宿主重写完成' }, aiConfig: config, callbacks, runtimeContext: context, items });
  },
});
const { executeUserReplyTurn } = load('src/features/chat/reply/application/ExecuteUserReplyTurn.ts');
mocks['@features/chat/composition'] = {
  executeUserReplyTurn, conversationTurnRepository: turns,
  isChatReplyRunCancellationError: load('src/features/chat/reply/application/ChatReplyAbort.ts').isChatReplyRunCancellationError,
  emitChatRegenerationChanged: events.emitChatRegenerationChanged, emitChatTypingStatusChanged: events.emitChatTypingStatusChanged,
};
const { createConversationTurnCoordinator } = load('src/host/runtime/ConversationTurnCoordinator.ts');
let launches = 0;
const coordinator = createConversationTurnCoordinator({
  turns, executeTurn: executeUserReplyTurn, resolveAIConfig: async () => ai,
  executionHost: { start: async () => { launches += 1; return true; } },
});
runtime.configureChatMessageRuntime({
  messages, turns,
  regeneration: { onRequested: (sessionId) => coordinator.requestRegenerationFromHost(sessionId), onInvalidated: (sessionId) => coordinator.abortRegeneration(sessionId) },
});
const { regenerateChatReply } = load('src/features/chat/reply/application/RegenerateChatReply.ts');
for (const behavior of ['success', 'failure', 'empty']) {
  const fixture = await initial(`host-${behavior}`);
  modelBehavior = behavior;
  const before = calls.length;
  await regenerateChatReply(`host-${behavior}`, fixture.target.id);
  assert.equal(calls.length, before, '页面请求不能执行模型');
  await coordinator.executeTurnFromHost(`host-${behavior}`);
  const input = calls.at(-1);
  assert.equal(input.text, '第一条用户输入\n第二条用户输入');
  assert.equal(input.config.model, 'current-model');
  assert.equal(input.context.isRegeneration, true);
  assert.equal(input.context.historyUpperBound.messageId, fixture.users.at(-1).id);
  assert.equal(Boolean(await messages.getMessageById(fixture.target.id)), behavior !== 'success');
  assert.equal((await turns.getRegenerationState(`host-${behavior}`)).sourceRunId, null);
}
assert.equal(launches, 3);
assert.deepEqual(releases, [['audio-host-success']], '旧语音候选仅在成功替换后释放');
assert.deepEqual(replacementReloads, [true], '替换后的首次刷新必须已登记原有分段到达投影');
stopReloadObservation();

// 迟到的原生启动失败只能撤销自己的请求；新请求和它的活句柄继续工作。
const delayed = await initial('delayed');
const oldRequestRevision = await turns.requestRegeneration('delayed', delayed.target.id);
await turns.cancelRegeneration('delayed', oldRequestRevision);
const newRequestRevision = await turns.requestRegeneration('delayed', delayed.target.id);
assert.ok(newRequestRevision > oldRequestRevision);
await turns.cancelRegeneration('delayed', oldRequestRevision);
assert.equal((await turns.getRegenerationState('delayed')).sourceRunId, delayed.source.runId);
const newRequestRun = await turns.claimIfIdle('delayed', 'user_reply');
await turns.cancelRegeneration('delayed', oldRequestRevision);
assert.equal((await turns.getRegenerationState('delayed')).activeRunId, newRequestRun.runId);
await turns.cancelRegeneration('delayed', newRequestRevision);
assert.equal((await turns.getRegenerationState('delayed')).sourceRunId, null);

const lateLaunch = await initial('late-launch');
let finishFirstLaunch;
let firstLaunchStarted;
const launchStarted = new Promise((resolve) => { firstLaunchStarted = resolve; });
const launchResult = new Promise((resolve) => { finishFirstLaunch = resolve; });
let finishNewModel;
let newModelStarted;
const modelStarted = new Promise((resolve) => { newModelStarted = resolve; });
const modelResult = new Promise((resolve) => { finishNewModel = resolve; });
let launchCount = 0;
let liveParams;
const cancelledErrors = [];
const stopCancellationObservation = events.setChatEventBus({ emit: (name, payload) => {
  if (name === 'regenerationChanged' && payload.sessionId === 'late-launch' && payload.regenerationError) cancelledErrors.push(payload.regenerationError);
} });
const lateCoordinator = createConversationTurnCoordinator({
  turns, resolveAIConfig: async () => ai,
  executionHost: { start: async () => {
    if (++launchCount === 1) { firstLaunchStarted(); return launchResult; }
    return true;
  } },
  executeTurn: async (params) => { liveParams = params; newModelStarted(); return modelResult; },
});
const configureWithCoordinator = (owner) => runtime.configureChatMessageRuntime({
  messages, turns,
  regeneration: { onRequested: (sessionId) => owner.requestRegenerationFromHost(sessionId), onInvalidated: (sessionId) => owner.abortRegeneration(sessionId) },
});
configureWithCoordinator(lateCoordinator);
const firstLaunchRequest = regenerateChatReply('late-launch', lateLaunch.target.id);
const firstLaunchRejected = assert.rejects(firstLaunchRequest, /无法启动重写/u);
await launchStarted;
const pendingRevision = db.prepare('SELECT revision FROM chat_regeneration_requests WHERE session_id = ?').get('late-launch').revision;
await turns.cancelRegeneration('late-launch', pendingRevision);
await regenerateChatReply('late-launch', lateLaunch.target.id);
const runningModel = lateCoordinator.executeTurnFromHost('late-launch');
await modelStarted;
finishFirstLaunch(false);
await firstLaunchRejected;
assert.equal(lateCoordinator.hasActiveHandle('late-launch'), true);
assert.equal(liveParams.signal.aborted, false, '迟到启动失败不能 abort 后来一次重写的句柄');
assert.equal((await turns.getRegenerationState('late-launch')).activeRunId, liveParams.run.runId);
await turns.cancelRegeneration('late-launch', liveParams.run.revisionAtClaim - 1);
await lateCoordinator.abortRegeneration('late-launch');
assert.equal(liveParams.signal.aborted, true, '真正失去持久 owner 后清理原句柄');
finishNewModel('empty_reply');
await runningModel;
assert.deepEqual(cancelledErrors, [], '已经撤销的回合安静收尾，不能向新 owner 弹失败提示');
stopCancellationObservation();
configureWithCoordinator(coordinator);

// 原输入可能已被摘要移出原文，但不能直接注入原回复、工具记录或后续通话。
let historySnapshot;
mocks['@features/chat'] = { getChatSummaryContext: async () => historySnapshot };
const { PromptHistoryBuilder } = load('src/host/prompt/PromptHistoryBuilder.ts');
const history = new PromptHistoryBuilder();
historySnapshot = {
  segments: [{ content: '旧摘要原样保留', sourceStartAt: time, sourceEndAt: time, timeZone: 'Asia/Shanghai' }],
  timeline: [
    { source: 'chat', kind: 'dialogue', speaker: 'assistant', messageId: 1, content: '之前的回复', logicalIdentity: null, timestamp: time },
    { source: 'call', kind: 'dialogue', speaker: 'user', eventId: 'earlier', callId: 'call-before', content: '此前通话', logicalIdentity: null, timestamp: '2026-10-09T09:00:00.000Z' },
    { source: 'chat', kind: 'dialogue', speaker: 'assistant', messageId: 11, content: '待替换旧回复', logicalIdentity: null, timestamp: time },
    { source: 'chat', kind: 'application_event', speaker: 'user', messageId: 12, content: '旧工具记录', logicalIdentity: null, timestamp: time },
    { source: 'call', kind: 'dialogue', speaker: 'assistant', eventId: 'later', callId: 'call-after', content: '后续通话', logicalIdentity: null, timestamp: '2026-10-09T11:00:00.000Z' },
  ],
};
const limited = await history.loadPrivateSummaryContext({
  sessionId: 'first', runtimeContext: { batchedUserMessageIds: [9, 10], historyUpperBound: { messageId: 10, createdAt: time } },
});
assert.equal(limited.messages.length, 2);
assert.equal(limited.messages[0].content, '之前的回复');
assert.match(limited.messages[1].content, /此前通话/u);
assert.match(limited.summaryContent, /旧摘要原样保留/u);
const ordinary = await history.loadPrivateSummaryContext({ sessionId: 'first', runtimeContext: { batchedUserMessageIds: [9, 10] } });
assert.equal(ordinary.messages.length, 5, '普通回复保留原有历史策略');

// 真实页面 hook 在点击时隐藏整轮，失败恢复；不新增重写标记或另一个进度条。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act, create } = require('react-test-renderer');
const { useChatRegeneration } = load('src/features/chat/presentation/messages/ChatDetail/useChatRegeneration.ts');
const fixture = await initial('ui');
let ui;
function Harness() { ui = useChatRegeneration('ui', refresh); return null; }
let refreshed = 0;
const refresh = async () => { refreshed += 1; };
let renderer;
await act(async () => { renderer = create(React.createElement(Harness)); });
assert.equal(ui.eligibleRunId, fixture.source.runId);
await act(async () => { await ui.regenerate(fixture.target, fixture.old); });
assert.equal(ui.sourceRunId, fixture.source.runId);
assert.deepEqual(ui.hiddenMessageIds, fixture.old.map((message) => message.id));
modelBehavior = 'failure';
await act(async () => { await coordinator.executeTurnFromHost('ui'); });
assert.equal(ui.sourceRunId, null);
assert.ok(refreshed > 0);
assert.ok(notices.includes('模拟网络失败'));
assert.ok(await messages.getMessageById(fixture.target.id));
await act(async () => renderer.unmount());

console.log('Chat 重写：资格、整轮替换、摘要保留、并发 fence、失败恢复、宿主与页面隐藏验证通过');
db.close();
