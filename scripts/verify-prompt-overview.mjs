import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { StackRouter, StackActions, CommonActions } from '@react-navigation/routers';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(relative, mocks = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: relative,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    throw new Error(`${relative} 未提供依赖 ${id}`);
  }, module, module.exports);
  return module.exports;
}

const estimator = load('src/shared/prompt/estimateTextTokens.ts');
const budget = load('src/host/prompt/tokenBudget.ts', { '@shared/prompt': estimator });
const metadata = load('src/host/prompt/compiler/promptBlockMetadata.ts');
const { PromptPackCompiler } = load('src/host/prompt/compiler/PromptPackCompiler.ts', { '../tokenBudget': budget, './promptBlockMetadata': metadata });
const { getSystemPromptPreset } = load('src/host/prompt/compiler/systemPromptPresets.ts');
const preset = getSystemPromptPreset('chat.private_reply');
const draft = (key, content) => ({ key, title: content, content, required: false, status: 'ready', placement: 'system' });
const history = [{ role: 'user', content: '2020 年的历史' }, { role: 'assistant', content: '过去的回复' }];
const currentInput = { role: 'user', content: '今天呢？' };
const blocks = [draft('time_awareness', '现在是 2026 年'), draft('passive_memory', '记忆资料'), draft('moments_social_inbox', '未读社交'), draft('together_listening_runtime', '正在一起听'),
  draft('conversation_summary', '聊天摘要'), draft('tools_description', '工具能力'), draft('tool_context_explanation', '运行上下文'),
  draft('agent_registry_summary', '身份池'), draft('protocol_space', '协议资料'), draft('persona', 'AI 人设'), draft('foundation_default_core', '基础规则'),
  { ...draft('persona', '第二条自定义'), definitionId: 'assistant-user:two', slot: 'user_rules', protection: 'editable' },
  { ...draft('persona', '第三条自定义'), definitionId: 'assistant-user:three', slot: 'user_rules', protection: 'editable' },
  { ...draft('current_input', currentInput.content), required: true, placement: 'input' }];
const pack = new PromptPackCompiler().compile({ scenario: 'chat.private_reply', blocks, recentMessages: history, currentInput, preset });
// 身份池与工具运行上下文是本轮状态，保留在历史后的 system 中，不污染稳定前缀。
assert.equal(pack.systemPrompt, '基础规则\n\nAI 人设\n\n协议资料\n\n第二条自定义\n\n第三条自定义\n\n工具能力\n\n聊天摘要');
assert.deepEqual(pack.modelMessages, [...history, { role: 'system', content: '身份池\n\n运行上下文\n\n正在一起听\n\n未读社交\n\n记忆资料\n\n现在是 2026 年' }, currentInput]);
assert.equal(pack.modelMessages.filter((message) => message.content === '现在是 2026 年').length, 0);
assert.ok(!pack.systemPrompt.includes('2026'));
const disabledTime = new PromptPackCompiler().compile({ scenario: 'chat.private_reply', blocks, recentMessages: history, currentInput,
  preset: { ...preset, items: preset.items.map((item) => item.definitionId === 'context.time_awareness' ? { ...item, enabled: false } : item) } });
assert.ok(!disabledTime.dynamicSystemPrompt.includes('2026'));
assert.deepEqual(disabledTime.recentMessages, history);

const { applyRuntimeModelInput } = load('src/features/chat/reply/application/ChatReplyUtils.ts');
const batched = [{ role: 'user', content: '第一条' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }];
const request = applyRuntimeModelInput(pack.modelMessages, undefined, batched);
assert.deepEqual(request.slice(0, -2), pack.modelMessages.slice(0, -1));
assert.deepEqual(request.slice(-2), batched);
const { buildAgentModelMessages } = load('src/platform/agentRuntime/BaseAIClientAgentModelGateway.ts', {
  '@platform/ai': {}, '@shared/diagnostics/TurnTimelineLog': {},
});
const continuation = buildAgentModelMessages(request, [{ role: 'tool', toolCallId: 'call-1', name: 'lookup', content: '结果' }]);
assert.deepEqual(continuation.slice(0, request.length), request);
assert.equal(continuation.at(-1).role, 'tool');

// 用真实编译器、拆包 owner 与请求网关验证：特批说明位于摘要前，续轮不改变缓存前缀。
const { AgentToolRegistry } = load('src/platform/agentRuntime/AgentToolRegistry.ts');
const { registerToolPackagesForHostRun } = load('src/host/composition/agent/ToolPackageExposure.ts');
const toolRegistry = new AgentToolRegistry();
const bindings = ['read_memory', 'remember_memory'].map((name) => {
  const tool = { descriptor: { name, description: `说明 ${name}`, inputSchema: { type: 'object', properties: {} } } };
  toolRegistry.register(tool);
  return { packageId: 'memory', tool };
});
const exposure = registerToolPackagesForHostRun({ registry: toolRegistry, bindings,
  allowedToolNames: ['read_memory', 'remember_memory'], openPackageIds: [], directToolNames: ['read_memory'] });
