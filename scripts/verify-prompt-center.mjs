import assert from 'node:assert/strict';
import { loadTypeScriptModule } from './helpers/load-typescript-module.mjs';

// MCP 服务状态是独立于选中 AI 的全局端口，UI 操作不得落到 per-AI 工具权限。
const mcpServiceDependencies = {
  mcpServices: {
    list: async () => [{
      id: 'server-1',
      name: '记忆库',
      description: '',
      enabled: true,
      connectionStatus: 'available',
      enabledToolCount: 2,
    }],
    setEnabled: async (id, enabled) => ({
      id,
      name: '记忆库',
      description: '',
      enabled,
      connectionStatus: 'available',
      enabledToolCount: 2,
    }),
  },
};
const { getPromptCenterMcpServices, setPromptCenterMcpServiceEnabled } = loadTypeScriptModule(
  'src/features/prompting/application/ManageMcpServices.ts',
  {
    './PromptingRuntimeDependencies': {
      getPromptingRuntimeDependencies: () => mcpServiceDependencies,
    },
  },
);
assert.deepEqual(await getPromptCenterMcpServices(), await mcpServiceDependencies.mcpServices.list());
assert.deepEqual(
  await setPromptCenterMcpServiceEnabled('server-1', false),
  {
    id: 'server-1',
    name: '记忆库',
    description: '',
    enabled: false,
    connectionStatus: 'available',
    enabledToolCount: 2,
  },
  'MCP 服务开关必须直接返回全局 server.enabled 状态',
);

let configuredPromptingDependencies;
let editorAPIBaseURL = 'https://third-party.test/v1';
const editorPermissionWrites = [];
const builtInToolDescriptors = [{
  name: 'search_protocols',
  description: '读取协议',
  defaultEnabled: true,
  mutating: false,
  callOnly: false,
}];
let server = {
  id: 'server-1',
  name: '记忆库',
  description: '',
  enabled: true,
  connectionStatus: 'available',
  enabledToolCount: 2,
};
const configuredPrompting = loadTypeScriptModule(
  'src/host/composition/configurePromptingRuntime.ts',
  {
    '@platform/ai': loadTypeScriptModule('src/platform/ai/moonshotEndpoint.ts'),
    '@features/prompting/composition': {
      configurePromptingRuntimeDependencies: (dependencies) => {
        configuredPromptingDependencies = dependencies;
      },
      sqlitePromptingRepository: { setDirectToolExposure: async (...args) => editorPermissionWrites.push(args) },
    },
    '@features/assistants': {
      aiAssistantRepository: { getById: async () => ({ apiBaseUrl: editorAPIBaseURL }) },
      assistantToolPermissionRepository: { set: async permission => editorPermissionWrites.push(permission) },
    },
    '@features/chat': { getAssistantChatSummaryGenerationState: async () => ({ primaryEnabled: true, secondaryEnabled: false }) },
    '@features/mcpTools': {
      listMcpServersWithEnabledToolCounts: async () => [server],
      setMcpServerEnabled: async (id, enabled) => {
        assert.equal(id, server.id);
        server = { ...server, enabled };
        return server;
      },
    },
    '../prompt': {
      getSystemPromptPreset: () => ({}),
      promptCatalog: {},
      validateBuiltInPromptArchitecture: () => {},
    },
    './agent': { getToolPermissionDescriptors: () => builtInToolDescriptors },
  },
);
configuredPrompting.configurePromptingRuntime();
assert.deepEqual(await configuredPromptingDependencies.summary.getGenerationState('ai-1'), { primaryEnabled: true, secondaryEnabled: false });
assert.deepEqual(
  await configuredPromptingDependencies.tools.list(),
  builtInToolDescriptors,
  '提示词中心工具目录只能返回 Built-in 工具，不能返回 MCP 具体工具',
);
builtInToolDescriptors.push({ name: 'kimi_web_search', owner: 'webTools', moonshotOnly: true, defaultEnabled: false });
const editorManagement = loadTypeScriptModule('src/features/prompting/application/ManageAssistantPrompts.ts', {
  './PromptingRuntimeDependencies': { getPromptingRuntimeDependencies: () => configuredPromptingDependencies },
});
assert.match((await configuredPromptingDependencies.tools.list('ai-1')).find(tool => tool.name === 'kimi_web_search').unavailableReason, /当前接口不支持/u);
await assert.rejects(editorManagement.setAssistantToolPermission('ai-1', 'kimi_web_search', true), /当前接口不支持/u);
await assert.rejects(editorManagement.setAssistantDirectToolExposure('ai-1', 'kimi_web_search', true), /当前接口不支持/u);
assert.equal(editorPermissionWrites.length, 0, '不支持的接口不能修改工具权限或星标');
editorAPIBaseURL = 'https://api.moonshot.cn/v1';
assert.equal((await configuredPromptingDependencies.tools.list('ai-1')).find(tool => tool.name === 'kimi_web_search').unavailableReason, undefined);
await editorManagement.setAssistantToolPermission('ai-1', 'kimi_web_search', true);
await editorManagement.setAssistantDirectToolExposure('ai-1', 'kimi_web_search', true);
assert.equal(editorPermissionWrites.length, 2);
assert.deepEqual(
  await configuredPromptingDependencies.mcpServices.list(),
  [server],
  'MCP 服务列表必须由全局服务配置提供',
);
assert.deepEqual(
  await configuredPromptingDependencies.mcpServices.setEnabled('server-1', false),
  { ...server, enabled: false },
  'MCP 服务开关必须直写 server.enabled，不得经过 assistant_tool_permissions',
);

