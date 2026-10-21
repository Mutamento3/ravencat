import { chatReplyVersionModuleUrl, chatMutationModuleUrl, chatTimelineModuleUrl, installChatTimelineSchema } from './chat-timeline-fixture.mjs';
/** Chat Single-Conversation Foundation 的持久化与公开产品契约验证。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-single-conversation-'));

function createExecutor(db) {
  const executor = {
    getFirstAsync: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
    runAsync: async (sql, params = []) => {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    withExclusiveTransactionAsync: async (operation) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await operation(executor);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return executor;
}

async function importSessionRepository(executor) {
  globalThis.__CHAT_CANONICAL_EXECUTOR__ = executor;
  const source = read('src/features/chat/conversation/infrastructure/SQLiteSessionRepository.ts').replaceAll("from '../../messages/infrastructure/ChatMessageMutationSql'", `from '${chatMutationModuleUrl}'`)
    .replace(
      /import \{ databaseCoordinator, type DatabaseTransactionExecutor \} from '@platform\/persistence';/,
      'const databaseCoordinator = { openTaskExecutor: () => globalThis.__CHAT_CANONICAL_EXECUTOR__ };',
    );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const target = path.join(tempDir, 'SQLiteSessionRepository.mjs');
  fs.writeFileSync(target, output, 'utf8');
  return import(pathToFileURL(target).href);
}

async function importMessageRepository(executor) {
  globalThis.__CHAT_MESSAGE_EXECUTOR__ = executor;
  const source = read('src/features/chat/messages/infrastructure/SQLiteMessageRepository.ts').replaceAll("from './ChatTimelineSql'", `from '${chatTimelineModuleUrl}'`).replaceAll("from './ChatMessageMutationSql'", `from '${chatMutationModuleUrl}'`).replaceAll("from '../../reply/infrastructure/ChatReplyVersionSql'", `from '${chatReplyVersionModuleUrl}'`)
    .replace(
      /import \{[\s\S]*?\} from '@platform\/persistence';/,
      'const databaseCoordinator = { openTaskExecutor: () => globalThis.__CHAT_MESSAGE_EXECUTOR__ };',
    )
    .replace(
      /import \{ shouldShowTimeSeparatorBefore \} from '\.\.\/domain\/MessageTimeSeparator';/,
      'const shouldShowTimeSeparatorBefore = () => false;',
    );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const target = path.join(tempDir, 'SQLiteMessageRepository.mjs');
  fs.writeFileSync(target, output, 'utf8');
  return import(pathToFileURL(target).href);
}

async function importCallRepository(executor) {
  globalThis.__CHAT_CALL_EXECUTOR__ = executor;
  const source = read('src/features/calls/infrastructure/SQLiteCallRepository.ts')
    .replace(
      /import \{[\s\S]*?\} from '@platform\/persistence';/,
      'const databaseCoordinator = { openTaskExecutor: () => globalThis.__CHAT_CALL_EXECUTOR__ };',
    );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const target = path.join(tempDir, 'SQLiteCallRepository.mjs');
  fs.writeFileSync(target, output, 'utf8');
  return import(pathToFileURL(target).href);
}

const db = new DatabaseSync(':memory:');
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE chat_conversations (id TEXT PRIMARY KEY, kind TEXT NOT NULL);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, ai_assistant_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    last_message TEXT, last_time TEXT, is_active INTEGER DEFAULT 1,
    is_archived INTEGER DEFAULT 0, is_pinned INTEGER DEFAULT 0, tags TEXT,
    visible_after_message_id INTEGER, visible_after_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    agent_id TEXT, text TEXT NOT NULL, is_me INTEGER NOT NULL, sender_type TEXT NOT NULL,
    api_message_id TEXT, client_message_id TEXT, time TEXT NOT NULL, created_at TEXT NOT NULL,
    show_time_separator_before INTEGER, updated_at TEXT, reply_to_id INTEGER,
    reply_to_text TEXT, logical_message_id TEXT, segment_index INTEGER, segment_total INTEGER,
    delivery_status TEXT, status TEXT NOT NULL DEFAULT 'sent', tokens_used INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT, is_read INTEGER, voice_played_at TEXT, turn_run_id TEXT, turn_item_index INTEGER
  );
  -- 只保留 listContextEvents 读取的列；本用例不验证 call_events 的外键级联。
  CREATE TABLE call_events (
    id TEXT PRIMARY KEY, call_id TEXT NOT NULL, chat_session_id TEXT NOT NULL,
    kind TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT, text TEXT,
    attachment_id TEXT, visible_in_chat INTEGER DEFAULT 0,
    include_in_ai_context INTEGER DEFAULT 1, payload_json TEXT, created_at TEXT NOT NULL
  );
`);
installChatTimelineSchema(db);
const executor = createExecutor(db);
const { SessionRepository } = await importSessionRepository(executor);
const sessions = new SessionRepository();

const first = await sessions.resolveCanonicalConversation('ai-a', new Date('2026-09-16T08:00:00.000Z'));
const repeated = await sessions.resolveCanonicalConversation('ai-a', new Date('2026-09-17T08:00:00.000Z'));
const secondAI = await sessions.resolveCanonicalConversation('ai-b', new Date('2026-09-16T08:00:01.000Z'));
assert.equal(first.id, repeated.id, '重复进入同一个 AI 必须复用 canonical conversation');
assert.notEqual(first.id, secondAI.id, '不同 AI 必须拥有不同 canonical conversation');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE ai_assistant_id = ?').get('ai-a').count, 1);
assert.throws(
  () => db.prepare(`INSERT INTO sessions (id, ai_assistant_id, name, created_at, updated_at)
    VALUES ('alternate', 'ai-a', 'alternate', 'x', 'x')`).run(),
  /UNIQUE/,
);

const insertMessage = db.prepare(`INSERT INTO messages (
  session_id, text, is_me, sender_type, time, created_at
) VALUES (?, ?, ?, ?, ?, ?)`);
const insertCallAnchor = db.prepare(`INSERT INTO messages (
  session_id, client_message_id, text, is_me, sender_type, time, created_at, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const insertCallEvent = db.prepare(`INSERT INTO call_events (
  id, call_id, chat_session_id, kind, actor_type, text, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)`);

// clearConversationHistory 内部用真实 now 写 visible_after_at，
// 因此通话事件围绕清除时刻构造，前后各留 60s 余量保证方向确定。
const CLEAR_EPOCH_MS = Date.now();
const beforeClear = (offsetMs = 0) => new Date(CLEAR_EPOCH_MS - 60_000 + offsetMs).toISOString();
const afterClear = (offsetMs = 0) => new Date(CLEAR_EPOCH_MS + 60_000 + offsetMs).toISOString();

insertMessage.run(first.id, '旧用户消息', 1, 'user', '08:00', beforeClear(0));
insertMessage.run(first.id, '旧 AI 消息', 0, 'assistant', '08:01', beforeClear(1_000));
// call-same / call-old 都在清除前留下 callStatus 锚点：
// 旧实现按「锚点 message id <= boundary」整体隐藏 callId，会把同一通电话的后半段一起隐藏。
insertCallAnchor.run(
  first.id, 'call-status:call-same', '[通话]', 0, 'assistant', '08:01',
  beforeClear(2_000), JSON.stringify({ type: 'callStatus', callId: 'call-same' }),
);
insertCallAnchor.run(
  first.id, 'call-status:call-old', '[通话]', 0, 'assistant', '08:01',
  beforeClear(3_000), JSON.stringify({ type: 'callStatus', callId: 'call-old' }),
);
// 清除前产生的通话事件事实。
insertCallEvent.run('event-same-A', 'call-same', first.id, 'userSpeechText', 'user', 'same-A', beforeClear(4_000));
insertCallEvent.run('event-old-A', 'call-old', first.id, 'userSpeechText', 'user', 'old-A', beforeClear(5_000));
insertCallEvent.run('event-old-B', 'call-old', first.id, 'aiSpeechText', 'ai', 'old-B', beforeClear(6_000));

const rowCountBeforeClear = db.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
const expectedBoundary = db.prepare(
  'SELECT MAX(id) AS id FROM messages WHERE session_id = ?',
).get(first.id).id;
const boundary = await sessions.clearConversationHistory(first.id);
assert.equal(boundary, expectedBoundary, '边界必须落在清除时刻该会话最大的 message id 上');
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, rowCountBeforeClear, '清除不得删除消息行');
const reloadedSession = await sessions.getCanonicalConversation('ai-a');
assert.equal(reloadedSession.visibleAfterMessageId, boundary, 'reload 后 message 边界必须仍然存在');
assert.ok(reloadedSession.visibleAfterAt, 'reload 后通话上下文时间边界必须仍然存在');
assert.equal(
  await sessions.clearConversationHistory(secondAI.id),
  null,
  '没有消息的 canonical conversation 清除后不得伪造边界',
);

const { MessageRepository } = await importMessageRepository(executor);
const messages = new MessageRepository();
assert.deepEqual((await messages.getMessages(first.id, { limit: 20, cursor: null })).messages, []);
insertMessage.run(first.id, '清除后的新消息', 1, 'user', '08:02', afterClear(0));
assert.deepEqual(
  (await messages.getMessages(first.id, { limit: 20, cursor: null })).messages.map((message) => message.text),
  ['清除后的新消息'],
);

// 清除之后产生 / 追加的通话事件：同一通跨 boundary 的电话后半段必须仍然可见。
insertCallEvent.run('event-same-B', 'call-same', first.id, 'aiSpeechText', 'ai', 'same-B', afterClear(0));
insertCallEvent.run('event-new-A', 'call-new', first.id, 'userSpeechText', 'user', 'new-A', afterClear(1_000));
insertCallEvent.run('event-new-B', 'call-new', first.id, 'aiSpeechText', 'ai', 'new-B', afterClear(2_000));
// 清除后才开始的通话，锚点落在 boundary 之后。
insertCallAnchor.run(
  first.id, 'call-status:call-new', '[通话]', 0, 'assistant', '08:04',
  afterClear(3_000), JSON.stringify({ type: 'callStatus', callId: 'call-new' }),
);

const { SQLiteCallRepository } = await importCallRepository(executor);
const calls = new SQLiteCallRepository();
const contextEvents = await calls.listContextEvents({ chatSessionId: first.id, limit: 100 });
assert.deepEqual(
  contextEvents.map((event) => event.text),
  ['same-B', 'new-A', 'new-B'],
  'Call context 边界必须落在事件上：清除前的事件隐藏，同一通电话清除后的事件仍然可见',
);
assert.equal(
  contextEvents.some((event) => event.callId === 'call-old'),
  false,
  '整通发生在清除前的电话必须整体隐藏',
);
assert.equal(
  contextEvents.some((event) => event.text === 'same-A'),
  false,
  '同一通电话在清除前产生的事件不得进入 Prompt',
);

db.prepare(`INSERT INTO chat_conversations (id, kind) VALUES ('group-1', 'group')`).run();
insertMessage.run('group-1', '群消息', 1, 'user', '08:03', afterClear(4_000));
assert.deepEqual(
  (await messages.getMessages('group-1', { limit: 20, cursor: null })).messages.map((message) => message.text),
  ['群消息'],
  'direct history boundary 不得影响 group chat',
);
// group conversation 没有 sessions 行，因此不存在单聊历史边界：通话上下文全部可见。
insertCallEvent.run('event-group-A', 'call-group', 'group-1', 'userSpeechText', 'user', 'group-A', beforeClear(7_000));
insertCallEvent.run('event-group-B', 'call-group', 'group-1', 'aiSpeechText', 'ai', 'group-B', afterClear(5_000));
assert.deepEqual(
  (await calls.listContextEvents({ chatSessionId: 'group-1', limit: 100 })).map((event) => event.text),
  ['group-A', 'group-B'],
  'group conversation 不得被单聊历史边界过滤通话上下文',
);

const promptHistorySource = read('src/host/prompt/PromptHistoryBuilder.ts');
assert.match(promptHistorySource, /openConversationTimeline\(\{ sessionId, limit \}\)/, 'Prompt History 必须复用 boundary-aware timeline query');
assert.doesNotMatch(
  promptHistorySource,
  /listCallContextCallIdsBeforeHistoryBoundary|hiddenCallIds/,
  '不得再以 callId 作为最小历史清除单位：边界必须落在 CallEvent 自己身上',
);
const callRepositorySource = read('src/features/calls/infrastructure/SQLiteCallRepository.ts');
assert.match(
  callRepositorySource,
  /visible_after_at/,
  'Call context 必须按事件时刻尊重历史清除边界',
);
assert.equal(fs.existsSync(path.join(ROOT, 'src/app/chat/[aiId]/sessions.tsx')), false);
// Git 不跟踪空目录：fresh clone 里 ChatHistory 目录可能根本不存在，
// 所以契约是「目录不存在，或存在但没有 production implementation」，
// 而不是「目录必须存在且为空」。
const chatHistoryDir = path.join(
  ROOT,
  'src/features/chat/presentation/conversation/ChatHistory',
);
const chatHistoryEntries = fs.existsSync(chatHistoryDir) ? fs.readdirSync(chatHistoryDir) : [];
assert.deepEqual(
  chatHistoryEntries,
  [],
  '历史 session 浏览实现必须全部退役（ChatHistory 不得保留 production implementation）',
);
const presentationSource = [
  read('src/features/chat/presentation/conversation/AIOptions.tsx'),
  read('src/features/chat/presentation/messages/components/ChatHeader.tsx'),
  read('src/features/chat/presentation/shell/ChatRouteScreens.tsx'),
].join('\n');
assert.match(presentationSource, /清除聊天记录/);
assert.doesNotMatch(presentationSource, /历史会话|onCreateNewChat|isCreatingNewChat/);

db.close();
delete globalThis.__CHAT_CANONICAL_EXECUTOR__;
delete globalThis.__CHAT_MESSAGE_EXECUTOR__;
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('Chat Single-Conversation Foundation 验证通过');
