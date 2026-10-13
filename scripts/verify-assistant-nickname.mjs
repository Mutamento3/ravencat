/** 昵称持久化、修改提醒、旧确认隔离和模型名称隐私的行为验证。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { bootstrapSqlite, createSqliteExecutor } from './helpers/sqlite-bootstrap-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(root, path.dirname(file), `${name}.ts`)), mocks);
    throw new Error(`${file} 缺少测试依赖 ${name}`);
  }, module, module.exports);
  return module.exports;
}

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const executor = createSqliteExecutor(db);
await bootstrapSqlite(executor);
let pendingTransaction = Promise.resolve();
const database = {
  ...executor,
  withExclusiveTransactionAsync(task) {
    const result = pendingTransaction.then(async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const value = await task(executor); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    });
    pendingTransaction = result.catch(() => {});
    return result;
  },
};
const { AIAssistantRepository } = load('src/features/assistants/infrastructure/SQLiteAssistantRepository.ts', {
  '@platform/persistence': { databaseCoordinator: { openTaskExecutor: () => database } },
  '@features/profile': {}, '@features/media': {},
  './SQLiteAuxiliaryModelDefaults': {}, './SQLiteAuxiliaryModelRepository': {},
  '../domain/AIProfile': { createAIProfile: (data) => data },
});
const repository = new AIAssistantRepository();
const nickname = load('src/features/assistants/AssistantNickname.ts', {
  './infrastructure/SQLiteAssistantRepository': { aiAssistantRepository: repository },
});
for (const id of ['self', 'other']) {
  db.prepare('INSERT INTO ai_assistants (id, agent_id, name, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, `actor-${id}`, `原名-${id}`, 'test', '2026-10-13', '2026-10-13');
}
assert.equal((await nickname.getAssistantNicknamePromptContext('self', '枫渡', true)).content, '');
assert.equal(nickname.getAssistantDisplayName({ name: '原名', nickname: null }), '原名');
assert.equal(await repository.updateSettings('deleted', { nickname: '不存在' }), false);
await repository.updateSettings('other', { nickname: '别人的私密备注' });
await repository.updateSettings('self', { nickname: 'daddy' });
await repository.updateSettings('self', { nickname: 'daddy' });
assert.equal((await repository.getNicknameContext('self')).changes.length, 1, '相同值不产生重复事件');
const first = await nickname.getAssistantNicknamePromptContext('self', '枫渡', true);
await repository.updateSettings('self', { name: '修改后的公开名称' });
assert.equal((await repository.getNicknameContext('self')).nickname, 'daddy');
assert.equal(nickname.getAssistantDisplayName({ name: '修改后的公开名称', nickname: 'daddy' }), 'daddy');
assert.equal((await repository.getNicknameContext('self')).changes.length, 1, '公开名称修改不修改用户昵称历史');
await repository.updateSettings('self', { name: '原名-self' });
assert.match(first.content, /当前昵称备注是"daddy"/);
assert.match(first.content, /系统提醒：用户修改了你的昵称备注/);
assert.doesNotMatch(first.content, /别人的私密备注/);
assert.equal(first.noticeRevision, (await nickname.getAssistantNicknamePromptContext('self', '枫渡', true)).noticeRevision,
  '组装和失败请求不消费提醒');
const group = await nickname.getAssistantNicknamePromptContext('self', '枫渡', false);
assert.match(group.content, /daddy/);
assert.equal(group.noticeRevision, undefined, '其他场景仅携带自身事实，不抢走单聊提醒');

await repository.updateSettings('self', { nickname: '老公' });
await nickname.acknowledgeAssistantNicknameNotice('self', first.noticeRevision);
const changed = await nickname.getAssistantNicknamePromptContext('self', '枫渡', true);
assert.match(changed.content, /从"daddy"修改为"老公"/);
assert.doesNotMatch(changed.content, /从未设置昵称修改为"daddy"/);
assert.match(changed.content, /"daddy" → "老公"/);
await nickname.acknowledgeAssistantNicknameNotice('self', changed.noticeRevision);
const confirmed = await nickname.getAssistantNicknamePromptContext('self', '枫渡', true);
assert.match(confirmed.content, /当前昵称备注是"老公"/);
assert.match(confirmed.content, /"daddy" → "老公"/);
assert.doesNotMatch(confirmed.content, /用户修改了你的昵称备注/);
assert.equal(confirmed.noticeRevision, undefined);
assert.equal((await repository.getNicknameContext('other')).changes[0].acknowledged, false, '确认按 AI 隔离');

await Promise.all([
  repository.updateSettings('self', { nickname: '宝宝' }),
  repository.updateSettings('self', { nickname: '亲爱的' }),
]);
const concurrent = await repository.getNicknameContext('self');
assert.deepEqual(concurrent.changes.slice(-2).map(({ previousNickname, nickname: current }) => [previousNickname, current]),
  [['老公', '宝宝'], ['宝宝', '亲爱的']], '并发修改的历史必须来自事务内真实前值');
db.exec(`CREATE TRIGGER reject_nickname BEFORE UPDATE OF nickname ON ai_assistants
  WHEN NEW.nickname = '保存失败' BEGIN SELECT RAISE(ABORT, '模拟写入失败'); END;`);
await assert.rejects(repository.updateSettings('self', { nickname: '保存失败' }));
assert.deepEqual(await repository.getNicknameContext('self'), concurrent, '写入失败时当前值和事件同时回滚');
await repository.updateSettings('self', { nickname: null });
assert.equal((await repository.getNicknameContext('self')).nickname, null);
assert.match((await nickname.getAssistantNicknamePromptContext('self', '枫渡', true)).content, /修改为未设置昵称/);
assert.equal(db.prepare('SELECT name FROM ai_assistants WHERE id = ?').get('self').name, '原名-self');

const { parseChatSettingsDraft } = load('src/features/chat/presentation/conversation/chatSettingsDraft.ts', {
  '@shared/ui/draftValidation': {},
});
assert.deepEqual(parseChatSettingsDraft({ nickname: '  老公  ' }, ['nickname']).patch, { nickname: '老公' });
assert.deepEqual(parseChatSettingsDraft({ nickname: '   ' }, ['nickname']).patch, { nickname: null });
assert.ok(parseChatSettingsDraft({ nickname: 'a\nb' }, ['nickname']).errors.nickname);
assert.ok(parseChatSettingsDraft({ nickname: '长'.repeat(21) }, ['nickname']).errors.nickname);
assert.deepEqual(parseChatSettingsDraft({ nickname: '🐈'.repeat(20) }, ['nickname']).patch, { nickname: '🐈'.repeat(20) });

const metadata = load('src/features/chat/messages/domain/chatMessageMetadata.ts');
const { buildGroupMentionModelText } = load('src/features/chat/group/application/GroupMentionModelText.ts', {
  '../../messages/domain/chatMessageMetadata': metadata,
});
const message = { metadataJson: JSON.stringify({ groupChat: { mentions: [{
  actorType: 'user', target: { targetType: 'assistant', assistantId: 'self', displayNameAtSend: '老公' },
}] } }) };
assert.equal(buildGroupMentionModelText('@老公 看看这个，@老公甲不是你。', message,
  [{ aiAssistantId: 'self', name: '公开名' }]), '@公开名 看看这个，@老公甲不是你。');
assert.equal(buildGroupMentionModelText('@老公 看看这个。', message, []), '@已离开的AI 看看这个。');
const duplicateMention = { metadataJson: JSON.stringify({ groupChat: { mentions: [
  { actorType: 'user', target: { targetType: 'assistant', assistantId: 'self', displayNameAtSend: '同名' } },
  { actorType: 'user', target: { targetType: 'assistant', assistantId: 'other', displayNameAtSend: '同名' } },
] } }) };
assert.equal(buildGroupMentionModelText('@同名 看看这个。', duplicateMention,
  [{ aiAssistantId: 'self', name: '公开甲' }, { aiAssistantId: 'other', name: '公开乙' }]), '@公开甲、@公开乙 看看这个。');

const { loadMomentActorDirectory } = load('src/features/moments/application/MomentActorResolver.ts', {
  '@features/assistants': { ...nickname, listAIAssistants: async () => [{ id: 'self', agentId: 'actor-self', name: '公开名', nickname: '私密昵称', avatar: null }] },
  '@features/profile': { SELF_USER_PROFILE_ID: 'user', getCurrentUserProfile: async () => ({ name: '枫渡' }) },
});
assert.equal((await loadMomentActorDirectory()).actors[1].displayName, '公开名');
assert.equal((await loadMomentActorDirectory(undefined, 'user')).actors[1].displayName, '私密昵称');

const blockMetadata = load('src/host/prompt/compiler/promptBlockMetadata.ts');
const { PromptPackCompiler } = load('src/host/prompt/compiler/PromptPackCompiler.ts', {
  './promptBlockMetadata': blockMetadata,
  '../tokenBudget': { estimateTokens: () => 1,
    applyTokenBudget: (blocks, recentMessages) => ({ blocks, recentMessages, estimatedTokenCount: 1, truncationLog: [] }) },
});
const compileNickname = (context) => new PromptPackCompiler().compile({
  scenario: 'chat.private_reply', recentMessages: [{ role: 'assistant', content: '上一轮回复' }],
  currentInput: { role: 'user', content: '现在聊天' },
  blocks: [{ key: 'foundation_default_core', title: '规则', content: '不变的规则', required: false, status: 'ready', placement: 'system' },
    { key: 'assistant_nickname', title: '昵称', content: context.content, required: false, status: 'ready', placement: 'system',
      assistantNicknameNoticeRevision: context.noticeRevision }],
  preset: { id: 'nickname-test', scenarioId: 'chat.private_reply', items: [
    { definitionId: 'foundation.default_core', slot: 'foundation', sortOrder: 1, enabled: true, required: false, protection: 'locked' },
    { definitionId: 'context.assistant_nickname', slot: 'dynamic_context', sortOrder: 190, enabled: true, required: false, protection: 'locked' },
  ] },
});
const firstPack = compileNickname(first), changedPack = compileNickname(changed);
assert.equal(firstPack.stableSystemPrompt, changedPack.stableSystemPrompt, '昵称编辑不修改稳定前缀');
assert.equal(changedPack.modelMessages.at(-2).role, 'system');
assert.match(changedPack.modelMessages.at(-2).content, /用户修改了你的昵称备注/);
assert.equal(changedPack.modelMessages.at(-1).content, '现在聊天');
assert.equal(changedPack.assistantNicknameNoticeRevision, changed.noticeRevision);

// 执行真实回复编排，模型/提交使用可控端口；确认必须依赖最终回复而非请求组装。
let mode = 'success', attempts = 0, errorMessages = 0, finalCallbacks = 0, acknowledgements = [];
let currentPromptContext;
const runtime = {
  assistantDirectory: { getBlockState: async () => ({ isBlocked: false }) },
  runPreparation: { prepare: async () => ({ additionalPromptBlocks: [] }) },
  prompt: { acknowledgeNicknameNotice: async (assistantId, revision) => {
    acknowledgements.push([assistantId, revision]);
    if (mode === 'ack-failed') throw new Error('模拟确认失败');
    await nickname.acknowledgeAssistantNicknameNotice(assistantId, revision);
  } },
};
class ModelRequestError extends Error {}
const { processAIReply } = load('src/features/chat/reply/application/ProcessAIReply.ts', {
  '@platform/ai': { createAIClient: () => ({}), getErrorDisplayInfo: () => ({ userFriendlyMessage: '请求失败' }) },
  '@shared/aiTools': { applyHostModelRunToolExposure: (names) => names },
  './ChatReplyRuntimeDependencies': { getChatReplyRuntimeDependencies: () => runtime },
  './ChatReplyErrors': { notifyReplyFailed: () => {}, saveErrorMessage: async () => { errorMessages += 1; return {}; } },
  './ChatReplyRuntime': { createRuntimeToolContext: () => ({}), buildRuntimeAIToolsConfig: () => ({}),
    assemblePromptPackForRuntimeContext: async () => {
      currentPromptContext = await nickname.getAssistantNicknamePromptContext('self', '枫渡', true);
      return compileNickname(currentPromptContext);
    } },
  './ChatReplyUtils': { applyRuntimeModelInput: (messages) => messages },
  './ChatReplyAbort': { assertChatReplyNotAborted: () => {}, isChatReplyRunCancellationError: () => false,
    shouldSuppressReplyErrorPersistenceAsync: async () => false },
  './ReplyPolicy': { resolveAIReplyPolicy: () => ({ enableTools: false, modelTransport: 'stream' }) },
  './MemoryParticipationPolicy': { resolveMemoryParticipationMode: () => 'off' },
  '../agent/ChatAgentModelGateway': { ChatAgentModelRequestError: ModelRequestError },
  '../agent/ChatAgentReplyFlow': { runChatAgentReplyFlow: async ({ callbacks, requestMessages }) => {
    attempts += 1;
    assert.equal(requestMessages.at(-2).role, 'system');
    if (mode === 'model-failed') throw new ModelRequestError('模拟模型失败');
    if (mode === 'fence-failed') return { completed: true };
    if (mode === 'fallback' && attempts === 1) return { completed: false };
    callbacks.onFinalReply?.({});
    return { completed: true };
  } },
});
const runReply = () => processAIReply('session', '你好', { id: 'self', agentId: 'actor-self', name: '公开名', enableTools: false },
  1, {}, { onFinalReply: () => { finalCallbacks += 1; } }, {}, {});
const originalWarn = console.warn;
console.warn = () => {};
try {
  mode = 'model-failed'; await runReply();
  assert.equal(acknowledgements.length, 0); assert.equal(errorMessages, 1);
  assert.ok(currentPromptContext.noticeRevision);
  mode = 'fence-failed'; await runReply();
  assert.equal(acknowledgements.length, 0, '提交失去资格且没有最终回复时不确认');
  mode = 'ack-failed'; await runReply();
  assert.equal(errorMessages, 1, '确认失败不生成第二条错误消息');
  assert.ok((await nickname.getAssistantNicknamePromptContext('self', '枫渡', true)).noticeRevision);
  mode = 'fallback'; attempts = 0; await runReply();
  assert.equal(attempts, 2);
  assert.equal(finalCallbacks, 2, '原有最终回复回调仍被调用');
  assert.equal((await nickname.getAssistantNicknamePromptContext('self', '枫渡', true)).noticeRevision, undefined);
} finally { console.warn = originalWarn; }
db.exec("DELETE FROM ai_assistants WHERE id = 'self'");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM assistant_nickname_changes WHERE assistant_id = 'self'").get().count, 0);
db.close();
console.log('昵称：持久化与清空、修改历史、确认隔离、并发与回滚、输入校验及群聊/朋友圈名称隐私验证通过。');
