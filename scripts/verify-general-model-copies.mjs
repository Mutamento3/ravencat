/** 通用模型的真实持久化、草稿复制、创建参数与独立性验证。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(file, dependencies = {}, cache = new Map()) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${name}.ts`), dependencies, cache);
    if (name.startsWith('@shared/')) return load(`src/shared/${name.slice(8)}.ts`, dependencies, cache);
    throw new Error(`${file} 缺少依赖 ${name}`);
  }, module, module.exports);
  cache.set(absolute, module.exports);
  return module.exports;
}

const database = new DatabaseSync(':memory:');
const { SCHEMAS } = load('src/platform/persistence/sqlite/schema.ts');
database.exec(SCHEMAS.auxiliaryModelConfigs + SCHEMAS.auxiliaryModelInitialDefaults);
const executor = {
  getFirstAsync: async (sql, params = []) => database.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql, params = []) => database.prepare(sql).all(...params),
  runAsync: async (sql, params = []) => database.prepare(sql).run(...params),
  withExclusiveTransactionAsync: async (work) => {
    database.exec('BEGIN');
    try { const result = await work(executor); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  },
};
const dependencies = {
  '@platform/persistence': { databaseCoordinator: { openTaskExecutor: () => executor } },
  '@features/speech': { validateSpeechConfiguration: () => ({}) },
  '@features/integrations': { validateTranslationModelConfig: () => ({}) },
  '../application/AuxiliaryModelInitialization': { getAuxiliaryModelInitialization: () => ({
    initializeModelSelections: () => { throw new Error('通用模型不得初始化业务选择'); },
    invalidateModelReferencesInTransaction: async () => {},
  }) },
};
const repository = load('src/features/assistants/infrastructure/SQLiteAuxiliaryModelRepository.ts', dependencies).auxiliaryModelRepository;
const commands = load('src/features/assistants/ManageAuxiliaryModelConfigs.ts', {
  './infrastructure/SQLiteAuxiliaryModelRepository': { auxiliaryModelRepository: repository },
  './AuxiliaryModelsChanged': { emitAuxiliaryModelsChanged() {} },
});
const resolver = load('src/features/assistants/ResolveAuxiliaryModel.ts', {
  ...dependencies, './infrastructure/SQLiteAuxiliaryModelRepository': { auxiliaryModelRepository: repository },
});
const copies = load('src/features/assistants/GeneralModelCopies.ts', { './ResolveAuxiliaryModel': resolver });
const numbers = load('src/shared/ui/draftValidation.ts');
const { AutoSaveDraftEditor } = load('src/shared/ui/AutoSaveDraftEditor.ts');
const auxiliaryDraft = load('src/features/assistants/presentation/auxiliaryModels/auxiliaryModelDraft.ts', {
  '@shared/ui/draftValidation': numbers,
  '@shared/prompt': { ...load('src/shared/prompt/auxiliaryPromptMetadata.ts'), getDefaultAuxiliaryTaskPrompt: () => '内置任务说明' },
});
const modelDraft = load('src/features/assistants/presentation/management/AIModelSettings/modelSettingsHelpers.ts', { '@shared/ui/draftValidation': numbers });
const source = {
  apiBaseUrl: 'https://example.invalid/v1', apiKey: 'key', model: 'chat',
  temperature: 0, topP: null, maxTokens: null,
};
try {
  // 用户当前草稿可独立复制，数字边界复用原表单，不要求提交原配置。
  const sourceWrites = [];
  const sourceEditor = new AutoSaveDraftEditor(modelDraft.getModelSettingsDraft({ ...source, enableTools: true, disableThinking: true }),
    modelDraft.parseModelSettingsDraft, async (patch) => { sourceWrites.push(patch); });
  sourceEditor.change({ apiKey: 'new-key', tempInput: '1.2' });
  const current = sourceEditor.validateAll();
  const snapshot = { apiBaseUrl: current.apiBaseUrl, apiKey: current.apiKey, model: current.model,
    temperature: current.temperature, topP: current.topP, maxTokens: current.maxTokens };
  const asset = await commands.createAuxiliaryModelConfig(copies.buildGeneralModelCopy('独立配置', { ...snapshot, name: '角色', systemPrompt: '私有人设', enableTools: true }));
  assert.deepEqual(sourceWrites, []);
  await sourceEditor.restore();
  assert.equal(asset.name, '独立配置');
  assert.equal(asset.metadataJson, null);
  assert.deepEqual(await copies.getGeneralModelCopy(asset.id), snapshot);
  assert.equal((await commands.listAuxiliaryModelConfigs({ capabilityKind: 'general' }))[0].id, asset.id);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM auxiliary_model_initial_defaults').get().count, 0);

  // 通用资产的增量编辑与其他资产共用表单，保留空值和显式零。
  const draft = auxiliaryDraft.getAuxiliaryModelDraft('general', asset);
  assert.equal(draft.topPInput, '');
  assert.equal(draft.maxTokens, '');
  const parsed = auxiliaryDraft.parseAuxiliaryModelDraft('general', { ...draft, tempInput: '0', topPInput: '0', maxTokens: '' }, ['tempInput', 'topPInput', 'maxTokens']);
  assert.deepEqual(parsed.patch, { temperature: 0, topP: 0, maxTokens: null });
  assert.ok(auxiliaryDraft.parseAuxiliaryModelDraft('general', { ...draft, topPInput: '2' }, ['topPInput']).errors.topPInput);

  // 修改、停用和删除通用资产都不改变已经复制出的值；失效资产不能新填入。
  const independent = await copies.getGeneralModelCopy(asset.id);
  await commands.updateAuxiliaryModelConfig({ id: asset.id, settings: { apiKey: 'changed', temperature: 0.8 } });
  assert.deepEqual(independent, snapshot);
  assert.equal((await copies.getGeneralModelCopy(asset.id)).apiKey, 'changed');
  independent.model = 'own-model';
  assert.equal((await repository.getModelConfigById(asset.id)).model, source.model);
  await commands.updateAuxiliaryModelConfig({ id: asset.id, settings: { enabled: false } });
  assert.deepEqual((await resolver.getAuxiliaryModelSelection({ modelConfigId: null, capabilityKind: 'general' })).models, []);
  await assert.rejects(copies.getGeneralModelCopy(asset.id), /不可用/);
  await commands.updateAuxiliaryModelConfig({ id: asset.id, settings: { enabled: true, apiKey: null } });
  await assert.rejects(copies.getGeneralModelCopy(asset.id), /不可用/);
  await commands.deleteAuxiliaryModelConfig({ id: asset.id });
  await assert.rejects(copies.getGeneralModelCopy(asset.id), /不可用/);
  assert.equal(independent.apiKey, snapshot.apiKey);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM auxiliary_model_initial_defaults').get().count, 0);

  // 使用真实创建表单 hook，确认填入只更新模型字段，创建命令收到同一份参数。
  const state = [];
  let stateIndex = 0;
  const react = {
    useState: (initial) => {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = value; }];
    },
    useMemo: (factory) => factory(), useCallback: (callback) => callback,
  };
  let created;
  const { default: formHook } = load('src/features/assistants/presentation/management/useAddAIFormState.ts', {
    react, '@shared/ui': { showAppDialog() {} },
    '@shared/prompt': load('src/shared/prompt/contextWindowLimits.ts'),
    '../../AIAssistantManagement': { createAIAssistant: async (profile) => { created = profile; } },
  });
  const render = () => { stateIndex = 0; return formHook({}); };
  render().setName('保留名称'); render().setSystemPrompt('保留人设');
  render().fillModelConfig(snapshot);
  assert.equal(render().name, '保留名称'); assert.equal(render().systemPrompt, '保留人设');
  await render().handleSave();
  for (const key of Object.keys(snapshot)) assert.equal(created[key], snapshot[key]);
  assert.equal(created.name, '保留名称'); assert.equal(created.systemPrompt, '保留人设');
  assert.equal(created.enableTools, false);

  // 管理员设置读当前合法草稿；非法数字仍走原有字段错误，不复制旧合法值。
  const adminDraft = load('src/features/chat/presentation/group/groupAdminSettingsDraft.ts', { '@shared/ui/draftValidation': numbers });
  const adminEditor = new AutoSaveDraftEditor(adminDraft.getGroupAdminSettingsDraft({ ...source, contextMessageCount: 20 }),
    adminDraft.parseGroupAdminSettingsDraft, async () => {});
  const { default: adminHook } = load('src/features/chat/presentation/group/useGroupAdminSettings.ts', {
    react, '@shared/ui/useAutoSaveDraft': {
      useAutoSaveDraft: () => ({ ...adminEditor.getSnapshot(), change: adminEditor.change, flush: adminEditor.flush,
        restore: adminEditor.restore, getSnapshot: adminEditor.getSnapshot, validateAll: adminEditor.validateAll }),
      useAutoSaveNavigation: () => ({}),
    },
    '@shared/ui/useAutoSaveFeedback': { useAutoSaveFeedback: () => ({ revealErrors() {} }) },
    '@shared/ui/draftValidation': numbers, '@features/assistants': {},
  });
  adminEditor.change({ apiKey: 'admin-draft', topPInput: '0' });
  assert.deepEqual(adminHook({}).readModelConfig(), { ...source, apiKey: 'admin-draft', topP: 0 });
  adminEditor.change({ maxTokens: '-1' });
  assert.equal(adminHook({}).readModelConfig(), null);
  assert.ok(adminEditor.getSnapshot().errors.maxTokens);
  await adminEditor.restore();

  // 通用文本连接测试直接使用当前模型参数，不退回嵌入请求。
  let connection;
  const tester = load('src/features/assistants/TestAuxiliaryModelConnection.ts', {
    '@platform/ai': {
      testAPIConnection: async (...args) => { connection = args; return { success: true, error: null }; },
      createAIClient: () => { throw new Error('通用配置不能使用 embedding 测试'); }, getErrorDisplayInfo() {},
    },
  });
  assert.equal((await tester.testAuxiliaryModelConnection({ baseUrl: snapshot.apiBaseUrl, ...snapshot })).success, true);
  assert.deepEqual(connection, [snapshot.apiBaseUrl, snapshot.apiKey, snapshot.model, { temperature: snapshot.temperature }]);

  // 名称弹窗不带角色资料，且会固定打开时的草稿。
  state.length = 0;
  const ui = { Button: 'Button', InputField: 'Input', ModalSheet: 'Modal', showAppDialog() {} };
  const theme = { spacing: { lg: 16, md: 12, sm: 8 }, colors: { surface: { default: '#fff' }, text: { secondary: '#666' }, feedback: { error: '#e00' } } };
  react.default = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
  const { default: CopyButton } = load('src/features/assistants/presentation/auxiliaryModels/CopyToGeneralModel.tsx', {
    react, 'react-native': { View: 'View', Text: 'Text' }, '@shared/ui': ui, '@shared/theme': { useTheme: () => theme },
    '../../ManageAuxiliaryModelConfigs': commands, '../../GeneralModelCopies': copies,
  });
  function nodes(value, result = []) {
    if (Array.isArray(value)) value.forEach((child) => nodes(child, result));
    else if (value && typeof value === 'object') { result.push(value); nodes(value.children, result); }
    return result;
  }
  const renderCopy = () => { stateIndex = 0; return CopyButton({ readConfig: () => ({ ...snapshot }) }); };
  nodes(renderCopy()).find((node) => node.props.title === '加入通用辅助模型').props.onPress();
  nodes(renderCopy()).find((node) => node.type === 'Input').props.onChangeText('UI副本');
  nodes(renderCopy()).find((node) => node.props.title === '创建副本').props.onPress();
  for (let index = 0; index < 30; index++) await Promise.resolve();
  const [uiAsset] = await commands.listAuxiliaryModelConfigs({ capabilityKind: 'general' });
  assert.equal(uiAsset.name, 'UI副本');
  assert.deepEqual(await copies.getGeneralModelCopy(uiAsset.id), snapshot);

  // 列表与填入共用资产可用性，列表打开后被删除时不改写创建草稿。
  state.length = 0;
  let filled;
  const { default: Prefill } = load('src/features/assistants/presentation/auxiliaryModels/GeneralModelPrefill.tsx', {
    react, 'react-native': { Text: 'Text' }, '@shared/ui': { Button: 'Button', ModelPickerModal: 'Picker' },
    '@shared/theme': { useTheme: () => theme }, '../../ResolveAuxiliaryModel': resolver, '../../GeneralModelCopies': copies,
  });
  const renderPrefill = () => { stateIndex = 0; return Prefill({ onFill: (config) => { filled = config; } }); };
  const settle = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
  nodes(renderPrefill()).find((node) => node.type === 'Button').props.onPress(); await settle();
  assert.equal(nodes(renderPrefill()).find((node) => node.type === 'Picker').props.models[0].id, uiAsset.id);
  await commands.deleteAuxiliaryModelConfig({ id: uiAsset.id });
  nodes(renderPrefill()).find((node) => node.type === 'Picker').props.onSelect(uiAsset.id); await settle();
  assert.equal(filled, undefined);
  assert.ok(nodes(renderPrefill()).some((node) => node.props.accessibilityRole === 'alert'));

  // 管理员创建保持连接测试门槛，测试与创建使用复制后的同一组参数。
  state.length = 0;
  react.useRef = (value) => ({ current: value });
  react.default.useMemo = react.useMemo;
  react.default.useEffect = () => {};
  let groupInput; let testOptions;
  const { default: CreateGroup } = load('src/features/chat/presentation/group/CreateGroup.tsx', {
    react, 'react-native': { View: 'View', Text: 'Text', ScrollView: 'Scroll', KeyboardAvoidingView: 'KeyboardView', TouchableOpacity: 'Touch', Keyboard: { dismiss() {} } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' }, '@expo/vector-icons': { Ionicons: 'Icon' },
    '@shared/ui/NavigationHeader': { default: 'Header' }, '@shared/ui': { ...ui, AIAvatar: 'Avatar', GroupAvatar: 'GroupAvatar', ModelPickerModal: 'Picker' },
    '@shared/ui/commonStyles': { createCommonStyles: () => ({}) }, '@shared/theme': { useTheme: () => theme, useThemedStyles: () => ({}) },
    './CreateGroup.styles': {}, '../../group/application': { createGroupChat: async (input) => { groupInput = input; return { group: { avatar: null } }; } },
    '@features/assistants': { GeneralModelPrefill: 'Prefill', getAssistantDisplayName: (ai) => ai.name,
      fetchModelsWithConfig: async () => ({ models: [] }),
      runConnectionTestByConfig: async (input) => { testOptions = input.requestOptions; return { success: true }; } },
    '@platform/device/DeviceMediaService': { PERSISTENT_IMAGE_CATEGORY: {}, usePersistentAvatarDraft: () => ({
      commitAvatar: (work) => work(null, null),
    }) },
  });
  const renderGroup = () => { stateIndex = 0; return CreateGroup({ aiList: [] }); };
  nodes(renderGroup()).find((node) => node.type === 'Input' && node.props.label === '群聊名称').props.onChangeText('保留群名');
  nodes(renderGroup()).find((node) => node.type === 'Prefill').props.onFill(snapshot);
  const saveGroup = () => nodes(renderGroup()).find((node) => node.type === 'Header').props.rightButton.props.onPress();
  await saveGroup(); assert.equal(groupInput, undefined, '填入不跳过连接测试');
  await nodes(renderGroup()).find((node) => node.props.title === '测试连接').props.onPress();
  assert.deepEqual(testOptions, { temperature: snapshot.temperature, topP: snapshot.topP, maxTokens: snapshot.maxTokens });
  await saveGroup();
  assert.equal(groupInput.name, '保留群名');
  assert.deepEqual(groupInput.admin, snapshot);
  console.log('通用模型：管理持久化、合法草稿副本、空值／零值、无默认初始化、可用性与角色／管理员创建参数隔离验证通过。');
} finally { database.close(); }
