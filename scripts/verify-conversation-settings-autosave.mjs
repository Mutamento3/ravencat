/** 对话设置真实交互：名称与人设自动保存、头像独立提交、错误草稿和离开拦截。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(file, dependencies = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `${file} 缺少依赖 ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const { AutoSaveDraftEditor } = load('src/shared/ui/AutoSaveDraftEditor.ts');
const tick = async () => { for (let count = 0; count < 30; count++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function screen() {
  const state = []; let cursor = 0; let editor; let latestSave; let avatarFailure = false; let avatarWork; let infoFailure = false;
  const writes = []; const updates = []; const alerts = []; let returned = 0;
  const backgrounds = new Map([['ai', 'file:///ai-background.jpg'], ['other-ai', 'file:///other-background.jpg']]);
  const backgroundReads = []; const backgroundWrites = [];
  let cancelBackground = false;
  const imagePicker = {
    requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
    launchImageLibraryAsync: async (options) => {
      assert.equal(options.allowsEditing, true, '更换通话背景先进入裁剪');
      assert.deepEqual(options.aspect, [1080, 2400]);
      return cancelBackground ? { canceled: true, assets: null }
        : { canceled: false, assets: [{ uri: 'file:///cropped-background.jpg', width: 1080 }] };
    },
  };
  const cropping = load('src/platform/device/pickCroppedImage.ts', {
    'react-native': { Dimensions: { get: () => ({ width: 360, height: 800, scale: 3 }) } },
    'expo-image-picker': imagePicker,
  });
  const persisted = { id: 'ai', name: '旧名称', systemPrompt: '原始人设', avatar: 'old.jpg', avatarMediaAssetId: 'old-asset', model: 'chat', updatedAt: 'old' };
  let uri = persisted.avatar; let draft = null; let committedUri = uri;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
    useCallback: (callback) => callback, useMemo: (factory) => factory(),
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = state[index];
      if (previous && dependencies.every((value, position) => Object.is(value, previous.dependencies[position]))) return;
      previous?.cleanup?.();
      state[index] = { dependencies, cleanup: effect() };
    },
  };
  const { default: renderHook } = load('src/features/chat/presentation/conversation/useChatSettings.ts', {
    react,
    'react-native': { Alert: { alert: (title, _message, buttons) => alerts.push({ title, buttons }) } },
    'expo-image-picker': imagePicker,
    '@features/calls': {
      loadCallBackgroundUri: async (id) => { backgroundReads.push(id); return backgrounds.get(id) ?? null; },
      setCustomCallBackground: async (input) => { backgroundWrites.push(input); backgrounds.set(input.assistantId, input.sourceUri); return input.sourceUri; },
      clearCallBackground: async (id) => { backgroundWrites.push({ clearedAssistantId: id }); backgrounds.delete(id); },
    },
    '@features/assistants': {
      getAIAssistantById: async () => ({ ...persisted }),
      updateAIAssistantSettings: async (_id, patch) => { if (infoFailure) throw new Error('资料写入失败'); writes.push(patch); Object.assign(persisted, patch); return true; },
      updateAIAssistantAvatarFromDraft: async (...args) => {
        assert.equal(args.length, 2, '头像命令不得携带名称草稿');
        if (avatarWork) await avatarWork.promise;
        if (avatarFailure) throw new Error('头像写入失败');
        writes.push({ avatar: args[1].uri });
        Object.assign(persisted, { avatar: args[1].uri, avatarMediaAssetId: 'new-asset', updatedAt: 'new' });
        return { ...persisted };
      },
    },
    '@platform/device/DeviceMediaService': {
      ...cropping,
      PERSISTENT_IMAGE_CATEGORY: { aiAvatar: 'ai' },
      usePersistentAvatarDraft: () => ({
        avatarUri: uri, isPickingAvatar: false, isCommittingAvatar: false,
        pickAvatar: async () => { uri = 'new.jpg'; draft = { uri }; return { status: 'selected', uri }; },
        resetAvatar: async () => { uri = null; draft = null; return true; },
        discardAvatarDraft: async () => { uri = committedUri; draft = null; },
        commitAvatar: async (save, project) => {
          const result = await save(uri, draft);
          uri = project(result); committedUri = uri; draft = null;
          return result;
        },
      }),
    },
    '@shared/ui/useAutoSaveDraft': {
      useAutoSaveDraft: (options) => {
        latestSave = options.save;
        if (!editor) editor = new AutoSaveDraftEditor(options.initial, options.parse, (patch) => latestSave(patch));
        else editor.rebase(options.initial);
        return { ...editor.getSnapshot(), change: editor.change, flush: editor.flush, restore: editor.restore };
      },
      useAutoSaveNavigation: (flush, back, blocked) => ({ back: async () => { if (await flush()) back(); else blocked(); } }),
    },
  });
  const render = () => {
    cursor = 0;
    return renderHook({ aiAssistant: { ...persisted }, onUpdated: (patch) => updates.push(patch), onBack: () => { returned++; } });
  };
  const chooseAvatar = async () => {
    render().handleAvatarPress();
    alerts.at(-1).buttons.find((button) => button.text === '从相册选择').onPress();
    await tick();
  };
  return { render, chooseAvatar, writes, updates, alerts, persisted, backgrounds, backgroundReads, backgroundWrites,
    cancelBackground: () => { cancelBackground = true; },
    failAvatar: (value) => { avatarFailure = value; },
    failInfo: (value) => { infoFailure = value; },
    delayAvatar: () => { avatarWork = deferred(); return avatarWork; },
    returned: () => returned,
  };
}

mock.timers.enable({ apis: ['setTimeout'] });
try {
  const roleBackground = screen();
  roleBackground.render(); await tick();
  assert.deepEqual(roleBackground.backgroundReads, ['ai']);
  assert.equal(roleBackground.render().callBackgroundUri, 'file:///ai-background.jpg');
  await roleBackground.render().handlePickCallBackground();
  assert.equal(roleBackground.backgroundWrites.at(-1).assistantId, 'ai', '选图绑定设置页中的角色');
  assert.equal(roleBackground.backgroundWrites.at(-1).sourceUri, 'file:///cropped-background.jpg', '保存裁剪后的图片');
  assert.equal(roleBackground.backgroundWrites.at(-1).sourceWidth, 1080, '压缩使用裁剪后的宽度');
  roleBackground.cancelBackground();
  await roleBackground.render().handlePickCallBackground();
  assert.equal(roleBackground.backgroundWrites.length, 1, '取消裁剪不写入、不替换现有通话背景');
  assert.equal(roleBackground.backgrounds.get('other-ai'), 'file:///other-background.jpg');
  roleBackground.persisted.id = 'other-ai';
  roleBackground.render(); await tick();
  assert.deepEqual(roleBackground.backgroundReads, ['ai', 'other-ai'], '切换角色后重新读取该角色背景');
  assert.equal(roleBackground.render().callBackgroundUri, 'file:///other-background.jpg');
  roleBackground.render().handleClearCallBackground();
  await roleBackground.alerts.at(-1).buttons.find((button) => button.text === '恢复默认').onPress();
  assert.deepEqual(roleBackground.backgroundWrites.at(-1), { clearedAssistantId: 'other-ai' });
  assert.equal(roleBackground.backgrounds.get('ai'), 'file:///cropped-background.jpg', '清除只影响当前角色');

  const page = screen();
  page.render().setName(' 新名称 ');
  mock.timers.tick(999); await tick();
  assert.deepEqual(page.writes, []);
  mock.timers.tick(1); await tick();
  assert.deepEqual(page.writes, [{ name: '新名称' }]);
  assert.deepEqual(page.updates, [{ name: '新名称' }]);

  page.render().setSystemPrompt(' 新人设\n保持原始排版 ');
  mock.timers.tick(1000); await tick();
  assert.deepEqual(page.writes.at(-1), { systemPrompt: ' 新人设\n保持原始排版 ' });
  assert.equal(page.persisted.systemPrompt, ' 新人设\n保持原始排版 ', '提示词消费者读取助手持久化的人设');
  assert.deepEqual(page.updates.at(-1), { systemPrompt: ' 新人设\n保持原始排版 ' });
  page.render().setSystemPrompt(''); await page.render().flush();
  assert.equal(page.persisted.systemPrompt, '', '允许清除人设');

  page.render().setName(''); mock.timers.tick(1000); await tick();
  assert.ok(page.render().nameError);
  page.render().setSystemPrompt('空名称不阻止人设保存');
  await page.render().flush();
  assert.equal(page.persisted.systemPrompt, '空名称不阻止人设保存');
  await page.chooseAvatar();
  assert.deepEqual(page.writes.at(-1), { avatar: 'new.jpg' });
  assert.equal(page.render().name, '', '头像确认不得覆盖名称草稿');
  assert.deepEqual(page.updates.at(-1), { avatar: 'new.jpg', avatarMediaAssetId: 'new-asset', updatedAt: 'new' });
  await page.render().back(); assert.equal(page.returned(), 0);
  await page.render().restoreInfo(); await page.render().back(); assert.equal(page.returned(), 1);
  assert.ok(page.alerts.every(({ title }) => title !== '成功'), '正常自动保存不弹成功提示');

  const personaFailure = screen(); personaFailure.failInfo(true);
  personaFailure.render().setSystemPrompt('未保存的人设');
  await personaFailure.render().back();
  assert.equal(personaFailure.returned(), 0);
  assert.equal(personaFailure.render().systemPrompt, '未保存的人设');
  assert.ok(personaFailure.render().infoSaveError);
  assert.equal(personaFailure.persisted.systemPrompt, '原始人设');
  personaFailure.failInfo(false); await personaFailure.render().flush();
  assert.equal(personaFailure.persisted.systemPrompt, '未保存的人设');
  personaFailure.render().setSystemPrompt('待恢复的人设'); await personaFailure.render().restoreInfo();
  assert.equal(personaFailure.render().systemPrompt, '未保存的人设');

  const failed = screen(); failed.failAvatar(true);
  await failed.chooseAvatar();
  assert.equal(failed.render().avatarUrl, 'new.jpg');
  assert.ok(failed.render().avatarError);
  await failed.render().back(); assert.equal(failed.returned(), 0);
  failed.failAvatar(false); failed.render().retryAvatar(); await tick();
  assert.equal(failed.render().avatarError, null);
  await failed.render().back(); assert.equal(failed.returned(), 1);

  const restored = screen(); restored.failAvatar(true); await restored.chooseAvatar();
  await restored.render().restoreAvatar();
  assert.equal(restored.render().avatarUrl, 'old.jpg');
  assert.equal(restored.render().avatarError, null);
  await restored.render().back(); assert.equal(restored.returned(), 1);

  const pending = screen(); const work = pending.delayAvatar(); await pending.chooseAvatar();
  pending.render().setName('头像保存期间的新名称');
  mock.timers.tick(1000); await tick();
  let left = false; const leaving = pending.render().back().then(() => { left = true; });
  await tick(); assert.equal(left, false, '返回必须等待已开始的头像提交');
  work.resolve(); await leaving; assert.equal(pending.returned(), 1);
  assert.equal(pending.render().name, '头像保存期间的新名称');
  assert.equal(Object.hasOwn(pending.updates.at(-1), 'name'), false, '头像回调只确认头像字段');

  const reset = screen(); reset.render().handleAvatarPress();
  reset.alerts.at(-1).buttons.find((button) => button.text === '恢复默认').onPress();
  reset.alerts.at(-1).buttons.find((button) => button.text === '恢复默认').onPress();
  await tick();
  assert.deepEqual(reset.writes, [{ avatar: null, avatarMediaAssetId: null }]);
  assert.equal(reset.persisted.name, '旧名称');
} finally { mock.timers.reset(); }
console.log('对话设置：名称与人设自动保存、字段独立提交、错误保留与返回等待验证通过。');