const modelRequests = [];
const { BaseAIClientAgentModelGateway } = load('src/platform/agentRuntime/BaseAIClientAgentModelGateway.ts', {
  '@platform/ai': { AgentModelGateway: class {
    async complete(request) {
      modelRequests.push(request);
      return { assistantText: '完成', reasoningText: '', toolCalls: [], historyItems: [], finishReason: 'stop' };
    }
  } },
  '@shared/diagnostics/TurnTimelineLog': { logTurnTimeline() {} },
});
const modelGateway = new BaseAIClientAgentModelGateway({ client: {}, initialMessages: pack.modelMessages,
  toolInstructionsSlot: pack.toolInstructionsSlot, diagnosticContext: {} });
const requestWithExposure = () => ({ transport: 'complete', history: [],
  tools: toolRegistry.listAllowed([...exposure.visibleToolNames(), ...exposure.metaToolNames]), toolInstructions: exposure.instructions() });
await modelGateway.runTurn(requestWithExposure());
await toolRegistry.get('open_tool_package').execute({ package_id: 'memory' });
await modelGateway.runTurn({ ...requestWithExposure(), history: [{ role: 'tool', toolCallId: 'open-1', name: 'open_tool_package', content: '展开成功' }] });
const modelPrefix = modelRequests[0].messages[0].content;
assert.ok(modelPrefix.indexOf('【用户特批工具】') < modelPrefix.indexOf('聊天摘要'));
assert.equal(modelPrefix.split('"name":"read_memory"').length - 1, 1);
assert.equal(modelRequests[1].messages[0].content, modelPrefix, '工具续轮保持稳定前置 system');
assert.equal(modelRequests[0].includeSystemPrompt, false, '请求不能重复注入旧 system');
assert.deepEqual(new Set(modelRequests[0].tools.map((tool) => tool.function.name)), new Set(['read_memory', 'open_tool_package']));
assert.equal(modelRequests[1].tools.length, 3);
assert.deepEqual(modelRequests[1].messages.slice(1, 3), history, '历史继续保持真实消息角色');

// 默认配置与旧 AI 覆盖共同解析，语言不再受旧英文设置影响。
const defaults = { overrides: { 'foundation.default_core': '全局规则' }, userPrompts: [{ id: 'g1', name: '全局', content: '全局常驻', enabled: true, sortOrder: 1 }], toolPermissions: {}, timeEnabled: false };
const { resolveAssistantPromptConfiguration } = load('src/features/prompting/application/ManageAssistantPrompts.ts', {
  './PromptingRuntimeDependencies': { getPromptingRuntimeDependencies: () => ({
    defaults: { read: async () => defaults }, assistantPrompts: {
      listDefinitionStates: async (id) => id === 'ai-1' ? [{ definitionId: 'context.time_awareness', enabled: false }] : [],
      listDefinitionOverrides: async () => [{ definitionId: 'foundation.default_core', locale: 'zh-CN', content: '专属规则' }, { definitionId: 'foundation.default_core', locale: 'en-US', content: 'old English' }],
      listAssistantUserPrompts: async () => [{ id: 'a1', name: '专属', condition: 'always', content: '专属常驻', enabled: true, sortOrder: 2 }],
    },
  }) },
});
const resolved = await resolveAssistantPromptConfiguration({ assistantId: 'ai-1', scenarioId: 'chat.private_reply' });
// 内置 Prompt 固定中文后不再有 resolved.locale；历史 en-US 覆盖行不生效。
assert.equal(resolved.overrides['foundation.default_core'], '专属规则');
assert.equal(resolved.timeEnabled, false);
assert.equal((await resolveAssistantPromptConfiguration({ assistantId: 'ai-2', scenarioId: 'chat.private_reply' })).timeEnabled, true, '一位 AI 关闭时间不影响其他 AI，旧全局开关不再消费');
assert.deepEqual(resolved.userPrompts.map((item) => item.content), ['全局常驻', '专属常驻']);

