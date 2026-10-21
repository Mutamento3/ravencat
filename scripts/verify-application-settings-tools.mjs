/** 应用设置工具的真实 SQLite 权限、引用、CAS、默认读取及视觉交付行为。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { bootstrapSqlite, createSqliteExecutor, DATABASE_SCHEMA_VERSION } from './helpers/sqlite-bootstrap-fixture.mjs';
import { agentToolSchemaDependencies } from './helpers/agent-tool-schema-dependencies.mjs';

function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    assert.ok(Object.hasOwn(mocks, id), `${file}: 缺少依赖 ${id}`);
    return mocks[id];
  }, module, module.exports);
  return module.exports;
}
const db = new DatabaseSync(':memory:');
const raw = createSqliteExecutor(db);
await bootstrapSqlite(raw);
db.exec('PRAGMA foreign_keys=ON');
let lane = Promise.resolve(), inTransaction = false;
function transaction(work) {
  const next = lane.then(async () => {
    db.exec('BEGIN IMMEDIATE'); inTransaction = true;
    try { const value = await work(raw); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { inTransaction = false; }
  });
  lane = next.catch(() => {});
  return next;
}
const executor = { ...raw, withExclusiveTransactionAsync: transaction };
const persistence = { databaseCoordinator: { openTaskExecutor: () => executor,
  read: (_meta, work) => work(raw), transaction: (_meta, work) => transaction(work) } };
const slot = load('src/shared/runtime/RuntimeSlot.ts');
const abort = load('src/shared/runtime/abortSignal.ts');
const conflict = load('src/shared/errors/SettingChangeConflictError.ts');
const access = load('src/features/assistants/domain/ApplicationSettingsAccess.ts');
const { MediaAssetNotFoundError } = load('src/features/media/application/MediaAssetResolver.ts', { './MediaAssetBacking': {} });
const { SQLiteMediaAssetRepository } = load('src/features/media/infrastructure/SQLiteMediaAssetRepository.ts');
const mediaRepository = new SQLiteMediaAssetRepository(executor);
const backing = load('src/features/media/application/MediaAssetBacking.ts');
const { MediaAssetCatalog } = load('src/features/media/application/MediaAssetCatalog.ts', { './MediaAssetBacking': backing });
const { CreateMediaAsset } = load('src/features/media/application/CreateMediaAsset.ts');
const files = new Map(), cropRequests = [], deleted = [], updates = [];
let sequence = 0, pauseCrop = null, pauseNameRead = null, themeId = 'default-light', runCurrent = true;
const writer = {
  storageBackend: 'persistent-media',
  async prepare({ assetId, sourceUri, fileName }) {
    assert.equal(inTransaction, false, '文件准备不能在事务内');
    const storageKey = `catalog/media/${assetId}/${fileName}`;
    const localUri = `file:///${storageKey}`;
    files.set(localUri, files.get(sourceUri));
    return { storageBackend: 'persistent-media', storageKey, localUri };
  },
  async resolve(key) { const localUri = `file:///${key}`; assert.ok(files.has(localUri)); return { localUri }; },
  async delete(key) { files.delete(`file:///${key}`); }, commitPrepared() {},
};
const creator = new CreateMediaAsset({ catalog: new MediaAssetCatalog(mediaRepository),
  backings: new backing.MediaAssetBackingRegistry({ writers: [writer] }),
  contentInspector: { async inspect(uri) { return { contentHash: createHash('sha256').update(files.get(uri)).digest('hex'), byteSize: files.get(uri).length }; } },
  database: executor, generateId: () => `appearance-${++sequence}`, now: () => new Date().toISOString(),
  reportPostCommitCleanupFailure: error => { throw error; },
});
const mediaRuntime = {
  createMediaAssetWithReference: creator.execute.bind(creator),
  async resolveMediaAsset(id) {
    const asset = await mediaRepository.getById(id);
    if (!asset) throw new MediaAssetNotFoundError(id);
    return { asset, ...await writer.resolve(asset.storageKey) };
  },
  async releaseMediaAssetCandidates(ids) {
    const released = await transaction(tx => mediaRepository.releaseUnreferencedAssetsInTransaction(tx, ids.filter(Boolean)));
    for (const asset of released) await writer.delete(asset.storageKey);
  },
};
mediaRuntime.resolveMediaAssetReferenceUri = async ({ mediaAssetId, legacyUri }) => mediaAssetId
  ? (await mediaRuntime.resolveMediaAsset(mediaAssetId)).localUri : legacyUri;
const cropped = load('src/features/media/application/CommitCroppedImageSelection.ts', {
  'expo-file-system': { File: class { constructor(uri) { this.uri = uri; } delete() { deleted.push(this.uri); files.delete(this.uri); } } },
  '@platform/device': { async cropImageToAspect(input) {
    assert.equal(inTransaction, false, '解码和裁剪不能在事务内');
    cropRequests.push(input);
    if (pauseCrop) await pauseCrop();
    const uri = `file:///crop-${cropRequests.length}.png`;
    files.set(uri, `${files.get(input.sourceUri)}:${input.aspect.join('/')}`);
    return { uri, width: input.aspect[0], height: input.aspect[1], mimeType: 'image/png', isAnimated: false, sourceWasAnimated: false };
  } },
  '@platform/persistence': persistence, '@shared/runtime/abortSignal': abort,
  './MediaAssetRuntime': mediaRuntime, './MediaAssetBacking': backing,
});
const media = { ...mediaRuntime, ...backing, ...cropped };
const asyncStorage = { default: { getItem: async () => null, removeItem: async () => {} } };
const deviceService = {};
const common = { '@platform/persistence': persistence, '@features/media': media,
  '@shared/runtime/abortSignal': abort,
  '@shared/errors/SettingChangeConflictError': conflict, '@shared/runtime/RuntimeSlot': slot,
  '@react-native-async-storage/async-storage': asyncStorage, '@platform/device/DeviceMediaService': deviceService };
const { AIAssistantRepository } = load('src/features/assistants/infrastructure/SQLiteAssistantRepository.ts', {
  ...common, '@features/profile': {}, '../domain/AIProfile': {}, './SQLiteAuxiliaryModelDefaults': {},
  './SQLiteAuxiliaryModelRepository': {}, '../domain/HostRepository': {},
});
const aiRepository = new AIAssistantRepository();
const summaries = () => db.prepare(`SELECT id,agent_id AS agentId,name,nickname,avatar,avatar_media_asset_id AS avatarMediaAssetId,
  is_host_ai AS isHostAI FROM ai_assistants ORDER BY id`).all().map(row => ({ ...row, isHostAI: row.isHostAI === 1,
  canonicalConversationId: `conversation-${row.id}` }));
const aiPort = {
  getAvatarMediaAssetReference: id => aiRepository.getAvatarMediaAssetReference(id),
  tryCommitAvatarMediaAssetReferenceInTransaction: (...args) => aiRepository.tryCommitAvatarMediaAssetReferenceInTransaction(...args),
  canManageApplicationSettingsInTransaction: (...args) => aiRepository.canManageApplicationSettingsInTransaction(...args),
  changeNameInTransaction: (...args) => aiRepository.changeNameInTransaction(...args),
  getById: async id => {
    const snapshot = summaries().find(row => row.id === id) ?? null;
    if (pauseNameRead) await pauseNameRead();
    return snapshot;
  }, listSummaries: async () => summaries(),
};
const assistants = load('src/features/assistants/AIAssistantManagement.ts', { ...common,
  './domain/HostRepository': {}, './domain/ApplicationSettingsAccess': access,
  '@shared/errors/SettingChangeConflictError': conflict,
  './application/HostAuthorityCoordinator': { HostAuthorityCoordinator: class {} },
  './infrastructure/SQLiteAssistantRepository': { aiAssistantRepository: aiPort },
  './infrastructure/SQLiteHostRepository': { aiHostRepository: {} },
});
const { GroupChatRepository } = load('src/features/chat/group/infrastructure/SQLiteGroupChatRepository.ts', {
  ...common, '@features/profile': {},
});
const groupRuntime = load('src/features/chat/group/application/ChatGroupRuntime.ts', { '@shared/runtime/RuntimeSlot': slot });
groupRuntime.configureChatGroupRuntime({ groups: new GroupChatRepository() });
const groupQueries = load('src/features/chat/group/application/GroupChatManagement.ts', {
  './ChatGroupRuntime': groupRuntime, './GroupAutoInvocationScheduler': {}, '@features/media': media,
});
const userDomain = load('src/features/profile/domain/UserProfile.ts', { '@shared': { SELF_USER_ID: 'self', DEFAULT_SELF_NAME: '用户' } });
const { SQLiteUserProfileRepository } = load('src/features/profile/infrastructure/SQLiteUserProfileRepository.ts', { ...common, '../domain/UserProfile': userDomain });
const userRepository = new SQLiteUserProfileRepository();
const covers = load('src/features/profile/application/MomentsCoverSettings.ts', common);
const wallpaperFacts = load('src/features/profile/application/WallpaperChanged.ts');
const wallpapers = load('src/features/profile/application/WallpaperSettings.ts', { ...common,
  './WallpaperChanged': wallpaperFacts,
  './legacyWallpaperSettings': { loadStoredWallpaperStateStrict: async () => { throw new Error('fixture 已完成初始化'); } },
});
const { SQLiteWallpaperRepository } = load('src/features/profile/infrastructure/SQLiteWallpaperRepository.ts', common);
wallpapers.configureWallpaperRuntime(new SQLiteWallpaperRepository());
const profile = load('src/features/profile/composition.ts', { ...common,
  './domain/UserProfile': userDomain, './infrastructure/SQLiteUserProfileRepository': { userProfileRepository: userRepository },
  './application/MomentsCoverSettings': covers, './application/WallpaperSettings': wallpapers, './infrastructure/SQLiteWallpaperRepository': {},
});
const { SQLiteCallBackgroundRepository } = load('src/features/calls/infrastructure/SQLiteCallBackgroundRepository.ts', common);
const calls = load('src/features/calls/application/CallBackgroundSettings.ts', common);
calls.configureCallBackgroundRuntime(new SQLiteCallBackgroundRepository());
const fence = load('src/host/composition/agent/assertImageToolRunCurrent.ts', {
  '@shared/runtime/abortSignal': abort,
  '@features/chat': { isChatReplyRunCurrentInTransaction: async () => runCurrent,
    isGroupSpeechTaskRunCurrentInTransaction: async () => runCurrent },
});
const viewed = [];
let visionRoute = 'direct_vision', pauseVision = null;
class BrokenGroupImage extends Error {}
const imageRuntime = load('src/features/media/application/AIImageRuntime.ts', { '@shared/runtime/RuntimeSlot': slot });
const imageTools = load('src/features/media/application/AIImageTools.ts', {
  'expo-file-system': {}, '@platform/device': { inspectLocalImage: async uri => {
    if (uri === 'file:///broken-group.png') throw new BrokenGroupImage();
    return { mimeType: 'image/png', isAnimated: false };
  } },
  '@platform/web': {}, '@shared/runtime/abortSignal': abort, './AIImageRuntime': imageRuntime,
  './MediaImageToolResult': {}, './MediaAssetRuntime': mediaRuntime, './MediaAssetBacking': backing,
});
imageRuntime.configureAIImageRuntime({ view: async input => {
  viewed.push(input);
  if (pauseVision) await pauseVision();
  return { route: visionRoute, ocrSucceeded: visionRoute === 'ocr' ? true : null,
    parts: visionRoute === 'ocr' ? [{ type: 'text', text: '辅助视觉转述群头像' }]
      : [{ type: 'text', text: '原图已提供' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] };
}, resolveAvatar: async (target, _actor, selector) => ({ status: 'found', imageUri: 'file:///default-avatar.png', label: `${selector ?? target}的头像` }) });
const { applicationSettingsTools } = load('src/host/composition/agent/ApplicationSettingsTools.ts', {
  'react-native': { Dimensions: { get: () => ({ width: 1080, height: 2400 }) } },
  'expo-asset': { Asset: { fromModule: assetId => ({ downloadAsync: async () => ({ localUri: assetId === 2 ? 'file:///default-group.png' : 'file:///default-cover.png' }) }) } },
  '@shared/avatar/avatarRegistry': { getDefaultGroupAvatarAsset: () => 2 },
  '@features/chat': groupQueries,
  '@features/moments': { DEFAULT_MOMENTS_COVER_SOURCE: 1 },
  '@features/assistants': { ...assistants, ...access }, '@features/profile': { ...profile, ...wallpapers }, '@features/calls': calls,
  '@features/media': { ...imageTools, mediaImageFailure: error => error instanceof MediaAssetNotFoundError
    ? { status: 'error', code: 'IMAGE_NOT_FOUND', retryable: false, modelContent: '图片不存在' }
    : error instanceof BrokenGroupImage ? { status: 'error', code: 'IMAGE_UNREADABLE', retryable: false, modelContent: '群头像文件已损坏' } : null },
  '@shared/errors/SettingChangeConflictError': conflict, '@shared/runtime/abortSignal': abort,
  '@shared/theme/themeStorage': { loadStoredThemeId: async () => themeId }, './assertImageToolRunCurrent': fence,
});
const tools = new Map(applicationSettingsTools.map(entry => [entry.tool.name, entry.tool]));
const schemas = load('src/shared/aiTools/AgentToolInputSchema.ts', agentToolSchemaDependencies);
const context = (assistantId = 'a') => ({ task: { assistantId, source: 'chat', type: 'chat_reply' }, runId: 'run', abortSignal: new AbortController().signal });
const execute = (name, input = {}, actor = 'a') => {
  const tool = tools.get(name);
  assert.ok(schemas.matchesAgentToolInputSchema(input, tool.definition.parameters), `${name} 参数应有效`);
  return tool.execute(input, typeof actor === 'string' ? context(actor) : actor);
};
const now = new Date().toISOString();
for (const id of ['a', 'b', 'host']) {
  db.prepare('INSERT INTO ai_assistants (id,agent_id,name,nickname,model,is_host_ai,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, `agent-${id}`, '同名', id === 'b' ? '用户私密备注' : null, 'model', id === 'host' ? 1 : 0, now, now);
  db.prepare('INSERT INTO chat_conversations (id,kind) VALUES (?,?)').run(`conversation-${id}`, 'direct');
}
db.exec("INSERT INTO profile_wallpaper_selections (selection_key,revision) VALUES ('app',0),('chat',0)");
await userRepository.ensureDefault();
files.set('file:///original.png', 'original-image');
await creator.execute({ sourceUri: 'file:///original.png', storageBackend: 'persistent-media', fileName: 'original.png',
  mimeType: 'image/png', width: 1200, height: 1600, durationMs: null }, async ({ transaction: tx, asset }) => {
  await tx.runAsync('INSERT INTO ai_downloaded_images VALUES (?,?,?,?,?,?)', ['download', 'a', asset.id, 'https://example.com/a.png', 'original.png', now]);
});
const originalId = db.prepare('SELECT media_asset_id AS id FROM ai_downloaded_images').get().id;
const set = { action: 'set', media_asset_id: originalId };
const reset = { action: 'reset' };
assistants.subscribeAIAssistantUpdated(ai => updates.push(['ai', ai.id]));
profile.subscribeUserProfileUpdated(() => updates.push(['user']));
wallpaperFacts.subscribeWallpaperChanged(() => updates.push(['wallpaper']));
calls.subscribeCallBackgroundChanged(id => updates.push(['call', id]));

// 参数契约只在 Runtime 边界验证；不接受 URI、伪造 actor 或含混的恢复参数。
for (const { tool } of applicationSettingsTools) schemas.assertAgentToolInputSchema(tool.definition.parameters);
for (const invalid of [{ action: 'set' }, { ...set, actor_id: 'host' }, { action: 'reset', media_asset_id: originalId },
  { ...set, source_uri: 'file:///private.png' }]) assert.equal(schemas.matchesAgentToolInputSchema(invalid, tools.get('set_ai_avatar').definition.parameters), false);
assert.equal(schemas.matchesAgentToolInputSchema({ name: '   ' }, tools.get('set_ai_name').definition.parameters), false);

assert.equal((await execute('set_ai_name', { name: '新名字' })).status, 'success');
assert.equal(db.prepare("SELECT name FROM ai_assistants WHERE id='a'").get().name, '新名字');
assert.equal((await execute('set_ai_name', { name: '越权', agent_id: 'agent-b' })).code, 'SETTING_ACCESS_DENIED');
assert.equal((await execute('set_ai_name', { name: '公开新名', agent_id: 'agent-b' }, 'host')).status, 'success');
assert.equal(db.prepare("SELECT nickname FROM ai_assistants WHERE id='b'").get().nickname, '用户私密备注');
assert.equal((await execute('set_ai_avatar', { ...set, agent_id: 'b' }, 'host')).code, 'SETTING_TARGET_UNAVAILABLE', '不能把内部实体 ID 当 agentId');
assert.equal((await execute('get_ai_avatar', { agent_id: 'agent-b' })).status, 'success', '公开头像允许跨 AI 查看');
assert.equal((await execute('get_chat_background', { agent_id: 'agent-b' })).code, 'SETTING_ACCESS_DENIED');
for (const name of ['set_user_avatar', 'set_moments_cover', 'set_global_background', 'get_global_background']) {
  assert.equal((await execute(name, name.startsWith('set_') ? set : {})).code, 'SETTING_ACCESS_DENIED');
}
for (const name of ['set_ai_avatar', 'set_chat_background', 'set_call_background']) {
  assert.equal((await execute(name, set)).status, 'success');
  assert.equal((await execute(name, { ...set, agent_id: 'agent-b' })).code, 'SETTING_ACCESS_DENIED');
  assert.equal((await execute(name, { ...set, agent_id: 'agent-b' }, 'host')).status, 'success');
}
for (const name of ['set_user_avatar', 'set_moments_cover', 'set_global_background']) assert.equal((await execute(name, set, 'host')).status, 'success');
assert.ok(cropRequests.some(request => request.aspect[0] === 1 && request.aspect[1] === 1));
assert.ok(cropRequests.some(request => request.aspect[0] === 16 && request.aspect[1] === 9));
assert.ok(cropRequests.some(request => request.aspect[0] === 1080 && request.aspect[1] === 2400));
assert.ok(updates.some(([kind]) => kind === 'ai') && updates.some(([kind]) => kind === 'user')
  && updates.some(([kind]) => kind === 'wallpaper') && updates.some(([kind]) => kind === 'call'));
assert.ok(!JSON.stringify((await execute('set_ai_name', { name: '公开名称', agent_id: 'agent-b' }, 'host'))).includes('用户私密备注'));

for (const name of ['get_chat_background', 'get_call_background', 'get_moments_cover', 'get_user_avatar']) {
  const result = await execute(name);
  assert.equal(result.status, 'success');
  assert.equal(result.modelImages[0].url, 'data:image/png;base64,AA==', '设置查询复用真实视觉 observation');
}
assert.equal((await execute('get_global_background', {}, 'host')).status, 'success');
await execute('set_chat_background', reset);
themeId = 'liquid-glass';
assert.equal((await execute('get_chat_background')).data.source, 'global_glass');
themeId = 'default-light';
const defaultBackground = await execute('get_chat_background');
assert.equal(defaultBackground.data.hasImage, false);
assert.equal(defaultBackground.modelImages, undefined, '默认绘制背景不伪造图片');
await execute('set_moments_cover', reset, 'host');
assert.equal((await execute('get_moments_cover')).data.source, 'default_cover');
assert.equal(viewed.at(-1).imageUri, 'file:///default-cover.png', '默认封面取实际打包图片');

// 群头像只查询头像与当前成员关系；不依赖群管理员配置或向模型暴露成员私有资料。
for (const [id, avatar, mediaAssetId] of [['group-a', null, originalId], ['group-b', 'file:///legacy-group.png', null],
  ['group-default', null, null], ['group-broken', 'file:///broken-group.png', null]]) {
  db.prepare('INSERT INTO chat_conversations (id,kind) VALUES (?,?)').run(id, 'group');
  db.prepare('INSERT INTO group_chats (id,name,avatar,avatar_media_asset_id,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id, '同名群', avatar, mediaAssetId, now, now);
}
for (const [groupId, assistantId, enabled] of [['group-a', 'a', 1], ['group-a', 'b', 0], ['group-b', 'b', 1],
  ['group-default', 'a', 1], ['group-broken', 'a', 1]]) {
  db.prepare(`INSERT INTO group_chat_members (id,group_id,ai_assistant_id,agent_id,display_order,enabled,created_at,updated_at)
    VALUES (?,?,?,?,0,?,?,?)`).run(`${groupId}-${assistantId}`, groupId, assistantId, `agent-${assistantId}`, enabled, now, now);
}
const currentGroupActor = { ...context(), task: { ...context().task, type: 'group_chat_reply', sessionId: 'group-a' } };
const currentGroupAvatar = await execute('get_group_avatar', {}, currentGroupActor);
assert.equal(currentGroupAvatar.status, 'success');
assert.equal(currentGroupAvatar.data.groupId, 'group-a');
assert.equal(currentGroupAvatar.data.mediaAssetId, originalId);
assert.equal(currentGroupAvatar.modelImages[0].url, 'data:image/png;base64,AA==');
assert.match(currentGroupAvatar.modelContent, /group-a/);
assert.ok(!JSON.stringify(currentGroupAvatar).includes('用户私密备注'));
assert.equal((await execute('get_group_avatar', { group_id: 'group-a' })).status, 'success', '单聊允许明确读取仍参加的群');
const deniedVisualCount = viewed.length;
assert.equal((await execute('get_group_avatar')).code, 'SETTING_TARGET_REQUIRED');
assert.equal((await execute('get_group_avatar', {}, { ...context(), task: { ...context().task, sessionId: 'group-a' } })).code,
  'SETTING_TARGET_REQUIRED', '非群任务的 sessionId 不得被当作当前群');
assert.equal((await execute('get_group_avatar', { group_id: 'group-b' })).code, 'SETTING_ACCESS_DENIED');
assert.equal((await execute('get_group_avatar', { group_id: 'group-a' }, 'b')).code, 'SETTING_ACCESS_DENIED', '禁用的成员关系没有读取资格');
assert.equal((await execute('get_group_avatar', { group_id: 'missing-group' })).code, 'SETTING_TARGET_UNAVAILABLE');
assert.equal(viewed.length, deniedVisualCount, '未授权或目标不存在时不读取或交付图片');
for (const input of [{ group_id: '' }, { group_id: 'group-b', is_host_ai: true }, { group_id: 'group-b', assistant_id: 'host' }]) {
  assert.equal(schemas.matchesAgentToolInputSchema(input, tools.get('get_group_avatar').definition.parameters), false);
}
const hostGroupAvatar = await execute('get_group_avatar', { group_id: 'group-b' }, 'host');
assert.equal(hostGroupAvatar.status, 'success', '当前主理不必入群即可读取');
assert.equal(hostGroupAvatar.data.groupId, 'group-b', '重名群按稳定 group_id 定位');
assert.equal(viewed.at(-1).imageUri, 'file:///legacy-group.png');
const defaultGroupAvatar = await execute('get_group_avatar', { group_id: 'group-default' }, currentGroupActor);
assert.equal(defaultGroupAvatar.data.mediaAssetId, null);
assert.equal(defaultGroupAvatar.data.groupId, 'group-default', '显式目标优先于当前群');
assert.equal(viewed.at(-1).imageUri, 'file:///default-group.png', '默认群头像使用实际打包资源');
visionRoute = 'ocr';
const auxiliaryGroupAvatar = await execute('get_group_avatar', { group_id: 'group-a' });
assert.equal(auxiliaryGroupAvatar.data.route, 'ocr');
assert.deepEqual(auxiliaryGroupAvatar.modelImages, []);
assert.match(auxiliaryGroupAvatar.modelContent, /辅助视觉转述群头像/);
visionRoute = 'direct_vision';
assert.equal((await execute('get_group_avatar', { group_id: 'group-broken' })).code, 'IMAGE_UNREADABLE', '选中图片损坏时不伪装成默认头像');
db.exec("DELETE FROM group_chat_members WHERE group_id='group-a' AND ai_assistant_id='a'");
assert.equal((await execute('get_group_avatar', {}, currentGroupActor)).code, 'SETTING_ACCESS_DENIED', '移出群后不能沿用当前任务的旧成员快照');
db.exec("UPDATE ai_assistants SET is_host_ai=0 WHERE id='host'");
assert.equal((await execute('get_group_avatar', { group_id: 'group-b' }, 'host')).code, 'SETTING_ACCESS_DENIED', '撤销主理后恢复普通成员权限');
db.exec("UPDATE ai_assistants SET is_host_ai=1 WHERE id='host'");
db.exec("DELETE FROM group_chats WHERE id='group-b'");
assert.equal((await execute('get_group_avatar', { group_id: 'group-b' }, 'host')).code, 'SETTING_TARGET_UNAVAILABLE');
let visionStarted, resumeVision;
const visionBegun = new Promise(resolve => { visionStarted = resolve; });
pauseVision = async () => { visionStarted(); await new Promise(resolve => { resumeVision = resolve; }); };
const groupViewController = new AbortController();
const groupViewing = execute('get_group_avatar', { group_id: 'group-default' }, { ...context(), abortSignal: groupViewController.signal });
await visionBegun;
groupViewController.abort();
resumeVision();
await assert.rejects(groupViewing, { name: 'AbortError' });
pauseVision = null;

// 文件准备暂停后再修改事实，检查迟到提交不会覆盖用户或已撤销的主理身份。
async function duringCrop(name, actor, mutate, expectedCode, input = set) {
  let started, release;
  const begun = new Promise(resolve => { started = resolve; });
  pauseCrop = async () => { started(); await new Promise(resolve => { release = resolve; }); };
  const beforeAssets = db.prepare('SELECT COUNT(*) AS count FROM media_assets').get().count;
  const pending = execute(name, input, actor);
  await begun;
  await mutate();
  const committedUpdates = updates.length;
  release();
  if (expectedCode === 'AbortError') await assert.rejects(pending, { name: 'AbortError' });
  else assert.equal((await pending).code, expectedCode);
  pauseCrop = null;
  assert.ok(db.prepare('SELECT COUNT(*) AS count FROM media_assets').get().count <= beforeAssets, '失败不留下无主资产');
  assert.equal(updates.length, committedUpdates, '失败不广播设置成功事实');
  const backingUris = new Set(db.prepare('SELECT storage_key FROM media_assets').all().map(row => `file:///${row.storage_key}`));
  for (const uri of files.keys()) if (uri.startsWith('file:///catalog/')) assert.ok(backingUris.has(uri), '回滚后不留下未被资产接管的 backing');
}
await duringCrop('set_ai_avatar', 'a', async () => db.exec("UPDATE ai_assistants SET avatar='file:///user-new.png',avatar_media_asset_id=NULL WHERE id='a'"), 'SETTING_CHANGE_CONFLICT');
assert.equal((await aiRepository.getAvatarMediaAssetReference('a')).avatar, 'file:///user-new.png');
await duringCrop('set_call_background', 'a', () => calls.clearCallBackground('a'), 'SETTING_CHANGE_CONFLICT');
await duringCrop('set_chat_background', 'a', () => wallpapers.changeWallpaperFromMediaAsset('single:conversation-a',
  { mediaAssetId: null, aspect: [1, 1], signal: context().abortSignal }, async () => {}), 'SETTING_CHANGE_CONFLICT');
await duringCrop('set_user_avatar', 'host', async () => db.exec("UPDATE user_profile SET avatar='file:///user-new.png',avatar_media_asset_id=NULL WHERE id='self'"), 'SETTING_CHANGE_CONFLICT');
await duringCrop('set_moments_cover', 'host', () => profile.updateCurrentUserMomentsCover(null), 'SETTING_CHANGE_CONFLICT');
await duringCrop('set_global_background', 'host', async () => db.exec("UPDATE ai_assistants SET is_host_ai=0 WHERE id='host'"), 'SETTING_ACCESS_DENIED');
db.exec("UPDATE ai_assistants SET is_host_ai=1 WHERE id='host'");
await duringCrop('set_ai_avatar', 'host', async () => db.exec("UPDATE ai_assistants SET is_host_ai=0 WHERE id='host'"), 'SETTING_ACCESS_DENIED', { ...set, agent_id: 'agent-b' });
db.exec("UPDATE ai_assistants SET is_host_ai=1 WHERE id='host'");
await duringCrop('set_ai_avatar', 'a', async () => { runCurrent = false; }, 'AbortError');
runCurrent = true;
const controller = new AbortController();
await duringCrop('set_chat_background', { ...context(), abortSignal: controller.signal }, async () => controller.abort(), 'AbortError');
const groupActor = { ...context(), task: { ...context().task, type: 'group_chat_reply' } };
await duringCrop('set_ai_avatar', groupActor, async () => { runCurrent = false; }, 'AbortError');
runCurrent = true;

let nameReadStarted, resumeNameRead;
const nameReadBegun = new Promise(resolve => { nameReadStarted = resolve; });
pauseNameRead = async () => { pauseNameRead = null; nameReadStarted(); await new Promise(resolve => { resumeNameRead = resolve; }); };
const nameChange = execute('set_ai_name', { name: '迟到名称' });
await nameReadBegun;
db.exec("UPDATE ai_assistants SET name='用户新名称' WHERE id='a'");
resumeNameRead();
assert.equal((await nameChange).code, 'SETTING_CHANGE_CONFLICT');
assert.equal(db.prepare("SELECT name FROM ai_assistants WHERE id='a'").get().name, '用户新名称');

assert.equal((await execute('set_ai_avatar', { action: 'set', media_asset_id: 'missing' })).code, 'IMAGE_NOT_FOUND');
for (const name of ['set_ai_avatar', 'set_chat_background', 'set_call_background']) assert.equal((await execute(name, reset)).status, 'success');
for (const name of ['set_user_avatar', 'set_moments_cover', 'set_global_background']) assert.equal((await execute(name, reset, 'host')).status, 'success');
assert.equal((await aiRepository.getAvatarMediaAssetReference('a')).avatarMediaAssetId, null);
assert.ok(await mediaRepository.getById(originalId), '原图的下载引用仍存在，不得因裁剪或恢复默认删除');
assert.equal(files.get('file:///original.png'), 'original-image');
assert.ok(deleted.length > 0 && ![...files.keys()].some(uri => uri.startsWith('file:///crop-')), '成功和失败均清理裁剪暂存');
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
db.close();

// 还原 127 的昵称审计表与旧工具身份，验证升级保留权限、特批及已展开的包。
const upgrade = new DatabaseSync(':memory:');
const upgradeExecutor = createSqliteExecutor(upgrade);
await bootstrapSqlite(upgradeExecutor);
upgrade.exec(`INSERT INTO ai_assistants (id,agent_id,name,model,created_at,updated_at) VALUES ('old','agent-old','旧名称','model','${now}','${now}');
  INSERT INTO chat_conversations (id,kind) VALUES ('old-chat','direct');
  INSERT INTO chat_tool_package_exposure VALUES ('old-chat','old','media');
  INSERT INTO assistant_tool_permissions VALUES ('old','change_own_avatar',0,'${now}');
  INSERT INTO assistant_direct_tools VALUES ('old','change_own_avatar');
  INSERT INTO prompt_default_switches VALUES ('tool:change_own_avatar',0);
  CREATE TABLE assistant_nickname_changes(id INTEGER PRIMARY KEY AUTOINCREMENT,
    assistant_id TEXT NOT NULL REFERENCES ai_assistants(id) ON DELETE CASCADE,
    previous_nickname TEXT, nickname TEXT, acknowledged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
  ALTER TABLE raven_cat_ai_schedules DROP COLUMN system_calendar;
  ALTER TABLE chat_summary_request_settings DROP COLUMN primary_limit;
  PRAGMA user_version=127;`);
upgrade.exec(`CREATE TRIGGER reject_setting_migration BEFORE INSERT ON prompt_default_switches
  WHEN NEW.key='tool:set_ai_avatar' BEGIN SELECT RAISE(ABORT,'injected setting migration'); END;`);
await assert.rejects(bootstrapSqlite(upgradeExecutor), /injected setting migration/);
assert.equal(upgrade.prepare('PRAGMA user_version').get().user_version, 127);
assert.equal(upgrade.prepare("SELECT tool_name FROM assistant_direct_tools WHERE assistant_id='old'").get().tool_name, 'change_own_avatar');
assert.equal(upgrade.prepare("SELECT COUNT(*) AS n FROM assistant_tool_permissions WHERE tool_name='set_ai_avatar'").get().n, 0);
upgrade.exec('DROP TRIGGER reject_setting_migration');
await bootstrapSqlite(upgradeExecutor);
assert.equal(upgrade.prepare('PRAGMA user_version').get().user_version, DATABASE_SCHEMA_VERSION);
assert.equal(upgrade.prepare("SELECT enabled FROM assistant_tool_permissions WHERE tool_name='set_ai_avatar'").get().enabled, 0);
assert.equal(upgrade.prepare("SELECT enabled FROM prompt_default_switches WHERE key='tool:set_ai_avatar'").get().enabled, 0);
assert.equal(upgrade.prepare("SELECT tool_name FROM assistant_direct_tools WHERE assistant_id='old'").get().tool_name, 'set_ai_avatar');
assert.equal(upgrade.prepare("SELECT COUNT(*) AS n FROM assistant_tool_permissions WHERE tool_name='change_own_avatar'").get().n, 0);
assert.equal(upgrade.prepare("SELECT package_id FROM chat_tool_package_exposure WHERE session_id='old-chat'").get().package_id, 'media');
assert.equal(upgrade.prepare("SELECT name FROM ai_assistants WHERE id='old'").get().name, '旧名称');
await bootstrapSqlite(upgradeExecutor);
assert.equal(upgrade.prepare("SELECT enabled FROM assistant_tool_permissions WHERE tool_name='set_ai_avatar'").get().enabled, 0);
upgrade.close();
console.log('应用设置工具验证通过：权限、稳定身份、自动裁剪接入、视觉读取、默认图、CAS、撤权、取消与媒体引用。');