// 目录定义依赖真实内置正文，必须整体加载真实模块而不是占位正文。
const promptBuiltInContent = loadTypeScriptModule('src/host/prompt/PromptBuiltInContent.ts', {});
const promptDefinitions = loadTypeScriptModule(
  'src/host/prompt/catalog/hostPromptDefinitions.ts',
  { '../PromptBuiltInContent': promptBuiltInContent },
);
const toolsDescriptionDefinition = promptDefinitions.HOST_PROMPT_DEFINITIONS.find(
  (definition) => definition.id === 'context.tools_description',
);
assert.equal(
  toolsDescriptionDefinition?.protection,
  'locked',
  'tools_description 必须是受保护的运行时说明',
);

const { resolvePromptBlockMetadata } = loadTypeScriptModule(
  'src/host/prompt/compiler/promptBlockMetadata.ts',
);
assert.equal(
  resolvePromptBlockMetadata({ key: 'tools_description' }, 'chat.private_reply').protection,
  'locked',
  '旧 Block key 的元数据也必须保持 tools_description 的运行时保护语义',
);

// 回归：conditionMatches 对运行时遗留 condition 一律 false，不再末尾兜底 tools_enabled。
const { resolveAssistantPromptConfiguration } = loadTypeScriptModule(
  'src/features/prompting/application/ManageAssistantPrompts.ts',
  {
    './PromptingRuntimeDependencies': {
      getPromptingRuntimeDependencies: () => ({
        defaults: { read: async () => ({ overrides: {}, userPrompts: [], toolPermissions: {}, timeEnabled: true }) },
        assistantPrompts: {
          getAssistantSettings: async () => ({ assistantId: 'a1', languageMode: 'zh-CN', createdAt: '', updatedAt: '' }),
          listDefinitionStates: async () => [],
          listDefinitionOverrides: async () => [],
          listAssistantUserPrompts: async () => [
            { id: 'p-always', assistantId: 'a1', name: '常驻', content: 'x', condition: 'always', enabled: true, sortOrder: 1, createdAt: '', updatedAt: '' },
            { id: 'p-legacy', assistantId: 'a1', name: '遗留', content: 'x', condition: 'raven_cat_proactive', enabled: true, sortOrder: 2, createdAt: '', updatedAt: '' },
            { id: 'p-moments', assistantId: 'a1', name: '退役时刻', content: 'x', condition: 'moments', enabled: true, sortOrder: 3, createdAt: '', updatedAt: '' },
            { id: 'p-tools', assistantId: 'a1', name: '工具', content: 'x', condition: 'tools_enabled', enabled: true, sortOrder: 4, createdAt: '', updatedAt: '' },
          ],
        },
      }),
    },
  },
);
const resolvedWithTools = await resolveAssistantPromptConfiguration({
  assistantId: 'a1', scenarioId: 'chat.private_reply', toolsEnabled: true,
});
assert.deepEqual(
  resolvedWithTools.userPrompts.map((prompt) => prompt.condition).sort(),
  ['always', 'tools_enabled'],
  '遗留 raven_cat_proactive 与 moments 即使 toolsEnabled=true 也不得匹配任何现存 scenario',
);
const resolvedWithoutTools = await resolveAssistantPromptConfiguration({
  assistantId: 'a1', scenarioId: 'chat.private_reply', toolsEnabled: false,
});
assert.deepEqual(
  resolvedWithoutTools.userPrompts.map((prompt) => prompt.condition).sort(),
  ['always'],
  'tools_enabled=false 时不得兜底匹配，遗留 condition 同样不匹配',
);
console.log('提示词中心 MCP 服务端口、工具权限、条件匹配与受保护定义检查通过。');
