import { chatMessageMutations } from './chat-timeline-fixture.mjs';
/** 媒体文件所有权：备份持有、草稿退出、提交失败与 legacy 恢复重定位的行为回归。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
function load(relative, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.startsWith('.')) return load(path.relative(root, path.resolve(root, path.dirname(relative), `${specifier}.ts`)), mocks);
    throw new Error(`未声明的依赖：${specifier}`);
  }, module, module.exports);
  return module.exports;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

// 真实 Store 删除必须等到备份读取完成；备份失败也会释放持有。
const lifetime = load('src/platform/device/MediaFileLifetime.ts');
const files = new Set(['file:///documents/persistent-media/catalog/media/live.png']);
const deviceMocks = {
  './MediaFileLifetime': lifetime,
  'expo-file-system/legacy': {
    documentDirectory: 'file:///documents/',
    getInfoAsync: async (uri) => ({ exists: files.has(uri) || [...files].some((file) => file.startsWith(uri)), isDirectory: uri.endsWith('/'), uri }),
    readDirectoryAsync: async (uri) => [...files].filter((file) => file.startsWith(uri)).map((file) => file.slice(uri.length)),
    deleteAsync: async (uri) => { files.delete(uri); },
  },
};
const mediaStore = load('src/platform/device/PersistentMediaStore.ts', deviceMocks);
const imageStore = load('src/platform/device/PersistentImageStore.ts', deviceMocks);
const gate = deferred();
const liveUri = [...files][0];
const backup = lifetime.withMediaFileLifetime(async () => { await gate.promise; assert.ok(files.has(liveUri)); });
await tick();
const deletion = mediaStore.persistentMediaStore.deleteAssetStorageKey('catalog/media/live.png');
await tick();
assert.ok(files.has(liveUri), '备份读取期间已提交媒体不得被物理删除');
gate.resolve(); await backup; await deletion;
assert.equal(files.has(liveUri), false);
await assert.rejects(lifetime.withMediaFileLifetime(async () => { throw new Error('archive failed'); }), /archive failed/);
await lifetime.withMediaFileLifetime(async () => {});

// 快照清理只能触碰 Calls 的平面目录，SQLite 中的错误地址不能扩大删除范围。
const snapshotUri = 'file:///documents/persistent-media/calls/snapshots/frame.jpg';
files.add(snapshotUri);
await mediaStore.persistentMediaStore.deleteCategoryFileIfExists(snapshotUri, 'callSnapshot');
assert.equal(files.has(snapshotUri), false);
for (const uri of [liveUri, 'file:///documents/persistent-media/calls/snapshots/../../outside.jpg', 'file:///documents/persistent-media/calls/snapshots/%2e%2e.jpg']) {
  await assert.rejects(mediaStore.persistentMediaStore.deleteCategoryFileIfExists(uri, 'callSnapshot'));
}

const currentSnapshotUri = 'file:///documents/persistent-media/calls/snapshots/current-frame.jpg';
files.add(snapshotUri); files.add(currentSnapshotUri); files.add(liveUri);
await mediaStore.persistentMediaStore.deleteCategoryFilesExceptPrefix('callSnapshot', 'current-');
assert.equal(files.has(snapshotUri), false, '回收没有 SQLite 记录的快照');
assert.ok(files.has(currentSnapshotUri), '保留当前运行实例的帧');
assert.ok(files.has(liveUri), '目录清理不影响长期资产');
files.delete(currentSnapshotUri); files.delete(liveUri);

// 最小 Hook 宿主只模拟 React 状态与 effect 生命周期，调用的是产品 Hook 的真实行为。
function hookHost() {
  const slots = []; let cursor = 0; let pending = [];
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) {
      const index = cursor++;
      const slot = slots[index] ??= { value: typeof value === 'function' ? value() : value };
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        const previous = slots[index]; const slot = { deps }; slots[index] = slot;
        pending.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
  return {
    react,
    render(hook) { cursor = 0; pending = []; const result = hook(); pending.forEach((effect) => effect()); return result; },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
}
{
  const host = hookHost(); const drafts = new Set(); let sequence = 0; let pendingCopy = null;
  const draftFiles = load('src/features/chat/presentation/messages/ChatDetail/ChatAttachmentDraftFiles.ts', {
    '@platform/device/DeviceMediaService': { deletePersistentMediaIfExists: async (uri) => { drafts.delete(uri); } },
  });
  const picked = { uri: 'content://picked', fileName: 'picked.png', mimeType: 'image/png', source: 'gallery' };
  const { useAttachmentDraft } = load('src/features/chat/presentation/messages/ChatDetail/useAttachmentDraft.ts', {
    react: host.react,
    './ChatAttachmentDraftFiles': draftFiles,
    '../../../messages/application/AttachmentParser': { attachmentParser: {}, assertChatAttachmentFileSupported() {} },
    '@features/chat/messages/domain': load('src/features/chat/messages/domain/ChatAttachment.ts'),
    '@platform/device/DeviceMediaService': {
      PERSISTENT_MEDIA_CATEGORY: mediaStore.PERSISTENT_MEDIA_CATEGORY,
      pickChatImageFromDevice: async () => picked,
      deletePersistentMediaIfExists: async (uri) => { drafts.delete(uri); },
      persistDeviceMedia: async () => {
        const uri = `file:///draft-${++sequence}.png`; drafts.add(uri);
        if (pendingCopy) await pendingCopy.promise;
        return uri;
      },
    },
  });
  const render = () => host.render(useAttachmentDraft);
  let draft = render(); await draft.selectImageAttachment(); draft = render();
  const uri = draft.readyAttachments[0].localUri;
  const first = deferred(); const second = deferred();
  const sendingFirst = draft.withAttachmentSubmission(async () => first.promise, () => true);
  const sendingSecond = draft.withAttachmentSubmission(async () => second.promise, () => true);
  draft.clearAttachment(); await tick();
  assert.ok(drafts.has(uri), '移除正在发送的草稿只撤销展示，不抢删源文件');
  first.resolve(); await sendingFirst;
  assert.ok(drafts.has(uri), '同一草稿还有一个发送者持有源文件');
  second.resolve(); await sendingSecond; await tick();
  assert.equal(drafts.has(uri), false);
  await draft.selectImageAttachment(); draft = render();
  await assert.rejects(draft.withAttachmentSubmission(async () => { throw new Error('send failed'); }, () => true), /send failed/);
  assert.ok(drafts.has(draft.readyAttachments[0].localUri), '提交失败后保留当前草稿供重试');
  await draft.selectImageAttachment(); draft = render();
  assert.equal(drafts.size, 1, '替换草稿回收旧副本');
  const oldUri = draft.readyAttachments[0].localUri;
  const sendGate = deferred();
  const oldSend = draft.withAttachmentSubmission(async () => sendGate.promise, () => true);
  await draft.selectImageAttachment(); draft = render();
  const newUri = draft.readyAttachments[0].localUri;
  sendGate.resolve(); await oldSend; await tick();
  assert.equal(drafts.has(oldUri), false);
  assert.ok(drafts.has(newUri), '旧发送完成不能清空用户后来选择的新附件');
  assert.equal(render().readyAttachments[0].localUri, newUri);
  pendingCopy = deferred(); const selecting = draft.selectImageAttachment(); await tick();
  host.unmount(); pendingCopy.resolve(); await selecting; await tick();
  assert.equal(drafts.size, 0, '退出页面后迟到的复制结果也必须释放');
}

// 失败气泡接管源文件并可独立重试；关闭页面也不抢删重试正在读取的文件。
{
  const host = hookHost(); const files = new Set(['file:///failed-draft.png']);
  const draftFiles = load('src/features/chat/presentation/messages/ChatDetail/ChatAttachmentDraftFiles.ts', {
    '@platform/device/DeviceMediaService': { deletePersistentMediaIfExists: async (uri) => { files.delete(uri); } },
  });
  const attachment = { id: 'image', type: 'image', source: 'gallery', localUri: [...files][0], fileName: 'image.png' };
  const releaseInput = draftFiles.ownChatAttachmentDraftFile(attachment.localUri);
  let messages = []; let retryGate = null;
  const { useChatSendFlow } = load('src/features/chat/presentation/messages/ChatDetail/useChatSendFlow.ts', {
    react: host.react, './ChatAttachmentDraftFiles': draftFiles,
    '../../../messages/application/MessageTimeline': { messageTimeline: {
      createOptimisticUserMessages: ({ attachments }) => [{ id: -1, isMe: true, status: 'pending', text: '', metadataJson: JSON.stringify({ attachments }) }],
      mergeMessages: (_previous, next) => ({ messages: next, changed: true, lastMessageId: next.at(-1).id }),
    } },
    '../../../messages/application/SendUserMessage': { sendUserMessage: async () => {
      if (!retryGate) return { userMessage: null, userMessages: [], success: false, error: 'commit failed' };
      await retryGate.promise;
      assert.ok(files.has(attachment.localUri), '重试结束前源文件仍可读取');
      const message = { id: 1, isMe: true, text: '', metadataJson: JSON.stringify({ attachments: [{ mediaAssetId: 'canonical' }] }) };
      return { userMessage: message, userMessages: [message], success: true };
    } },
    '../../../conversation/application/ChatCallGateway': { getActiveChatCall: async () => null, isChatSendBlockedByCall: () => false },
    '../../../conversation/application/ChatTogetherListeningGateway': {},
    '../../../messages/application/UserVoiceMessageRecording': {},
  });
  const render = () => host.render(() => useChatSendFlow({
    sessionId: 'chat', aiAssistant: { id: 'ai' }, aiRequestConfig: { id: 'ai' }, messages,
    setMessages: (next) => { messages = typeof next === 'function' ? next(messages) : next; },
    setError() {}, setIsTyping() {}, lastMessageIdRef: { current: null },
  }));
  let flow = render(); await flow.sendMessage('', null, [attachment]);
  releaseInput(); await tick();
  assert.ok(files.has(attachment.localUri), '输入草稿清除后失败气泡仍持有可重试源');
  flow = render(); retryGate = deferred();
  const retry = flow.retrySend(-1); await tick(); host.unmount(); await tick();
  assert.ok(files.has(attachment.localUri));
  retryGate.resolve(); await retry; await tick();
  assert.equal(files.size, 0, '重试完成后没有草稿或失败气泡时释放源');
}
{
  const host = hookHost(); const drafts = new Set(); let sequence = 0;
  const { usePersistentAvatarDraft } = load('src/platform/device/usePersistentAvatarDraft.ts', {
    react: host.react,
    'react-native': { Dimensions: { get: () => ({ width: 360, height: 800, scale: 3 }) } },
    'expo-image-picker': {
      requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
      launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'content://avatar', fileName: 'avatar.png', mimeType: 'image/png' }] }),
    },
    './PersistentImageStore': {
      persistentImageStore: {
        copyPickedImageToAppStorage: async () => { const uri = `file:///avatar-draft-${++sequence}.png`; drafts.add(uri); return uri; },
        deleteManagedIfExists: async (uri) => { drafts.delete(uri); },
      },
    },
  });
  const render = () => host.render(() => usePersistentAvatarDraft({ category: 'userAvatar', entityId: 'self', committedUri: null }));
  let avatar = render(); await avatar.pickAvatar(); avatar = render();
  await avatar.commitAvatar(async () => ({ avatar: 'file:///canonical/avatar.png' }), (result) => result.avatar);
  assert.equal(drafts.size, 0, 'canonical 接管后回收 picker 的持久草稿副本');
  assert.equal(render().avatarUri, 'file:///canonical/avatar.png');
  await avatar.pickAvatar(); avatar = render();
  await assert.rejects(avatar.commitAvatar(async () => { throw new Error('CAS failed'); }), /CAS failed/);
  assert.equal(drafts.size, 1, '头像提交失败保留草稿');
  const committing = deferred();
  const commit = avatar.commitAvatar(async () => { await committing.promise; return { avatar: 'file:///canonical/new.png' }; }, (result) => result.avatar);
  host.unmount(); assert.equal(drafts.size, 1, '卸载不抢删提交中的头像源');
  committing.resolve(); await commit;
  assert.equal(drafts.size, 0);
}

// Host 的真实恢复装配 + owner 的真实 SQLite 更新：跨根、幂等、旧包与失败回滚。
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE user_profile (id TEXT PRIMARY KEY, avatar TEXT, avatar_media_asset_id TEXT);
  CREATE TABLE ai_assistants (id TEXT PRIMARY KEY, avatar TEXT, avatar_media_asset_id TEXT);
  CREATE TABLE group_chats (id TEXT PRIMARY KEY, avatar TEXT, avatar_media_asset_id TEXT);
  CREATE TABLE messages (id INTEGER PRIMARY KEY, metadata_json TEXT);
`);
const executor = {
  getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
  runAsync: async (sql, params = []) => db.prepare(sql).run(...params),
};
const persistence = { databaseCoordinator: {
  async transaction(_metadata, work) {
    db.exec('BEGIN');
    try { const result = await work(executor); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
} };
const ownerMocks = {
  './ChatMessageMutationSql': chatMessageMutations,
  './SQLiteAuxiliaryModelDefaults': {}, './SQLiteAuxiliaryModelRepository': {},
  '@platform/persistence': persistence, '@features/media': {}, '@features/profile': {},
  '@shared': { SELF_USER_ID: 'self', DEFAULT_SELF_NAME: 'user' },
  '../domain/AIProfile': {},
};
const profile = load('src/features/profile/infrastructure/SQLiteUserProfileRepository.ts', ownerMocks);
const ai = load('src/features/assistants/infrastructure/SQLiteAssistantRepository.ts', ownerMocks);
const group = load('src/features/chat/group/infrastructure/SQLiteGroupChatRepository.ts', ownerMocks);
const message = load('src/features/chat/messages/infrastructure/SQLiteMessageRepository.ts', ownerMocks);
const settings = load('src/features/backup/infrastructure/stableSettingsBackupState.ts');
const rebase = load('src/host/media/RebaseRestoredLegacyMedia.ts', {
  '@features/backup/composition': settings,
  '@features/profile/composition': profile,
  '@features/assistants/composition': ai,
  '@features/chat/composition': { ...group, ...message },
  '@platform/persistence': persistence,
  '@platform/device': { ...imageStore, ...mediaStore, ...load('src/platform/device/RebaseLegacyMediaReference.ts') },
});
const sourceRoot = 'file:///old-install/files/persistent-media/';
const targetRoot = 'file:///documents/persistent-media/';
const imagePath = (category) => imageStore.getPersistentImageCategoryPrefix(category) + 'photo.png';
const mediaPath = (category) => mediaStore.getPersistentMediaCategoryPrefix(category) + 'attachment.png';
db.prepare('INSERT INTO user_profile VALUES (?, ?, ?)').run('self', sourceRoot + imagePath('userAvatar'), null);
db.prepare('INSERT INTO ai_assistants VALUES (?, ?, NULL)').run('ai', sourceRoot + imagePath('aiAvatar'));
db.prepare('INSERT INTO group_chats VALUES (?, ?, NULL)').run('group', sourceRoot + imagePath('groupAvatar'));
const legacy = { localUri: sourceRoot + mediaPath('chatImage'), thumbnailUri: sourceRoot + mediaPath('chatImage'), fileName: 'x.png', parsedText: '正文保持' };
const canonical = { mediaAssetId: 'stable-id', fileName: 'stable.png' };
const external = { localUri: 'https://example.test/photo.png' };
db.prepare('INSERT INTO messages VALUES (?, ?)').run(1, JSON.stringify({ attachments: [legacy, canonical, external], custom: '保持' }));
db.prepare('INSERT INTO messages VALUES (?, ?)').run(2, 'null');
const backupSettings = {
  schemaVersion: 5, legacyMediaRootUri: sourceRoot, theme: {},
  wallpaper: { appWallpaper: { mode: 'default', storageKey: null }, chatWallpaper: { mode: 'default', storageKey: null }, chatWallpaperOverrides: {} },
  call: { backgroundStorageKey: null }, bubbleSkins: {},
};
const oldPackage = { ...backupSettings }; delete oldPackage.legacyMediaRootUri;
await assert.rejects(rebase.rebaseRestoredLegacyMedia(JSON.stringify(oldPackage)), /来源长期媒体根无效/);
await rebase.rebaseRestoredLegacyMedia(JSON.stringify(backupSettings));
for (const table of ['user_profile', 'ai_assistants', 'group_chats']) assert.ok(db.prepare(`SELECT avatar FROM ${table}`).get().avatar.startsWith(targetRoot));
const restored = JSON.parse(db.prepare('SELECT metadata_json FROM messages WHERE id = 1').get().metadata_json);
assert.equal(restored.attachments[0].localUri, targetRoot + mediaPath('chatImage'));
assert.equal(restored.attachments[0].thumbnailUri, targetRoot + mediaPath('chatImage'));
assert.equal(restored.attachments[0].parsedText, '正文保持');
assert.deepEqual(restored.attachments[1], canonical); assert.deepEqual(restored.attachments[2], external);
await rebase.rebaseRestoredLegacyMedia(JSON.stringify(backupSettings));
db.prepare('UPDATE user_profile SET avatar = ?').run(sourceRoot + imagePath('userAvatar'));
db.prepare('UPDATE group_chats SET avatar = ?').run(sourceRoot + '../outside.png');
await assert.rejects(rebase.rebaseRestoredLegacyMedia(JSON.stringify(backupSettings)));
assert.ok(db.prepare('SELECT avatar FROM user_profile').get().avatar.startsWith(sourceRoot), '非法 owner 路径让整次重定位事务回滚');
assert.throws(() => settings.parseStableSettingsBackupJson(JSON.stringify({ ...backupSettings, legacyMediaRootUri: 'file:///old/../persistent-media/' })));
db.close();
console.log('媒体备份持有、聊天/头像草稿释放与跨安装根恢复重定位验证通过。');