// 使用真实 SQLite 检查默认配置保存、单项重置和原子排序，不改动用户数据库。
const database = new DatabaseSync(':memory:');
database.exec('CREATE TABLE ai_assistants (id TEXT PRIMARY KEY); CREATE TABLE group_chats (id TEXT PRIMARY KEY);');
database.exec(load('src/platform/persistence/sqlite/promptingSchema.ts').PROMPTING_SCHEMA);
const executor = {
  getAllAsync: async (sql, parameters = []) => database.prepare(sql).all(...parameters),
  getFirstAsync: async (sql, parameters = []) => database.prepare(sql).get(...parameters) ?? null,
  runAsync: async (sql, parameters = []) => database.prepare(sql).run(...parameters),
  async withExclusiveTransactionAsync(action) {
    database.exec('BEGIN');
    try { const result = await action(executor); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  },
};
const { sqlitePromptDefaultsRepository: repository } = load('src/features/prompting/infrastructure/SQLitePromptDefaultsRepository.ts', {
  '@platform/persistence': { databaseCoordinator: { openTaskExecutor: () => executor } },
});
assert.deepEqual(await repository.read(), { overrides: {}, userPrompts: [], toolPermissions: {} });
const first = { id: 'p1', name: '第一条', content: '规则一', enabled: true, sortOrder: 10 };
const second = { id: 'p2', name: '第二条', content: '规则二', enabled: true, sortOrder: 20 };
await repository.saveUserPrompt(first); await repository.saveUserPrompt(second);
await repository.saveOverride('foundation.default_core', '新规则');
await repository.setEnabled('time', false); await repository.setEnabled('tool:open_app', false);
await repository.reorderUserPrompts(first, second);
let stored = await repository.read();
assert.deepEqual(stored.userPrompts.map((item) => item.id), ['p2', 'p1']);
assert.ok(!Object.hasOwn(stored, 'timeEnabled')); assert.equal(stored.toolPermissions.open_app, false);
database.exec("CREATE TRIGGER reject_second BEFORE UPDATE ON prompt_default_user_prompts WHEN OLD.id = 'p1' BEGIN SELECT RAISE(ABORT, '拒绝第二次更新'); END;");
await assert.rejects(repository.reorderUserPrompts(stored.userPrompts[0], stored.userPrompts[1]), /拒绝第二次更新/);
assert.deepEqual((await repository.read()).userPrompts, stored.userPrompts, '交换失败必须整体回滚');
database.exec('DROP TRIGGER reject_second');
await repository.resetOverride('foundation.default_core'); await repository.deleteUserPrompt('p1');
stored = await repository.read();
assert.deepEqual(stored.overrides, {}); assert.equal(stored.userPrompts.length, 1);
// 真实持久化与 application：两个 AI 的正文、时间和自定义片段互不覆盖。
database.exec("INSERT INTO ai_assistants VALUES ('ai-1'), ('ai-2');");
const { sqlitePromptingRepository: assistantRepository } = load('src/features/prompting/infrastructure/SQLitePromptingRepository.ts', {
  '@platform/persistence': { databaseCoordinator: { openTaskExecutor: () => executor } },
});
const scopedManagement = load('src/features/prompting/application/ManageAssistantPrompts.ts', {
  './PromptingRuntimeDependencies': { getPromptingRuntimeDependencies: () => ({
    assistantPrompts: assistantRepository, defaults: repository,
    tools: { list: async () => [{ name: 'read_memory' }, { name: 'send_voice_message' }] },
    catalog: { getById: () => ({ protection: 'overridable', defaultContent: '默认规则' }) },
  }) },
});
await scopedManagement.saveAssistantDefinitionState({ assistantId: 'ai-1', definitionId: 'context.time_awareness', enabled: false });
await scopedManagement.saveAssistantDefinitionState({ assistantId: 'ai-1', definitionId: 'context.device_battery', enabled: false });
await scopedManagement.saveAssistantDefinitionOverride({ assistantId: 'ai-1', definitionId: 'foundation.default_core', locale: 'zh-CN', content: '只属于第一位 AI' });
const exclusive = await scopedManagement.createAssistantUserPrompt({ assistantId: 'ai-1', name: '专属片段', content: '只注入第一位', condition: 'always', enabled: true, sortOrder: 10 });
const one = await scopedManagement.resolveAssistantPromptConfiguration({ assistantId: 'ai-1', scenarioId: 'chat.private_reply' });
const two = await scopedManagement.resolveAssistantPromptConfiguration({ assistantId: 'ai-2', scenarioId: 'chat.private_reply' });
assert.equal(one.timeEnabled, false); assert.equal(two.timeEnabled, true);
assert.equal(one.batteryEnabled, false); assert.equal(two.batteryEnabled, true);
assert.equal(one.overrides['foundation.default_core'], '只属于第一位 AI');
assert.equal(two.overrides['foundation.default_core'], undefined);
assert.ok(one.userPrompts.some((prompt) => prompt.content === '只注入第一位'));
assert.ok(!two.userPrompts.some((prompt) => prompt.content === '只注入第一位'));
await scopedManagement.resetAssistantDefinitionOverride({ assistantId: 'ai-1', definitionId: 'foundation.default_core', locale: 'zh-CN' });
await scopedManagement.deleteAssistantUserPrompt(exclusive.id, 'ai-1');
assert.deepEqual(await assistantRepository.listDefinitionOverrides('ai-1'), []);
assert.equal((await assistantRepository.listDefinitionStates('ai-1'))[0].enabled, false);
assert.deepEqual(await assistantRepository.listDefinitionStates('ai-2'), []);

// 特批偏好独立于权限保存，重读、取消及角色删除都保持真实 SQLite 契约。
await scopedManagement.setAssistantDirectToolExposure('ai-1', 'read_memory', true);
await scopedManagement.setAssistantDirectToolExposure('ai-1', 'read_memory', true);
assert.deepEqual(await scopedManagement.listAssistantDirectToolNames('ai-1'), ['read_memory']);
assert.deepEqual(await scopedManagement.listAssistantDirectToolNames('ai-2'), []);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assistant_tool_permissions').get().count, 0, '点亮星标不写调用权限');
await assert.rejects(scopedManagement.setAssistantDirectToolExposure('ai-1', 'unknown_tool', true), /工具不存在/u);
await scopedManagement.setAssistantDirectToolExposure('ai-1', 'read_memory', false);
assert.deepEqual(await scopedManagement.listAssistantDirectToolNames('ai-1'), []);
await scopedManagement.setAssistantDirectToolExposure('ai-2', 'send_voice_message', true);
database.exec('PRAGMA foreign_keys = ON; DELETE FROM ai_assistants WHERE id = \'ai-2\';');
assert.deepEqual(await scopedManagement.listAssistantDirectToolNames('ai-2'), [], '角色删除同时清除特批配置');
database.close();

// 真实组件的用户操作：无 AI 概览、详情、编辑、重置、开关与宿主导航。
const React = require('react');
const renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const alerts = [];
const native = Object.fromEntries(['ActivityIndicator', 'ScrollView', 'Switch', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name]));
native.Alert = { alert: (...args) => alerts.push(args) };
native.PanResponder = { create: (handlers) => ({ panHandlers: {
  onMoveShouldSetResponderCapture: handlers.onMoveShouldSetPanResponderCapture,
  onResponderRelease: handlers.onPanResponderRelease,
  onResponderTerminate: handlers.onPanResponderTerminate,
} }) };
const customRows = load('src/features/prompting/presentation/CustomPromptRow.tsx', { 'react-native': native, '@shared/ui': { Toggle: 'Switch' } });
const fixture = { overrides: { 'foundation.default_core': '私密正文不会出现在首页' }, userPrompts: [], toolPermissions: {},
  tools: [{ name: 'read_memory', owner: 'memory', hostOnly: false, defaultEnabled: true, enabled: true, mutating: false, callOnly: false, description: '完整工具说明' },
    { name: 'schedule_self_wake', owner: 'companion', hostOnly: true, defaultEnabled: true, enabled: true, mutating: true, callOnly: false, description: '完整主理工具说明' }] };
