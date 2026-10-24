/** 分享行为验证：真实消息仓储与发送事务，模型、媒体文件和 Android 宿主在外部边界替身。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { chatReplyVersionSql, chatMessageMutations, installChatTimelineSchema } from './chat-timeline-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE chat_conversations (id TEXT PRIMARY KEY, kind TEXT);
  CREATE TABLE sessions (id TEXT PRIMARY KEY, last_message TEXT, last_time TEXT, visible_after_message_id INTEGER, updated_at TEXT);
  CREATE TABLE group_chats (id TEXT PRIMARY KEY, last_message TEXT, last_time TEXT, last_message_id INTEGER, updated_at TEXT);
  CREATE TABLE media_assets (id TEXT PRIMARY KEY);
  CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, text TEXT, sender_type TEXT,
    is_me INTEGER, is_read INTEGER DEFAULT 1, status TEXT DEFAULT 'sent', time TEXT, created_at TEXT, updated_at TEXT,
    metadata_json TEXT, agent_id TEXT, api_message_id TEXT, client_message_id TEXT, voice_played_at TEXT,
    show_time_separator_before INTEGER, reply_to_id INTEGER, reply_to_text TEXT, logical_message_id TEXT,
    segment_index INTEGER, segment_total INTEGER, delivery_status TEXT DEFAULT 'delivered', tokens_used INTEGER,
    prompt_tokens INTEGER, completion_tokens INTEGER, turn_run_id TEXT, turn_item_index INTEGER);`);
installChatTimelineSchema(db);
const executor = {
  getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
  getFirstAsync: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
  runAsync: async (sql, params = []) => { const result = db.prepare(sql).run(...params); return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) }; },
};
let writer = Promise.resolve();
const coordinator = {
  transaction(_info, work) {
    const next = writer.then(async () => { db.exec('BEGIN IMMEDIATE'); try { const value = await work(executor); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } });
    writer = next.catch(() => {}); return next;
  },
  openTaskExecutor: () => ({ ...executor, withExclusiveTransactionAsync: (work) => coordinator.transaction({}, work) }),
};
const assistants = [{ id: 'ai-a', agentId: 'agent-a', name: '同名 AI', nickname: '备注甲' }, { id: 'ai-b', agentId: 'agent-b', name: '同名 AI', nickname: '备注乙' }];
let runtime, groupRuntime, snapshot;
let failHost = false, failNotice = false;
const dispatched = [], scheduled = [], notices = [], imageInputs = [];
const boundaries = new Map([
  ['./ChatTurnPresentationRuntime', { getChatInterruptedTurnContext: async () => [] }],
  ['@features/assistants', { getAssistantDisplayName: (assistant) => assistant.nickname ?? assistant.name }],
  ['expo-crypto', { randomUUID }], ['@platform/persistence', { databaseCoordinator: coordinator }],
  ['@features/stickers', { recordUserStickerUse: async () => {} }],
  ['@shared/diagnostics/TurnTimelineLog', { logTurnTimeline() {} }],
  ['@features/media', { MEDIA_ASSET_STORAGE_BACKEND: { persistentMedia: 'persistent' }, prepareMediaAssetBatch: async (inputs) => ({
    commitInTransaction: async (tx) => { const assets = []; for (const input of inputs) { const asset = { id: randomUUID() }; await tx.runAsync('INSERT INTO media_assets VALUES (?)', [asset.id]); assets.push(asset); } return { assets }; },
    finalizeAfterCommit: async () => {}, discardAfterRollback: async () => {},
  }) }],
]);
const cache = new Map();
function load(relative) {
  const requested = path.resolve(root, relative);
  const filename = requested.endsWith('.ts') && !fs.existsSync(requested) ? `${requested}x` : requested;
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', output)((id) => {
    if (boundaries.has(id)) return boundaries.get(id);
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id.endsWith('/ChatMessageRuntime') || id === './ChatMessageRuntime') return { getChatMessageRuntimeDependencies: () => runtime };
    if (id.endsWith('/ChatGroupRuntime') || id === './ChatGroupRuntime') return { getChatGroupRuntimeDependencies: () => groupRuntime };
    if (id.endsWith('/ChatPresentation')) return { getChatDetailAvailableAssistants: async () => assistants, getChatDetailCurrentUser: async () => ({ name: '枫渡' }) };
    if (id.endsWith('/ResolveCanonicalConversation')) return { resolveCanonicalConversation: async ({ aiId }) => ({ id: `direct:${aiId}` }) };
    if (id.endsWith('/ChatCallGateway')) return { getActiveChatCall: () => null, isChatSendBlockedByCall: () => false };
    if (id.endsWith('/GroupChatManagement')) return { getGroupChat: async (groupId) => groupId === 'missing' ? null : {}, listGroupChats: async () => [{ id: 'target-group', name: '目标群' }] };
    if (id.endsWith('/AgentTransientTimeline')) return { clearAgentTransientTimelineRun() {} };
    if (id === '@shared/runtime/abortSignal') return load('src/shared/runtime/abortSignal.ts');
    if (id.endsWith('/ChatEvents')) return { emitChatMessagesUpdated() {}, emitChatTurnExecutionChanged() {}, emitChatTypingStatusChanged() {}, emitChatGroupSpeechPlanChanged() { if (failNotice) throw new Error('subscriber failed'); } };
    if (id === './GroupAutoInvocationScheduler') return { scheduleGroupAutoInvocation: (params) => scheduled.push(params), acknowledgeGroupInvocationInput() {}, notifyGroupInvocationSettled() {}, cancelGroupAutoInvocation() {} };
    if (id === './GroupChatMessaging') return { invokeGroupChat() {} };
    if (id === './ResolveChatImageModelInput') return { resolveChatImageModelInput: async (params) => { imageInputs.push(params); return { parts: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }] }; } };
    if (id === './ChatMessageMutationSql') return chatMessageMutations;
    if (id === '../../reply/infrastructure/ChatReplyVersionSql') return chatReplyVersionSql;
    if (id === './ChatSummaryRuntime') return { emitChatSummaryChanged() {}, getChatSummaryRuntime: () => ({}) };
    if (id === '@features/chat/messages/domain') return load('src/features/chat/messages/domain/chatMessageMetadata.ts');
    if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), `${id}.ts`)));
    throw new Error(`未装配的外部边界 ${id} (${relative})`);
  }, module, module.exports);
  return module.exports;
}
const { MessageRepository } = load('src/features/chat/messages/infrastructure/SQLiteMessageRepository.ts');
const messages = new MessageRepository();
runtime = { messages, turnPresentation: { freeze: async () => async () => {}, interrupt: async () => {} }, assistantDirectory: { getBlockState: async () => ({ isBlocked: false }) }, turns: {
  ensureTurnStateRowInTransaction: async () => {}, supersedeActiveRunInTransaction: async () => null,
}, canonicalUserMessage: { onCommitted: async (params) => { dispatched.push(params); if (failHost) throw new Error('host unavailable'); } } };
groupRuntime = { currentUserDirectory: { getCurrent: async () => ({ name: '枫渡' }) }, groups: {
  rotateSpeechPlanForUserMessageInTransaction: async () => ({ kind: 'no_active_plan' }),
  updatePreviewInTransaction: async (tx, groupId, messageId, preview, time) => tx.runAsync('UPDATE group_chats SET last_message_id=?, last_message=?, last_time=? WHERE id=?', [messageId, preview, time, groupId]),
} };
for (const id of ['source-direct', 'source-group', 'direct:ai-a', 'direct:ai-b', 'target-group', 'legacy-target']) {
  db.prepare('INSERT INTO chat_conversations VALUES (?, ?)').run(id, id.includes('group') ? 'group' : 'direct');
  db.prepare('INSERT INTO sessions (id) VALUES (?)').run(id);
  db.prepare('INSERT INTO group_chats (id) VALUES (?)').run(id);
}
const time = '2026-10-09T08:00:00.000Z';
function insert(sessionId, text, { senderType = 'user', run = null, agentId = null, metadata = null, index = null } = {}) {
  return Number(db.prepare('INSERT INTO messages (session_id,text,sender_type,is_me,created_at,time,turn_run_id,turn_item_index,agent_id,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(sessionId, text, senderType, Number(senderType === 'user'), time, time, run, index, agentId, metadata && JSON.stringify(metadata)).lastInsertRowid);
}
const sharedDomain = load('src/features/chat/messages/domain/SharedChatRecord.ts');
const metadata = load('src/features/chat/messages/domain/chatMessageMetadata.ts');
const share = load('src/features/chat/messages/application/ShareChatMessages.ts');
const userId = insert('source-direct', '我自己的话');
insert('source-direct', '私有思考不转发', { senderType: 'reasoning', run: 'a', index: 1 });
const aiFirst = insert('source-direct', '第一步回复', { senderType: 'assistant', run: 'a', agentId: 'agent-a', index: 2, metadata: { actorName: '发送时的名字' } });
insert('source-direct', '原始工具结果不能转发', { senderType: 'tool', run: 'a', index: 3 });
insert('source-direct', '公开工具状态', { senderType: 'tool', run: 'a', index: 4, metadata: { type: 'toolStatus', status: 'completed', toolNames: ['search'], displayNames: ['查询'], source: 'chatToolFlow', displayText: '查询已完成', actorAgentId: 'agent-a' } });
const aiLast = insert('source-direct', '最终回复', { senderType: 'assistant', run: 'a', index: 5, agentId: 'agent-a' });
const source = { sessionId: 'source-direct', name: '原单聊', assistantId: 'ai-a' };
const single = await share.createChatShareSnapshot(source, [aiLast]);
assert.deepEqual(single, await share.createChatShareSnapshot(source, [aiFirst]), '单条分享和同轮任意锚点得到相同记录');
assert.equal(single.selectionCount, 1);
assert.deepEqual(single.entries.map((entry) => entry.text), ['第一步回复', '查询已完成', '最终回复']);
assert.equal(single.entries[0].author.name, '发送时的名字');
const directRecord = await share.createChatShareSnapshot(source, [aiLast, userId]);
assert.equal(directRecord.entries[0].author.kind, 'user');
assert.equal(directRecord.entries[0].author.name, '枫渡');
const groupUser = insert('source-group', '群聊里用户的话', { metadata: { groupChat: { actorName: '当时用户名称' } } });
const groupA = insert('source-group', 'A 的发言', { senderType: 'assistant', agentId: 'agent-a', run: 'group-a' });
const groupB = insert('source-group', 'B 的发言', { senderType: 'assistant', agentId: 'agent-b', run: 'group-b' });
const groupRecord = await share.createChatShareSnapshot({ sessionId: 'source-group', name: '来源群' }, [groupB, groupUser, groupA]);
assert.equal(groupRecord.entries[0].author.name, '当时用户名称');
for (const agentId of ['agent-a', 'agent-b']) {
  const text = sharedDomain.buildSharedChatRecordText(groupRecord, '', agentId);
  const lines = text.split('\n').slice(2, -1).map(JSON.parse);
  assert.equal(lines.filter((line) => line.author.includes('，自己')).length, 1);
  assert.equal(lines.find((line) => line.author.includes('，自己')).agent_id, agentId, '同名成员按 agent_id 分清自己');
}
assert.ok(!JSON.stringify(groupRecord).includes('自己'), '持久快照不固化接收者身份');
const destinations = await share.listChatShareTargets();
for (const record of [directRecord, groupRecord]) for (const kind of ['direct', 'group']) {
  const target = destinations.find((item) => item.kind === kind);
  const clientMessageId = randomUUID();
  const before = db.prepare('SELECT count(*) AS n FROM messages').get().n;
  await share.shareChatRecord({ target, record, comment: '请看看这段记录', clientMessageId });
  const sessionId = kind === 'direct' ? 'direct:ai-a' : 'target-group';
  const rows = (await messages.getMessages(sessionId, { limit: 100 })).messages;
  const [recordRow, commentRow] = rows.slice(-2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, before + 2);
  assert.equal(recordRow.senderType, 'user'); assert.equal(commentRow.senderType, 'user');
  assert.deepEqual(metadata.getMessageSharedRecord(recordRow), record);
  assert.equal(recordRow.text, '', '附言不再写入记录卡');
  assert.equal(commentRow.text, '请看看这段记录');
  assert.equal(metadata.getMessageSharedRecord(commentRow), null, '附言是一条可独立改写、删除、分享的普通用户消息');
  assert.equal(commentRow.clientMessageId, clientMessageId);
  const ownerInputId = kind === 'direct' ? dispatched.at(-1).message.id : scheduled.at(-1).latestUserMessageId;
  assert.equal(ownerInputId, commentRow.id, '一次分享以附言作为尾消息，只启动一次回复');
  assert.equal(db.prepare('SELECT last_message FROM sessions WHERE id=?').get(sessionId).last_message, '请看看这段记录');
}
assert.equal(dispatched.length, 2); assert.equal(scheduled.length, 2);
// 第二条附言失败时，第一条记录与预览也必须回滚；不能先让 AI 回复半次分享。
const beforeRollback = db.prepare('SELECT count(*) AS n FROM messages').get().n;
const beforeDispatches = dispatched.length, beforeSchedules = scheduled.length;
db.exec("CREATE TRIGGER reject_share_comment BEFORE INSERT ON messages WHEN NEW.text='拒绝的附言' BEGIN SELECT RAISE(ABORT, 'comment rejected'); END");
for (const kind of ['direct', 'group']) {
  const target = destinations.find((item) => item.kind === kind);
  await assert.rejects(share.shareChatRecord({ target, record: directRecord, comment: '拒绝的附言', clientMessageId: randomUUID() }), /comment rejected/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, beforeRollback);
}
db.exec('DROP TRIGGER reject_share_comment');
assert.equal(dispatched.length, beforeDispatches); assert.equal(scheduled.length, beforeSchedules);
const twenty = Array.from({ length: 20 }, (_, index) => insert('source-group', `第 ${index + 1} 条`));
const full = await share.createChatShareSnapshot({ sessionId: 'source-group', name: '来源群' }, twenty.toReversed());
assert.equal(full.selectionCount, 20); assert.equal(full.entries.length, 20);
assert.equal(full.entries[0].text, '第 1 条', '分享按时间线顺序，与勾选顺序无关');
failHost = true;
const warning = await share.shareChatRecord({ target: destinations[0], record: directRecord, comment: '', clientMessageId: randomUUID() });
assert.match(warning.warning, /已分享/); failHost = false;
failNotice = true;
await share.shareChatRecord({ target: destinations.find((target) => target.kind === 'group'), record: groupRecord, comment: '', clientMessageId: randomUUID() });
assert.equal(scheduled.length, 3, '通知订阅者失败仍保留提交事实并安排群回复'); failNotice = false;
await assert.rejects(share.createChatShareSnapshot(source, []), /请选择/);
await assert.rejects(share.createChatShareSnapshot(source, Array(21).fill(aiLast)), /请选择/);
await assert.rejects(share.createChatShareSnapshot(source, [groupA]), /重新选择/);
await assert.rejects(share.shareChatRecord({ target: { kind: 'group', id: 'missing' }, record: directRecord, comment: '', clientMessageId: randomUUID() }), /已删除/);

// 来源更改或删除之后，快照正文与已提交记录仍然完整。
db.prepare('UPDATE messages SET text=? WHERE id=?').run('改过的正文', aiFirst);
await messages.deleteMessagesWithMediaCandidates([userId, aiFirst, aiLast]);
assert.equal(directRecord.entries[1].text, '第一步回复');
await share.shareChatRecord({ target: destinations[1], record: directRecord, comment: '', clientMessageId: randomUUID() });

db.prepare('INSERT INTO media_assets VALUES (?)').run('image-asset');
const mediaId = insert('source-group', '这是图片和文件', { metadata: { kind: 'mixed', attachments: [
  { id: 'image', type: 'image', source: 'gallery', fileName: 'cat.png', mediaAssetId: 'image-asset' },
  { id: 'file', type: 'file', source: 'document', fileName: 'note.txt', localUri: 'file:///note.txt', parsedText: '文件完整正文' },
] } });
const mediaRecord = await share.createChatShareSnapshot({ sessionId: 'source-group', name: '来源群' }, [mediaId]);
await share.shareChatRecord({ target: destinations[0], record: mediaRecord, comment: '', clientMessageId: randomUUID() });
const targetMediaMessage = (await messages.getMessages('direct:ai-a', { limit: 100 })).messages.at(-1);
const adopted = metadata.getMessageSharedRecord(targetMediaMessage);
assert.equal(adopted.entries[0].attachments[0].mediaAssetId, 'image-asset');
assert.ok(adopted.entries[0].attachments[1].mediaAssetId);
assert.equal(adopted.entries[0].attachments[1].localUri, undefined, '旧 URI 在原发送事务内归入媒体资产');
await messages.deleteMessagesWithMediaCandidates([mediaId]);
assert.ok(db.prepare("SELECT count(*) AS n FROM messages, json_tree(messages.metadata_json) j WHERE json_valid(messages.metadata_json) AND j.key='mediaAssetId' AND j.value='image-asset'").get().n > 0, '来源删除后分享副本仍拥有媒体引用');
const inputBuilder = load('src/features/chat/reply/application/BuildChatBatchAIInput.ts');
const mediaInput = await inputBuilder.buildChatUserMessageModelInput(targetMediaMessage, 'ai-a', 'agent-a');
assert.ok(Array.isArray(mediaInput.modelInput)); assert.match(mediaInput.displayText, /文件完整正文/);
assert.match(imageInputs.at(-1).contextText, /枫渡（用户）/);
db.prepare('INSERT INTO media_assets VALUES (?)').run('released-before-share');
const lateMedia = insert('source-group', '', { metadata: { kind: 'image', attachments: [{ id: 'late', type: 'image', source: 'gallery', fileName: 'late.png', mediaAssetId: 'released-before-share' }] } });
const lateSnapshot = await share.createChatShareSnapshot({ sessionId: 'source-group', name: '来源群' }, [lateMedia]);
await messages.deleteMessagesWithMediaCandidates([lateMedia]);
db.prepare('DELETE FROM media_assets WHERE id=?').run('released-before-share');
const beforeLateShare = db.prepare('SELECT count(*) AS n FROM messages').get().n;
await assert.rejects(share.shareChatRecord({ target: destinations[0], record: lateSnapshot, comment: '', clientMessageId: randomUUID() }), /released-before-share/);
assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, beforeLateShare, '媒体在预览期间失去最后引用时，发送事务整体拒绝，不能留下悬空记录');
const makeSharedMessage = (record) => ({ id: 999, sessionId: 'test', text: '附言', senderType: 'user', isMe: true, status: 'sent', createdAt: time, metadataJson: JSON.stringify({ kind: 'shared_record', sharedRecord: record }) });
const forwarded = makeSharedMessage(groupRecord);
const context = load('src/features/chat/summary/domain/ChatContext.ts').projectChatContextMessage(forwarded, [time, 999, 0, 999]);
assert.match(context.content, /A 的发言/); assert.match(context.content, /agent-a/);
const timeline = load('src/features/chat/summary/domain/ChatSummaryTimeline.ts').buildConversationTimeline([context], []);
snapshot = { timeline, segments: [], contextSegments: [], settings: { generationEnabled: true, fixedMessageId: null } };
boundaries.set('@features/chat', { ...metadata, ...sharedDomain, ...inputBuilder, getChatInterruptedTurnContext: async () => [], getChatSummaryContext: async () => snapshot });
boundaries.set('@shared/prompt', load('src/shared/prompt/messageTimestamp.ts'));
const history = load('src/host/prompt/PromptHistoryBuilder.ts').promptHistoryBuilder;
for (const agentId of ['agent-a', 'agent-b']) {
  const result = await history.loadPrivateSummaryContext({ sessionId: 'test', aiConfig: { id: agentId, agentId }, runtimeContext: { forceAppendUserText: true } });
  assert.equal(result.messages[0].role, 'user', '自己的历史发言也保持在转发用户消息内部');
  assert.match(result.messages[0].content, new RegExp(`agent_id=${agentId}，自己`));
  const historical = await history.buildRuntimeMessageContent(forwarded, true, { groupChat: { currentTurnUserMessageIds: [] } }, agentId, agentId);
  assert.match(historical, new RegExp(`agent_id=${agentId}，自己`));
  const current = await history.buildRuntimeMessageContent(forwarded, true, { groupChat: { currentTurnUserMessageIds: [999] } }, agentId, agentId);
  assert.match(current, new RegExp(`agent_id=${agentId}，自己`));
}
const turn = await load('src/features/chat/reply/application/BuildChatTurnAIInput.ts').buildChatTurnAIInput({
  repository: { listUserMessagesInRange: async () => [forwarded] }, sessionId: 'test', replyCursorAtClaim: 0, inputHighWatermark: 999, assistantId: 'ai-b', agentId: 'agent-b',
});
assert.equal(turn.turnInputMessages[0].role, 'user'); assert.match(turn.turnInputMessages[0].content, /agent_id=agent-b，自己/);
const splitTurn = await load('src/features/chat/reply/application/BuildChatTurnAIInput.ts').buildChatTurnAIInput({
  repository: { listUserMessagesInRange: async () => [
    { ...forwarded, text: '' },
    { ...forwarded, id: 1000, text: '请比较这些意见', metadataJson: null },
  ] },
  sessionId: 'test', replyCursorAtClaim: 0, inputHighWatermark: 1000, assistantId: 'ai-b', agentId: 'agent-b',
});
assert.equal(splitTurn.turnInputMessages.length, 2, '同一轮回复完整读取记录及独立附言');
assert.match(splitTurn.turnInputMessages[0].content, /agent_id=agent-b，自己/);
assert.equal(splitTurn.turnInputMessages[1].role, 'user');
assert.equal(splitTurn.turnInputMessages[1].content, '请比较这些意见');
const admin = load('src/features/chat/group/application/GroupAdminReplyParser.ts').buildGroupAdminInput({ groupName: '目标群', memberAliases: [], candidateAliases: [], userMessages: [forwarded], recentMessages: [] });
assert.match(admin, /A 的发言/); assert.ok(!admin.includes(groupRecord.sourceName), '模型不读取界面来源标题');
const summary = JSON.parse(load('src/features/chat/summary/application/ChatSummary.ts').buildChatSummaryModelInput({ timeZone: 'Asia/Shanghai', part: { index: 1, total: 1 }, calls: [], previous: [], earlierAdditionsReadOnly: [], messages: timeline }, 'agent-b'));
assert.equal(summary.currentAgentId, 'agent-b'); assert.match(summary.newMessagesOnly[0].content, /agent-a/);
assert.equal(metadata.getMessageSharedRecord({ metadataJson: JSON.stringify({ kind: 'shared_record', sharedRecord: {} }) }), null);

// 空群首条输入就是无附言分享：真实输入窗口、管理员规划、计划任务与终止接缝。
{
  db.exec(`CREATE TABLE group_speech_plans (
    id TEXT PRIMARY KEY, group_id TEXT, status TEXT, invoked_user_message_ids_json TEXT,
    last_included_message_id INTEGER, supersedes_plan_id TEXT, started_at TEXT,
    completed_at TEXT, error_message TEXT, created_at TEXT, updated_at TEXT);
    CREATE UNIQUE INDEX one_active_group_plan ON group_speech_plans(group_id) WHERE status IN ('pending','preparing','running');
    CREATE TABLE group_speech_tasks (id TEXT PRIMARY KEY, plan_id TEXT, group_id TEXT,
    ai_assistant_id TEXT, agent_id TEXT, sequence_order INTEGER, source TEXT, status TEXT,
    visible_reply_committed INTEGER DEFAULT 0, started_at TEXT, completed_at TEXT,
    error_message TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE group_chat_members (id TEXT PRIMARY KEY, group_id TEXT, ai_assistant_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1, muted INTEGER NOT NULL DEFAULT 0, joined_during_plan_id TEXT);`);
  boundaries.set('@features/profile', { removeConversationWallpaperInTransaction() {} });
  const { GroupChatRepository } = load('src/features/chat/group/infrastructure/SQLiteGroupChatRepository.ts');
  const groups = new GroupChatRepository();
  const previousRuntime = groupRuntime;
  const adminRequests = [], memberTurns = [];
  let holdAdmin = false, adminStarted;
  boundaries.set('@platform/ai', {
    getErrorDisplayInfo: (error) => ({ message: String(error) }),
    createAIClient: () => ({ chat: async (modelMessages, { signal }) => {
      adminRequests.push({ modelMessages, signal });
      adminStarted?.();
      if (holdAdmin) await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      return { success: true, text: '["member_1"]' };
    } }),
  });
  boundaries.set('../../reply/application/ChatReplyRuntimeDependencies', {
    getChatReplyRuntimeDependencies: () => ({ prompt: { assembleStandalone: async ({ currentInput }) => ({ systemPrompt: '', modelMessages: [{ role: 'user', content: currentInput }] }) } }),
  });
  boundaries.set('./GroupSpeechTaskExecution', { executeGroupSpeechTasks: async (params) => {
    memberTurns.push(params);
    for (;;) {
      const task = await groups.claimNextQueuedSpeechTask(params.planId);
      if (!task) break;
      await groups.updateSpeechTaskStatus(task.id, 'completed', { expectedStatus: 'running' });
    }
  } });
  const { invokeGroupChat } = load('src/features/chat/group/application/GroupChatMessaging.ts');
  const { terminateGroupSpeechPlan } = load('src/features/chat/group/application/GroupSpeechTermination.ts');
  groupRuntime = {
    ...previousRuntime, assistantDirectory: { getById: async (id) => assistants.find((ai) => ai.id === id) },
    groups: Object.assign(groups, { getById: async (id) => ({
      group: { id, name: '首次分享群' },
      members: assistants.map((ai) => ({ aiAssistantId: ai.id, agentId: ai.agentId, name: ai.name, enabled: true })),
      adminConfig: { model: 'admin-model', contextMessageCount: 20 },
    }) }),
  };
  for (const id of ['empty-share-group', 'cancel-share-group', 'supersede-share-group']) {
    db.prepare('INSERT INTO chat_conversations VALUES (?, ?)').run(id, 'group');
    db.prepare('INSERT INTO sessions (id) VALUES (?)').run(id);
    db.prepare('INSERT INTO group_chats (id) VALUES (?)').run(id);
    for (const ai of assistants) {
      db.prepare('INSERT INTO group_chat_members (id, group_id, ai_assistant_id) VALUES (?, ?, ?)').run(`${id}:${ai.id}`, id, ai.id);
    }
    await share.shareChatRecord({ target: { kind: 'group', id }, record: directRecord, comment: '', clientMessageId: randomUUID() });
  }
  const result = await invokeGroupChat('empty-share-group');
  assert.equal(result.success, true, result.error);
  assert.equal(adminRequests.length, 1);
  const input = adminRequests[0].modelMessages[0];
  assert.equal(input.role, 'user');
  assert.match(input.content, /最终回复/); assert.match(input.content, /我自己的话/);
  assert.ok(!input.content.includes(directRecord.sourceName), '管理员输入不读取分享卡片的界面标题'); assert.match(input.content, /member_1/);
  assert.match(input.content, /最近可见上下文：\n无$/, '没有本群旧消息也有完整本轮分享输入');
  assert.equal(memberTurns.length, 1);
  assert.deepEqual(metadata.getMessageSharedRecord(memberTurns[0].currentUserMessages[0]), directRecord);
  assert.equal((await groups.getLatestSpeechPlan('empty-share-group')).status, 'completed');
  holdAdmin = true;
  const started = new Promise((resolve) => { adminStarted = resolve; });
  const pending = invokeGroupChat('cancel-share-group');
  await started;
  assert.equal((await groups.getRunningSpeechPlan('cancel-share-group')).status, 'preparing');
  assert.equal(await terminateGroupSpeechPlan('cancel-share-group'), true);
  const cancelled = await pending;
  assert.equal(cancelled.error, null, '主动终止不向页面报告召唤失败');
  assert.equal(adminRequests.at(-1).signal.aborted, true, '强制终止结束管理员在途请求');
  assert.equal((await groups.getLatestSpeechPlan('cancel-share-group')).status, 'terminated');
  assert.equal(memberTurns.length, 1, '终止后不回退全量召唤、不生成成员发言');
  const countAfterTermination = db.prepare('SELECT count(*) AS n FROM messages WHERE session_id=?').get('cancel-share-group').n;
  assert.equal(countAfterTermination, 1, '用户取消不插入管理员失败消息');
  const supersedeStarted = new Promise((resolve) => { adminStarted = resolve; });
  const staleInvocation = invokeGroupChat('supersede-share-group');
  await supersedeStarted;
  const stalePlan = await groups.getRunningSpeechPlan('supersede-share-group');
  await load('src/features/chat/group/application/GroupUserMessaging.ts').sendGroupUserMessage({
    groupId: 'supersede-share-group', text: '再补充一句', clientMessageId: randomUUID(),
  });
  assert.equal((await staleInvocation).error, null);
  assert.equal(adminRequests.at(-1).signal.aborted, true, '新用户输入换代也中止旧管理员请求');
  assert.equal(db.prepare('SELECT status FROM group_speech_plans WHERE id=?').get(stalePlan.id).status, 'superseded');
  assert.equal((await groups.getRunningSpeechPlan('supersede-share-group')).status, 'pending');
  assert.equal(memberTurns.length, 1, '旧管理员被取消后不能激活成员队列');
  groupRuntime = previousRuntime;
}

// 页面取消、发送互斥、失败保留快照以及 commit 后警告仍结束分享。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'), renderer = require('react-test-renderer');
let resolveSend, sent = 0, shared = 0, mode = 'pending';
boundaries.set('react-native', { ToastAndroid: { SHORT: 0, LONG: 1, show: (message) => notices.push(message) } });
boundaries.set('../../../messages/application/ShareChatMessages', { createChatShareSnapshot: async () => groupRecord, listChatShareTargets: async () => destinations,
  shareChatRecord: async () => { sent++; if (mode === 'failed') throw new Error('发送失败'); if (mode === 'warning') return { warning: '已分享，回复启动失败' }; return new Promise((resolve) => { resolveSend = resolve; }); } });
const { useChatMessageShare } = load('src/features/chat/presentation/messages/components/useChatMessageShare.ts');
let state, props = { sessionId: 'source-group', sourceName: '来源群', isActive: true, onShared: () => shared++ };
function Harness() { state = useChatMessageShare(props); return null; }
let rendered;
await renderer.act(async () => { rendered = renderer.create(React.createElement(Harness)); });
await renderer.act(async () => state.open([groupA]));
await renderer.act(async () => state.choose(destinations[0]));
await renderer.act(async () => state.close());
assert.equal(state.visible, false); assert.equal(shared, 0);
await renderer.act(async () => state.open([groupA]));
await renderer.act(async () => state.choose(destinations[0]));
let pending;
await renderer.act(async () => { pending = state.send(); void state.send(); state.close(); });
assert.equal(sent, 1); assert.equal(state.visible, true);
await renderer.act(async () => { resolveSend({ warning: null }); await pending; });
assert.equal(shared, 1); assert.equal(state.visible, false);
mode = 'failed';
await renderer.act(async () => state.open([groupA]));
await renderer.act(async () => state.choose(destinations[0]));
await renderer.act(async () => state.send());
assert.equal(state.visible, true); assert.equal(state.record, groupRecord); assert.equal(state.error, '发送失败');
mode = 'warning'; await renderer.act(async () => state.send());
assert.equal(state.visible, false); assert.equal(shared, 2); assert.match(notices.at(-1), /已分享/);
// 旧会话迟到的成功不得退出新会话选择；新的打开也不能收到已取消的快照。
mode = 'pending';
await renderer.act(async () => state.open([groupA]));
await renderer.act(async () => state.choose(destinations[0]));
await renderer.act(async () => { pending = state.send(); });
props = { ...props, sessionId: 'another-source' };
await renderer.act(async () => rendered.update(React.createElement(Harness)));
await renderer.act(async () => { resolveSend({ warning: null }); await pending; });
assert.equal(shared, 2); assert.equal(state.visible, false);
props = { ...props, assistantId: 'ai-a', sessionId: 'direct:ai-a' };
await renderer.act(async () => rendered.update(React.createElement(Harness)));
await renderer.act(async () => state.open([groupA]));
assert.ok(state.targets.every((target) => target.kind !== 'direct' || target.id !== 'ai-a'), '分享对象排除来源单聊');
await renderer.act(async () => rendered.unmount());

// 完整预览保留全部 20 条，发送期间按钮与预览交互同时停用。
let theme = load('src/shared/theme/themes/liquidGlass.ts').liquidGlassTheme;
boundaries.set('@shared/theme', { useTheme: () => theme, useThemedStyles: (createStyles) => createStyles(theme) });
boundaries.set('react-native-safe-area-context', { useSafeAreaInsets: () => ({ top: 0, bottom: 8 }) });
boundaries.set('lucide-react-native', { MessagesSquare: 'Icon' });
boundaries.set('@shopify/flash-list', { useRecyclingState: (initial) => React.useState(initial) });
boundaries.set('../MessageBubble/AttachmentCard', { default: 'Attachment', __esModule: true });
boundaries.set('../MessageBubble/StickerMessageCard', { default: 'Sticker', __esModule: true });
const keyboardListeners = new Map();
let keyboardMetrics = { screenY: 500, screenX: 0, width: 400, height: 300 };
boundaries.set('react-native', { ActivityIndicator: 'Loading', ScrollView: 'Scroll',
  Keyboard: { metrics: () => keyboardMetrics, addListener: (event, callback) => {
    if (!keyboardListeners.has(event)) keyboardListeners.set(event, new Set());
    keyboardListeners.get(event).add(callback);
    return { remove: () => { const listeners = keyboardListeners.get(event); listeners.delete(callback); if (!listeners.size) keyboardListeners.delete(event); } };
  } },
  StyleSheet: { create: (styles) => styles, compose: (a, b) => [a, b], hairlineWidth: 1 }, Text: 'Text', TextInput: 'Input', TouchableOpacity: 'Button', View: 'View',
  Modal: ({ visible, children, ...rest }) => visible ? React.createElement('Modal', rest, children) : null,
});
const ShareKeyboardContainer = load('src/shared/ui/KeyboardAvoidingContainer.tsx').default;
boundaries.set('@shared/ui', {
  AppTextInput: load('src/shared/ui/AppTextInput.tsx').default,
  KeyboardAvoidingContainer: props => React.createElement(ShareKeyboardContainer, { ...props, testID: 'share-window' }),
});
const Sheet = load('src/features/chat/presentation/messages/components/ChatShareSheet.tsx').default;
let confirmed = 0;
const previewState = { visible: true, record: full, target: destinations[0], targets: destinations, comment: '附言', error: null, loading: false, sending: false,
  close() {}, choose() {}, setComment() {}, send: async () => confirmed++ };
const commentNative = { focused: true, blur() { this.focused = false; } };
await renderer.act(async () => { rendered = renderer.create(React.createElement(Sheet, { share: previewState, onPreviewFile() {} }), { createNodeMock: (element) => element.type === 'Input' ? commentNative : { measureInWindow: callback => callback(0, 0, 400, 800) } }); });
assert.equal(rendered.root.findAllByType('Text').filter((item) => /^第 \d+ 条$/.test(item.props.children)).length, 20);
keyboardMetrics = undefined;
await renderer.act(async () => { for (const listener of keyboardListeners.get('keyboardDidHide')) listener(); });
assert.equal(commentNative.focused, false, '输入法主动收起后解除附言框焦点');
assert.equal(rendered.root.findByType('Input').props.value, '附言', '收起键盘不丢弃附言');
const shareBottom = () => Object.assign({}, ...rendered.root.findAllByType('View').find(node => node.props.testID === 'share-window').props.style).paddingBottom;
assert.equal(shareBottom(), 0, '收起键盘后清除窗口避让');
keyboardMetrics = { screenY: 500, screenX: 0, width: 400, height: 300 };
await renderer.act(async () => { for (const listener of keyboardListeners.get('keyboardDidShow')) listener({ endCoordinates: keyboardMetrics }); });
assert.equal(shareBottom(), 300, '再次输入时只避让实际重叠');
assert.equal(rendered.root.findByType('Input').props.value, '附言', '切换键盘不重建输入草稿');
const confirm = rendered.root.findAllByType('Button').find((button) => button.findAllByType('Text').some((item) => item.props.children === '确认分享'));
await renderer.act(async () => confirm.props.onPress()); assert.equal(confirmed, 1);
await renderer.act(async () => rendered.update(React.createElement(Sheet, { share: { ...previewState, sending: true }, onPreviewFile() {} })));
assert.ok(rendered.root.findAllByType('Button').every((button) => button.props.disabled));
assert.equal(rendered.root.findAllByType('Scroll')[0].props.pointerEvents, 'none');
await renderer.act(async () => rendered.unmount());
assert.equal(keyboardListeners.size, 0, '弹窗卸载后不监听其他页面的键盘');
// 玻璃气泡里的记录卡不再叠白色底，普通主题仍保留可读的卡片背景。
const RecordCard = load('src/features/chat/presentation/messages/components/SharedChatRecordView.tsx').default;
await renderer.act(async () => { rendered = renderer.create(React.createElement(RecordCard, { messageId: 123, record: groupRecord, comment: '', onPreviewFile() {} })); });
assert.equal(rendered.root.findByType('Button').props.style.backgroundColor, 'transparent');
theme = load('src/shared/theme/themes/defaultLight.ts').defaultLightTheme;
await renderer.act(async () => rendered.update(React.createElement(RecordCard, { messageId: 123, record: groupRecord, comment: '', onPreviewFile() {} })));
assert.equal(rendered.root.findByType('Button').props.style.backgroundColor, theme.colors.surface.default);
await renderer.act(async () => rendered.unmount());
// 昵称是界面资料；跨 AI 分享、引用及摘要只能消费生成时的公开正文。
const publicMembers = assistants.map((assistant) => ({ aiAssistantId: assistant.id, name: assistant.name }));
const privateMention = `@${assistants[0].nickname}`;
const privateMentionId = insert('source-group', `${privateMention} 看看这个。`, { metadata: { groupChat: { mentions: [{
  actorType: 'user', target: { targetType: 'assistant', assistantId: 'ai-a', displayNameAtSend: assistants[0].nickname },
}] } } });
const originalMention = await messages.getMessageById(privateMentionId);
const replyTarget = metadata.createChatReplyTarget(originalMention, publicMembers);
assert.equal(replyTarget.quote.text, `${privateMention} 看看这个。`, '引用界面保留昵称');
assert.equal(replyTarget.quote.modelText, '@同名 AI 看看这个。');
const quotedId = insert('source-group', '我引用的是这一条', { metadata: { replyQuote: replyTarget.quote } });
db.prepare('UPDATE messages SET reply_to_id=?, reply_to_text=? WHERE id=?').run(privateMentionId, replyTarget.text, quotedId);
const quotedMessage = await messages.getMessageById(quotedId);
assert.ok(!metadata.buildReplyQuoteModelText(quotedMessage).includes(assistants[0].nickname));
const nicknameGroupRecord = await share.createChatShareSnapshot({ sessionId: 'source-group', name: '来源群' }, [privateMentionId, quotedId]);
assert.ok(nicknameGroupRecord.entries.every((entry) => entry.text.includes(assistants[0].nickname)));
assert.ok(nicknameGroupRecord.entries.every((entry) => !entry.modelText.includes(assistants[0].nickname)));
assert.match(nicknameGroupRecord.entries[1].modelText, /引用消息/);

const privateTitleId = insert('source-direct', '一条普通正文');
const privateTitleRecord = await share.createChatShareSnapshot({ sessionId: 'source-direct', name: assistants[0].nickname, assistantId: 'ai-a' }, [privateTitleId]);
assert.equal(privateTitleRecord.sourceName, assistants[0].nickname, '分享界面保留昵称标题');
assert.ok(!sharedDomain.buildSharedChatRecordText(privateTitleRecord, '', 'agent-b').includes(assistants[0].nickname));
const resharedId = insert('source-direct', '再次转发', { metadata: { kind: 'shared_record', sharedRecord: nicknameGroupRecord } });
const resharedRecord = await share.createChatShareSnapshot({ sessionId: 'source-direct', name: assistants[1].nickname }, [resharedId]);
assert.ok(resharedRecord.entries.some((entry) => entry.text.includes(assistants[0].nickname)), '再次分享保持界面快照');
const summaryProjection = load('src/features/chat/summary/domain/ChatContext.ts');
for (const record of [privateTitleRecord, nicknameGroupRecord, resharedRecord]) {
  const recordMessage = { ...quotedMessage, id: 5000, text: '', replyToText: null,
    metadataJson: JSON.stringify({ kind: 'shared_record', sharedRecord: record }) };
  const input = await inputBuilder.buildChatUserMessageModelInput(recordMessage, 'ai-b', 'agent-b');
  const summary = summaryProjection.projectChatContextMessage(recordMessage, [time, 5000, 0, 5000]);
  for (const assistant of assistants) {
    assert.ok(!JSON.stringify(input.modelInput).includes(assistant.nickname), '当前输入不泄露备注');
    assert.ok(!summary.content.includes(assistant.nickname), '共享记录的摘要输入不泄露备注');
  }
}
const quoteSummary = summaryProjection.projectChatContextMessage(quotedMessage, [time, quotedId, 0, quotedId]);
assert.ok(!quoteSummary.content.includes(assistants[0].nickname), '引用进入摘要时继续使用公开正文');
const oldQuote = { ...quotedMessage, metadataJson: JSON.stringify({ replyQuote: { ...replyTarget.quote, modelText: undefined } }) };
assert.ok(!metadata.buildReplyQuoteModelText(oldQuote).includes(assistants[0].nickname), '旧引用没有公开投影时不再传播备注');
assert.equal(metadata.getMessageReplyQuote(oldQuote).text, replyTarget.quote.text, '旧引用的界面原文仍保留');
assert.ok(!metadata.buildReplyQuoteModelText({ replyToText: privateMention, metadataJson: null }).includes(assistants[0].nickname));
const oldShared = { ...nicknameGroupRecord, entries: nicknameGroupRecord.entries.map(({ modelText, ...entry }) => entry) };
assert.ok(!sharedDomain.buildSharedChatRecordText(oldShared, '', 'agent-b').includes(assistants[0].nickname));
assert.ok(oldShared.entries.some((entry) => entry.text.includes(assistants[0].nickname)), '旧分享卡片的界面正文不被清除');
assert.equal(metadata.createChatReplyTarget({ ...originalMention, text: '用户自己写下的普通称呼', metadataJson: null }, publicMembers).quote.modelText,
  '用户自己写下的普通称呼', '不按昵称字典改写用户普通正文');
db.close();
console.log('verify-chat-message-share: 四种方向、空群无附言召唤及取消、整轮快照、身份、当前输入／历史／摘要、媒体引用与页面状态验证通过。');
