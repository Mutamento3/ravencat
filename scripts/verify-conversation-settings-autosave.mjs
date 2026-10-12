/** 对话设置真实交互：字段自动保存、头像独立提交、错误草稿和离开拦截。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(file, dependencies = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `${file} 缺少依赖 ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const { AutoSaveDraftEditor } = load('src/shared/ui/AutoSaveDraftEditor.ts');
const chatSettingsDraft = load('src/features/chat/presentation/conversation/chatSettingsDraft.ts', {
  '@shared/ui/draftValidation': load('src/shared/ui/draftValidation.ts'),
});
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
  const persisted = { id: 'ai', name: '旧名称', systemPrompt: '原始人设', avatar: 'old.jpg', avatarMediaAssetId: 'old-asset', model: 'chat', updatedAt: 'old',
    privateContextPrimaryLimit: 30, privateContextSecondaryLimit: 10, groupContextPrimaryLimit: 40, groupContextSecondaryLimit: 5,
    allowMultipleBubbles: true, showTokenUsage: true };
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
    './chatSettingsDraft': chatSettingsDraft,
    '@shared/ui': { showAppDialog: ({ title, buttons }) => alerts.push({ title, buttons }) },
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
      useAutoSaveNavigation: (flush, back, blocked) => {
        const leave = async (action) => { if (await flush()) action(); else blocked(); };
        return {leave,back:()=>leave(back)};
      },
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
  const context = screen();
  assert.deepEqual(context.render().contextLimits, { privatePrimary: '30', privateSecondary: '10', groupPrimary: '40', groupSecondary: '5' });
  context.render().handleContextLimitChange('privatePrimary', '48');
  mock.timers.tick(999); await tick();
  assert.deepEqual(context.writes, []);
  mock.timers.tick(1); await tick();
  assert.deepEqual(context.writes, [{ privateContextPrimaryLimit: 48 }]);
  assert.equal(context.persisted.privateContextPrimaryLimit, 48);
  context.render().handleContextLimitChange('privateSecondary', '12');
  context.render().handleContextLimitChange('groupPrimary', '60');
  context.render().handleContextLimitChange('groupSecondary', '8');
  await context.render().flush();
  assert.deepEqual(context.writes.at(-1), { privateContextSecondaryLimit: 12, groupContextPrimaryLimit: 60, groupContextSecondaryLimit: 8 });
  context.render().setAllowMultipleBubbles(false); await tick();
  assert.deepEqual(context.writes.at(-1), { allowMultipleBubbles: false }, '开关立即提交且不覆盖模型配置');
  assert.equal(context.render().allowMultipleBubbles, false);
  assert.equal(chatSettingsDraft.getChatSettingsDraft(context.persisted).allowMultipleBubbles, false, '重新进入保留已保存的开关');
  context.render().setShowTokenUsage(false); await tick();
  assert.deepEqual(context.writes.at(-1), { showTokenUsage: false }, 'Token 开关立即保存且不覆盖模型或气泡设置');
  assert.equal(chatSettingsDraft.getChatSettingsDraft(context.persisted).showTokenUsage, false, '重新进入保留 Token 显示选择');

  // 主题冻结发生在设置 UI，不能把暂时禁用误写为用户的新选择。
  const tokenPage = screen();
  const variants = load('src/shared/theme/themeVariants.ts');
  let theme = { id: 'daylight', colors: { chat: { screen: '#fff' } } };
  const react = { createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}], useMemo: (factory) => factory() };
  const { default: Settings } = load('src/features/chat/presentation/conversation/ChatSettings.tsx', {
    react: { ...react, default: react },
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@shared/ui/NavigationHeader': { default: 'NavigationHeader' },
    '@shared/ui': { AIInfoCard: 'AIInfoCard', BackgroundPickerCard: 'BackgroundPickerCard', InputField: 'InputField', ToggleField: 'ToggleField' },
    '@shared/ui/AutoSaveErrors': { AutoSaveErrors: 'AutoSaveErrors' },
    './useChatSettings': { default: () => tokenPage.render() },
    './chatSettingsStyles': { createStyles: () => ({}) },
    '@shared/theme': { ...variants, useTheme: () => theme, useThemedStyles: () => ({}) },
    '@shared/ui/commonStyles': { createCommonStyles: () => ({}) },
    '../messages/components/ChatWallpaperSettings': { default: 'ChatWallpaperSettings' },
    './ContextWindowSection': { default: 'ContextWindowSection' },
    './FixedChatContextSection': { default: 'FixedChatContextSection' },
  });
  const findToggle = (node) => {
    if (node?.props?.label === '显示 Token 用量') return node;
    for (const child of node?.children ?? []) { const found = findToggle(child); if (found) return found; }
    return null;
  };
  const tokenToggle = () => findToggle(Settings({ aiAssistant: tokenPage.persisted, conversationId: 'direct-ai', onChooseFixedStart() {} }));
  assert.equal(tokenToggle().props.value, true, '支持主题默认显示 Token');
  tokenToggle().props.onValueChange(false); await tick();
  assert.equal(tokenToggle().props.value, false);
  tokenToggle().props.onValueChange(true); await tick();
  const writesBeforeFreeze = tokenPage.writes.length;
  for (const id of ['paper-note', 'moon-kimi']) {
    theme = { ...theme, id };
    assert.equal(tokenToggle().props.value, false, '冻结主题的开关始终显示关闭');
    assert.equal(tokenToggle().props.disabled, true, '冻结主题不允许操作开关');
    assert.equal(tokenPage.persisted.showTokenUsage, true, '切换主题不覆盖原来的用户选择');
  }
  assert.equal(tokenPage.writes.length, writesBeforeFreeze, '冻结主题不产生配置写入');
  theme = { ...theme, id: 'daylight' };
  assert.equal(tokenToggle().props.value, true, '切回支持主题恢复原选择');
  assert.equal(tokenToggle().props.disabled, false);
  for (const invalid of ['', '0', '1.5']) {
    context.render().handleContextLimitChange('privatePrimary', invalid);
    assert.equal(await context.render().flush(), false);
    assert.equal(context.render().contextLimits.privatePrimary, invalid);
    assert.ok(context.render().settingsErrors.privatePrimary);
  }
  context.render().setAllowMultipleBubbles(true); await tick();
  assert.deepEqual(context.writes.at(-1), { allowMultipleBubbles: true }, '无效上下文不阻止合法开关保存');
  await context.render().back(); assert.equal(context.returned(), 0, '无效上下文阻止返回');
  await context.render().restoreInfo();
  assert.equal(context.render().contextLimits.privatePrimary, '48', '恢复使用最后保存的条数');
  await context.render().back(); assert.equal(context.returned(), 1);

  const choosingFixedStart = screen();
  let openedMessages = 0;
  choosingFixedStart.render().handleContextLimitChange('privatePrimary','0');
  await choosingFixedStart.render().leave(()=>openedMessages++);
  assert.equal(openedMessages,0,'去设置固定起点也需处理无效草稿');
  await choosingFixedStart.render().restoreInfo();
  choosingFixedStart.render().handleContextLimitChange('privatePrimary','47');
  await choosingFixedStart.render().leave(()=>openedMessages++);
  assert.equal(openedMessages,1);
  assert.equal(choosingFixedStart.persisted.privateContextPrimaryLimit,47,'跳转消息列表前保存近期参数');

  const contextFailure = screen(); contextFailure.failInfo(true);
  contextFailure.render().handleContextLimitChange('privatePrimary', '50');
  await contextFailure.render().back();
  assert.equal(contextFailure.returned(), 0);
  assert.equal(contextFailure.render().contextLimits.privatePrimary, '50');
  assert.ok(contextFailure.render().infoSaveError);
  contextFailure.failInfo(false); await contextFailure.render().flush();
  assert.equal(contextFailure.persisted.privateContextPrimaryLimit, 50);

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
console.log('对话设置：上下文与气泡迁移、名称与人设自动保存、字段独立提交、错误保留与返回等待验证通过。');