const actions = [];
const ai = { id: 'ai-1', name: '测试 AI', persona: '原始人设', isHostAI: true };
const otherAI = { id: 'ai-2', name: '另一位 AI', persona: '另一份人设', isHostAI: false };
let assistantOptions = [];
let optionListError = false;
const aiReads = [];
const aiDetails = { overrides: [], userPrompts: [], tools: [], directToolNames: [], timeEnabled: true, batteryEnabled: true };
const otherDetails = { overrides: [], userPrompts: [], tools: [], directToolNames: [], timeEnabled: true, batteryEnabled: true };
const detailsFor = (id) => id === ai.id ? aiDetails : otherDetails;
let definitionSaveGate;
const Screen = load('src/features/prompting/presentation/PromptCenterScreen.tsx', {
  '@shared/ui': { Toggle: 'Switch', showAppDialog: ({ title, message, buttons }) => alerts.push([title, message, buttons]) },
  'react-native': native, 'lucide-react-native': { ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight', Star: 'Star' },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  '@shared/theme': { useTheme: () => ({ colors: { text: { tertiary: '#666' }, brand: { primary: '#f90' } } }), useThemedStyles: () => ({}) },
  '@shared/ui/NavigationHeader': { default: ({ title, onGoBack, rightButton }) => React.createElement('Header', { title, onGoBack }, rightButton), __esModule: true },
  '@shared/ui/ModalSheet': { default: ({ children, onClose }) => React.createElement('ModalSheet', { onClose }, children), __esModule: true },
  '../application/GetPromptCenterSnapshot': { getPromptCenterSnapshot: () => ({ definitions: [
    { id: 'foundation.default_core', defaultContent: '代码默认规则' }, { id: 'foundation.visual_grounding', defaultContent: '视觉默认规则' },
  ] }) },
  '../application/ManagePromptDefaults': {
    getDefaultPromptEditor: async () => ({ ...fixture }), getPromptAssistant: async (id) => { aiReads.push(['assistant', id]); return { ...(id === ai.id ? ai : otherAI) }; },
    setDefaultPromptSwitch: async (key, enabled) => { actions.push([key, enabled]); fixture.toolPermissions[key.slice(5)] = enabled; },
    saveDefaultDefinition: async (id, content) => { await definitionSaveGate; fixture.overrides[id] = content; }, resetDefaultDefinition: async (id) => { delete fixture.overrides[id]; },
    saveDefaultUserPrompt: async (prompt) => {
      fixture.userPrompts = [...fixture.userPrompts.filter((item) => item.id !== prompt.id), prompt].sort((left, right) => left.sortOrder - right.sortOrder);
    },
    deleteDefaultUserPrompt: async (id) => { fixture.userPrompts = fixture.userPrompts.filter((item) => item.id !== id); },
    moveDefaultUserPrompt: async (first, second) => {
      fixture.userPrompts = fixture.userPrompts.map((item) => item.id === first.id ? { ...item, sortOrder: second.sortOrder } : item.id === second.id ? { ...item, sortOrder: first.sortOrder } : item)
        .sort((left, right) => left.sortOrder - right.sortOrder);
    },
  },
  '../application/ManageAssistantPrompts': {
    getAssistantPromptEditorDetails: async (id) => { aiReads.push(['details', id]); return { ...detailsFor(id) }; },
    saveAssistantDefinitionState: async ({ assistantId, definitionId, enabled }) => {
      detailsFor(assistantId)[definitionId === 'context.device_battery' ? 'batteryEnabled' : 'timeEnabled'] = enabled;
    },
    saveAssistantDefinitionOverride: async (override) => { detailsFor(override.assistantId).overrides = [override]; },
    resetAssistantDefinitionOverride: async ({ assistantId }) => { detailsFor(assistantId).overrides = []; },
    createAssistantUserPrompt: async (prompt) => { detailsFor(prompt.assistantId).userPrompts.push({ ...prompt, id: `exclusive-${prompt.assistantId}` }); },
    setAssistantToolPermission: async (id, name, enabled) => { detailsFor(id).tools = [{ name, enabled }]; },
    setAssistantDirectToolExposure: async (id, name, exposed) => {
      const details = detailsFor(id);
      details.directToolNames = exposed ? [...details.directToolNames, name] : details.directToolNames.filter((item) => item !== name);
    },
  }, './CustomPromptRow': customRows, './promptCenterStyles': {},
}).default;
// 执行真实 App 入口和 Host 适配，使用原生 Stack 相同的 Router 处理 GO_BACK。
const routeContext = React.createContext(null);
const stackRouter = StackRouter({ initialRouteName: 'settings' });
let dispatch;
const expo = {
  useRouter: () => ({
    push: (href) => {
      const pathname = typeof href === 'string' ? href : href.pathname;
      const name = pathname.slice(1);
      const routeName = routeComponents.has(name) ? name : `${name}/index`;
      assert.ok(routeComponents.has(routeName), `未注册的目的页面：${pathname}`);
      dispatch(StackActions.push(routeName, typeof href === 'string' ? undefined : href.params));
    },
    back: () => dispatch(CommonActions.goBack()),
    setParams: (params) => dispatch(CommonActions.setParams(params)),
  }),
  useLocalSearchParams: () => React.useContext(routeContext).params,
  useFocusEffect: (callback) => {
    const { focused } = React.useContext(routeContext);
    React.useEffect(() => focused ? callback() : undefined, [callback, focused]);
  },
  Redirect: ({ href }) => React.createElement('Redirect', { href }),
};
const refreshContract = load('src/host/navigation/retainedRouteRefreshContract.ts');
const refreshHook = load('src/host/navigation/useRetainedRouteRefreshRevision.ts', { 'expo-router': expo, './retainedRouteRefreshContract': refreshContract });
const RouteContent = load('src/host/navigation/PromptCenterRouteContent.tsx', {
  'react-native': native, 'expo-router': expo, '@features/prompting': { PromptCenterScreen: Screen, listPromptAssistantOptions: async () => {
    if (optionListError) throw new Error('列表读取失败');
    return assistantOptions;
  } }, './useRetainedRouteRefreshRevision': refreshHook,
});
const routeComponents = new Map();
for (const file of fs.readdirSync(path.join(root, 'src/app/prompt-center'), { recursive: true })) {
  if (!file.endsWith('.tsx') || path.basename(file) === '_layout.tsx') continue;
  const relative = `src/app/prompt-center/${file.replaceAll('\\', '/')}`;
  const routeName = relative.slice('src/app/'.length, -4);
  routeComponents.set(routeName, load(relative, { 'expo-router': expo, '@host/navigation/PromptCenterRouteContent': RouteContent }).default);
}
for (const name of ['settings', 'mcp-tools/index', 'phone-tools/index', 'chat/[aiId]/protocol', 'profile']) {
  routeComponents.set(name, () => React.createElement('ExternalPage', { name }));
}
const stackConfig = { routeNames: [...routeComponents.keys()], routeParamList: {}, routeGetIdList: {} };
let stackState;
function App() {
  const [state, setState] = React.useState(() => stackRouter.getInitialState(stackConfig));
  stackState = state;
  dispatch = (action) => setState((previous) => stackRouter.getStateForAction(previous, action, stackConfig) ?? previous);
  return state.routes.map((route, index) => React.createElement('RouteSlot', { key: route.key, active: index === state.index },
    React.createElement(routeContext.Provider, { value: { params: route.params ?? {}, focused: index === state.index } },
      React.createElement(routeComponents.get(route.name)))));
}
let screen;
await renderer.act(async () => { screen = renderer.create(React.createElement(App)); });
await renderer.act(async () => expo.useRouter().push('/prompt-center'));
function activeScreen() { return screen.root.findAllByType('RouteSlot').find((node) => node.props.active); }
function text(node) { return typeof node === 'string' ? node : node.children.map(text).join(''); }
function button(label) { return activeScreen().findAllByType('TouchableOpacity').find((node) => node.findAllByType('Text').some((child) => text(child) === label)); }
function currentTitle() { return activeScreen().findByType('Header').props.title; }
async function systemBack() { await renderer.act(async () => dispatch(CommonActions.goBack())); }
assert.ok(!JSON.stringify(screen.toJSON()).includes('私密正文'));
assert.equal(activeScreen().findAllByType('TextInput').length, 0);
// 只断言入口是否可用，失败时不让 assert 展开整棵 React fiber 对象。
assert.ok(button('AI 人设') === undefined);
assert.ok(button('用户人设'), '用户人设不依赖 AI 身份，始终可进入个人资料');
assert.ok(button('协议空间常驻提示词') === undefined);
assert.ok(button('AI 身份池') === undefined);
assert.ok(text(activeScreen()).includes('AI 身份池'));
await renderer.act(async () => button('用户人设').props.onPress());
assert.equal(stackState.routes.at(-1).name, 'profile');
await systemBack();
assert.equal(currentTitle(), '提示词中心');
await renderer.act(async () => expo.useRouter().push('/prompt-center/persona'));
assert.equal(activeScreen().findByType('Redirect').props.href, '/prompt-center');
assert.equal(activeScreen().findAllByType('TextInput').length, 0);
assert.deepEqual(aiReads, [], '无 AI 的详情路由不能读取任何 AI 数据');
await systemBack();
assert.ok(activeScreen().findAllByType('Switch').every((item) => item.props.disabled));
assert.equal(button('编辑对象').props.disabled, true);
assert.ok(text(activeScreen()).includes('暂无 AI'));
await renderer.act(async () => button('系统基础规则').props.onPress());
assert.equal(activeScreen().findByType('TextInput').props.value, '私密正文不会出现在首页');
await renderer.act(async () => activeScreen().findByType('TextInput').props.onChangeText('修改后的全局规则'));
await renderer.act(async () => button('保存').props.onPress());
assert.equal(fixture.overrides['foundation.default_core'], '修改后的全局规则');
await renderer.act(async () => button('系统基础规则').props.onPress());
await renderer.act(async () => button('恢复默认').props.onPress());
await renderer.act(async () => alerts.at(-1)[2].find((item) => item.text === '恢复').onPress());
assert.equal(activeScreen().findByType('TextInput').props.value, '代码默认规则');
await renderer.act(async () => activeScreen().findByType('Header').props.onGoBack());
await renderer.act(async () => button('MCP').props.onPress());
assert.equal(stackState.routes.at(-1).name, 'mcp-tools/index');
await systemBack();
await renderer.act(async () => button('工具调用').props.onPress());
assert.equal(currentTitle(), '工具调用');
assert.equal(activeScreen().findByProps({ accessibilityLabel: '特批工具' }).props.accessibilityState.expanded, false, '列表默认折叠');
await renderer.act(async () => activeScreen().findByProps({ accessibilityLabel: '特批工具' }).props.onPress());
assert.ok(text(activeScreen()).includes('选择 AI 后可在工具包中配置特批工具。'));
await renderer.act(async () => activeScreen().findByProps({ accessibilityLabel: '特批工具' }).props.onPress());
await renderer.act(async () => button('主理 AI 专属').props.onPress());
assert.ok(text(activeScreen()).includes('完整主理工具说明'));
assert.equal(activeScreen().findByType('Switch').props.accessibilityLabel, '启用 schedule_self_wake');
assert.equal(activeScreen().findByType('Switch').props.disabled, true);
assert.equal(button('手机工具').props.disabled, true);
assert.ok(!text(activeScreen()).includes('parameters'));
await systemBack();
assert.equal(currentTitle(), '工具调用');
await systemBack();
assert.equal(currentTitle(), '提示词中心');
await renderer.act(async () => button('自定义提示词').props.onPress());
for (const [name, content] of [['第一条', '第一条正文'], ['第二条', '第二条正文']]) {
  await renderer.act(async () => button('添加').props.onPress());
  await renderer.act(async () => {
    activeScreen().findAllByType('TextInput')[0].props.onChangeText(name);
    activeScreen().findAllByType('TextInput')[1].props.onChangeText(content);
  });
  await renderer.act(async () => button('保存').props.onPress());
}
assert.deepEqual(fixture.userPrompts.map((prompt) => prompt.name), ['第一条', '第二条']);
const dragCard = () => activeScreen().findAllByType('View').find((node) => node.props.onResponderRelease && text(node).includes('第一条正文'));
await renderer.act(async () => button('第一条正文').props.onLongPress());
await renderer.act(async () => dragCard().props.onTouchEnd());
assert.equal(dragCard().props.onMoveShouldSetResponderCapture(null, { dy: 40 }), false);
await renderer.act(async () => button('第一条正文').props.onLongPress());
assert.equal(dragCard().props.onMoveShouldSetResponderCapture(null, { dy: 40 }), true);
await renderer.act(async () => dragCard().props.onResponderRelease(null, { dy: 90 }));
assert.deepEqual(fixture.userPrompts.map((prompt) => prompt.name), ['第二条', '第一条']);
await renderer.act(async () => activeScreen().findAllByType('Switch')[0].props.onValueChange(false));
assert.equal(fixture.userPrompts[0].enabled, false);
await renderer.act(async () => button('删除').props.onPress());
await renderer.act(async () => alerts.at(-1)[2].find((item) => item.text === '删除').onPress());
assert.deepEqual(fixture.userPrompts.map((prompt) => prompt.name), ['第一条']);
// 编辑页返回列表后重新读取；系统返回与顶部返回保持同一层级。
await renderer.act(async () => button('第一条正文').props.onPress());
assert.equal(currentTitle(), '编辑提示词');
await renderer.act(async () => activeScreen().findAllByType('TextInput')[1].props.onChangeText('编辑保存后的正文'));
await renderer.act(async () => button('保存').props.onPress());
assert.equal(currentTitle(), '全局常驻提示词');
assert.ok(text(activeScreen()).includes('编辑保存后的正文'));
await systemBack();
assert.equal(currentTitle(), '提示词中心');
await renderer.act(async () => button('系统基础规则').props.onPress());
await renderer.act(async () => activeScreen().findByType('TextInput').props.onChangeText('基础规则未保存草稿'));
await renderer.act(async () => button('视觉规则').props.onPress());
assert.equal(currentTitle(), '视觉真实性规则');
assert.equal(activeScreen().findByType('TextInput').props.value, '视觉默认规则');
await systemBack();
assert.equal(currentTitle(), '系统基础规则');
assert.equal(activeScreen().findByType('TextInput').props.value, '基础规则未保存草稿');
let finishSave;
definitionSaveGate = new Promise((resolve) => { finishSave = resolve; });
await renderer.act(async () => button('保存').props.onPress());
await systemBack();
assert.equal(currentTitle(), '提示词中心');
await renderer.act(async () => finishSave());
definitionSaveGate = undefined;
assert.equal(fixture.overrides['foundation.default_core'], '基础规则未保存草稿');
assert.equal(currentTitle(), '提示词中心', '系统返回已退出的编辑页不能在保存完成后再次弹出父页');
await systemBack();
assert.equal(stackState.routes.at(-1).name, 'settings');
assert.deepEqual(aiReads, [], '全局概览与工具、自定义提示词只读取全局配置');
// AI 身份贯穿详情路由，人设只读取数据库最新值，协议空间保持对应角色。
assistantOptions = [otherAI, ai];
await renderer.act(async () => expo.useRouter().push('/prompt-center'));
assert.equal(stackState.routes.at(-1).params.assistantId, ai.id, '已有 AI 时应选主理，而不是列表首位');
assert.equal(button('AI 身份池'), undefined);
await renderer.act(async () => button('AI 人设').props.onPress());
assert.equal(stackState.routes.at(-1).params.assistantId, ai.id);
assert.ok(text(activeScreen()).includes('原始人设'));
assert.equal(activeScreen().findAllByType('TextInput').length, 0, '人设编辑入口归对话设置');
assert.equal(button('保存'), undefined);
await renderer.act(async () => {
  ai.persona = '对话设置保存后的人设';
  expo.useRouter().push('/mcp-tools');
});
await systemBack();
assert.ok(text(activeScreen()).includes('对话设置保存后的人设'), '保留的人设页重新获得焦点后读取数据库最新正文');
await systemBack();
assert.equal(currentTitle(), '提示词中心');
await renderer.act(async () => button('协议空间常驻提示词').props.onPress());
assert.equal(stackState.routes.at(-1).name, 'chat/[aiId]/protocol');
assert.equal(stackState.routes.at(-1).params.aiId, ai.id);
await systemBack();
// 时间只保存当前对象；切换后没有继承上一位 AI 的开关。
await renderer.act(async () => activeScreen().findByProps({ accessibilityLabel: '注入当前时间' }).props.onValueChange(false));
assert.equal(aiDetails.timeEnabled, false);
assert.equal(otherDetails.timeEnabled, true);
assert.deepEqual(actions, [], '绑定 AI 的时间开关不能写入全局默认');
await renderer.act(async () => activeScreen().findByProps({ accessibilityLabel: '注入手机电量' }).props.onValueChange(false));
assert.equal(aiDetails.batteryEnabled, false);
assert.equal(otherDetails.batteryEnabled, true);
await renderer.act(async () => button('工具调用').props.onPress());
await renderer.act(async () => button('主理 AI 专属').props.onPress());
assert.equal(button('手机工具').props.disabled, false);
await renderer.act(async () => button('手机工具').props.onPress());
assert.equal(stackState.routes.at(-1).name, 'phone-tools/index');
await systemBack(); await systemBack(); await systemBack();
await renderer.act(async () => button('编辑对象').props.onPress());
await renderer.act(async () => button('另一位 AI').props.onPress());
assert.equal(stackState.routes.at(-1).params.assistantId, otherAI.id);
assert.equal(activeScreen().findByProps({ accessibilityLabel: '注入当前时间' }).props.value, true);
assert.equal(activeScreen().findByProps({ accessibilityLabel: '注入手机电量' }).props.value, true);
assert.ok(text(activeScreen()).includes('另一位 AI'));
const globalBefore = JSON.stringify(fixture);
await renderer.act(async () => button('系统基础规则').props.onPress());
assert.equal(activeScreen().findByType('TextInput').props.value, fixture.overrides['foundation.default_core']);
await renderer.act(async () => activeScreen().findByType('TextInput').props.onChangeText('只为另一位 AI 修改基础规则'));
await renderer.act(async () => button('保存').props.onPress());
assert.equal(otherDetails.overrides[0].content, '只为另一位 AI 修改基础规则');
assert.deepEqual(aiDetails.overrides, []);
assert.equal(JSON.stringify(fixture), globalBefore);
await renderer.act(async () => button('自定义提示词').props.onPress());
assert.equal(stackState.routes.at(-1).params.assistantId, otherAI.id);
await renderer.act(async () => button('添加').props.onPress());
await renderer.act(async () => {
  activeScreen().findAllByType('TextInput')[0].props.onChangeText('另一位的规则');
  activeScreen().findAllByType('TextInput')[1].props.onChangeText('只注入另一位');
});
await renderer.act(async () => button('保存').props.onPress());
assert.equal(otherDetails.userPrompts.length, 1);
assert.equal(aiDetails.userPrompts.length, 0);
assert.equal(JSON.stringify(fixture), globalBefore);
await systemBack();
await renderer.act(async () => button('工具调用').props.onPress());
await renderer.act(async () => button('记忆').props.onPress());
assert.equal(activeScreen().findByProps({ accessibilityLabel: '直接暴露 read_memory' }).props.accessibilityState.checked, false);
await renderer.act(async () => activeScreen().findByProps({ accessibilityLabel: '直接暴露 read_memory' }).props.onPress());
assert.equal(activeScreen().findByProps({ accessibilityLabel: '直接暴露 read_memory' }).props.accessibilityState.checked, true);
assert.deepEqual(otherDetails.directToolNames, ['read_memory']);
assert.deepEqual(aiDetails.directToolNames, []);
await renderer.act(async () => activeScreen().findByType('Switch').props.onValueChange(false));
assert.equal(otherDetails.tools[0].name, 'read_memory');
assert.equal(otherDetails.tools[0].enabled, false);
assert.equal(activeScreen().findByProps({ accessibilityLabel: '直接暴露 read_memory' }).props.accessibilityState.checked, true, '关闭调用权限保留星标');
await systemBack();
assert.equal(currentTitle(), '工具调用');
assert.equal(activeScreen().findByProps({ accessibilityLabel: '特批工具' }).props.accessibilityState.expanded, false);
assert.ok(text(activeScreen().findByProps({ accessibilityLabel: '特批工具' })).includes('1 个'), '返回列表刷新特批数量');
assert.equal(button('read_memory'), undefined, '折叠时隐藏工具条目');
await renderer.act(async () => activeScreen().findByProps({ accessibilityLabel: '特批工具' }).props.onPress());
assert.ok(button('read_memory'));
assert.ok(text(button('read_memory')).includes('记忆 · 单项权限已关闭'));
await renderer.act(async () => button('read_memory').props.onPress());
assert.equal(currentTitle(), '记忆', '特批条目导航至原工具包');
await renderer.act(async () => activeScreen().findByProps({ accessibilityLabel: '直接暴露 read_memory' }).props.onPress());
assert.deepEqual(otherDetails.directToolNames, []);
assert.deepEqual(aiDetails.tools, []);
await systemBack();
assert.ok(text(activeScreen().findByProps({ accessibilityLabel: '特批工具' })).includes('0 个'));
assert.equal(button('read_memory'), undefined);
assert.ok(text(activeScreen()).includes('暂无特批工具'));
await renderer.act(async () => activeScreen().findByProps({ accessibilityLabel: '特批工具' }).props.onPress());
assert.equal(activeScreen().findByProps({ accessibilityLabel: '特批工具' }).props.accessibilityState.expanded, false);
assert.ok(!text(activeScreen()).includes('暂无特批工具'));
await systemBack();
await renderer.act(async () => button('编辑对象').props.onPress());
await renderer.act(async () => button('测试 AI').props.onPress());
assert.equal(activeScreen().findByProps({ accessibilityLabel: '注入当前时间' }).props.value, false);
assert.equal(activeScreen().findByProps({ accessibilityLabel: '注入手机电量' }).props.value, false);
assert.equal(stackState.routes.at(-1).params.assistantId, ai.id);
assert.equal(JSON.stringify(fixture), globalBefore);
// 曾在无 AI 页面添加的内容，在默认绑定主理后仍有明确的管理入口。
await renderer.act(async () => button('自定义提示词').props.onPress());
assert.equal(stackState.routes.at(-1).params.assistantId, ai.id);
await renderer.act(async () => button('全局常驻提示词').props.onPress());
assert.equal(currentTitle(), '全局常驻提示词');
assert.equal(stackState.routes.at(-1).params?.assistantId, undefined);
assert.ok(text(activeScreen()).includes('编辑保存后的正文'));
assert.ok(text(activeScreen()).includes('影响所有 AI'));
await renderer.act(async () => button('编辑保存后的正文').props.onPress());
assert.equal(activeScreen().findAllByType('TextInput')[1].props.value, '编辑保存后的正文');
assert.ok(text(activeScreen()).includes('对所有 AI 生效'));
await systemBack();
await renderer.act(async () => button('删除').props.onPress());
await renderer.act(async () => alerts.at(-1)[2].find((item) => item.text === '删除').onPress());
assert.equal(fixture.userPrompts.length, 0);
assert.equal(otherDetails.userPrompts.length, 1, '删除全局片段不能删除 AI 专属片段');
await systemBack();
assert.equal(currentTitle(), '自定义提示词');
assert.equal(stackState.routes.at(-1).params.assistantId, ai.id);
assert.ok(text(activeScreen()).includes('0 条'));
await systemBack(); await systemBack();
assert.equal(stackState.routes.at(-1).name, 'settings');
await renderer.act(async () => expo.useRouter().push({ pathname: '/prompt-center', params: { assistantId: otherAI.id } }));
assert.equal(stackState.routes.at(-1).params.assistantId, otherAI.id, '从 AI 设置进入应保留指定对象，不自动改为主理');
await systemBack();
optionListError = true;
await renderer.act(async () => expo.useRouter().push('/prompt-center'));
assert.ok(text(activeScreen()).includes('未能读取 AI 列表'));
assert.equal(button('系统基础规则'), undefined, '列表读取失败时不能退回可编辑全局配置');
await systemBack();
await renderer.act(async () => screen.unmount());
console.log('提示词顺序与默认概览行为通过：历史后系统上下文、批量输入、工具续轮、中文与配置继承、编辑重置、真实路由接线、逐层返回、主理默认选择、AI 切换隔离、按 AI 保存时间、手机开关所有权与全局提示词管理可达性。');
