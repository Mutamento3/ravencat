import { agentToolSchemaDependencies } from './helpers/agent-tool-schema-dependencies.mjs';
/** 联网工具的公开参数、结果、权限、拆包与取消行为验证。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
import { bootstrapSqlite, createSqliteExecutor, DATABASE_SCHEMA_VERSION } from './helpers/sqlite-bootstrap-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(relative, mocks = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: relative,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)((id) => {
    assert.ok(Object.hasOwn(mocks, id), `${relative} 未提供依赖 ${id}`);
    return mocks[id];
  }, module, module.exports);
  return module.exports;
}

const calls = [];
let nativeResult = { ok: true, data: { items: [{ title: '资料', url: 'https://example.com', snippet: '摘要' }] } };
let pending;
let searchStarted;
const native = {
  createRequest: () => 'request-1',
  cancelRequest: (id) => calls.push(['cancel', id]),
  search: async (...args) => { calls.push(['search', ...args]); searchStarted?.(); return pending ?? nativeResult; },
  readPage: async (...args) => { calls.push(['read', ...args]); return nativeResult; },
  download: async (...args) => { calls.push(['download', ...args]); return nativeResult; },
  downloadImage: async (...args) => { calls.push(['image', ...args]); return pending ?? nativeResult; },
};
const web = load('src/platform/web/WebTools.ts', {
  expo: { requireNativeModule: () => native },
  'expo-file-system': { File: class { constructor(uri) { this.uri = uri; } delete() { calls.push(['delete-temp', this.uri]); } } },
  '@shared/runtime/abortSignal': load('src/shared/runtime/abortSignal.ts'),
});
const searchDomain = load('src/features/webTools/domain/SearchSettings.ts');
const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON');
await bootstrapSqlite(createSqliteExecutor(database));
// 从上一版真实库结构升级，保留既有资料，新配置只由 bootstrap 创建。
database.exec(`UPDATE user_profile SET name='保留资料'; DROP TABLE web_search_sources; DROP TABLE web_search_settings;
  CREATE TABLE assistant_nickname_changes(id INTEGER PRIMARY KEY AUTOINCREMENT,
    assistant_id TEXT NOT NULL REFERENCES ai_assistants(id) ON DELETE CASCADE,
    previous_nickname TEXT, nickname TEXT, acknowledged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
  ALTER TABLE raven_cat_ai_schedules DROP COLUMN system_calendar;
  ALTER TABLE ai_assistants DROP COLUMN show_action_steps; ALTER TABLE ai_assistants DROP COLUMN streaming_reply;
  ALTER TABLE chat_summary_request_settings DROP COLUMN primary_limit;
  ALTER TABLE group_chat_members DROP COLUMN muted;
  ALTER TABLE group_chat_members DROP COLUMN joined_during_plan_id;
  PRAGMA user_version=133;`);
await bootstrapSqlite(createSqliteExecutor(database));
assert.equal(database.prepare('PRAGMA user_version').get().user_version, DATABASE_SCHEMA_VERSION);
assert.equal(database.prepare('SELECT name FROM user_profile').get().name, '保留资料');
const sql = createSqliteExecutor(database);
let transactionTail = Promise.resolve();
const coordinated = { ...sql, withExclusiveTransactionAsync(callback) {
  const operation = transactionTail.then(async () => {
    database.exec('BEGIN IMMEDIATE');
    try { const result = await callback(sql); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  });
  transactionTail = operation.catch(() => {});
  return operation;
} };
const { sqliteSearchSettingsRepository } = load('src/features/webTools/infrastructure/SQLiteSearchSettingsRepository.ts', {
  '@platform/persistence': { databaseCoordinator: { openTaskExecutor: () => coordinated } },
  '../domain/SearchSettings': searchDomain,
});
const credentials = new Map();
let credentialSequence = 0;
const searchRuntime = { settings: sqliteSearchSettingsRepository,
  credentials: { save: async key => { const ref = `key-${credentialSequence++}`; credentials.set(ref, key); return ref; },
  read: async ref => credentials.get(ref) ?? null, delete: async ref => { credentials.delete(ref); } } };
const searchConfiguration = load('src/features/webTools/application/SearchConfiguration.ts', {
  '@platform/web': web, '@shared/runtime/abortSignal': load('src/shared/runtime/abortSignal.ts'),
  '../domain/SearchSettings': searchDomain, './WebToolsRuntime': { getWebToolsRuntime: () => searchRuntime },
});
const schema = load('src/shared/aiTools/AgentToolInputSchema.ts', agentToolSchemaDependencies);
const endpoint = load('src/platform/ai/moonshotEndpoint.ts');
let officialResponse = () => new Response(JSON.stringify({ search_results: [] }));
const officialRequests = [];
const { MoonshotToolsClient } = load('src/platform/ai/MoonshotToolsClient.ts', {
  './moonshotEndpoint': endpoint,
  '@shared/aiTools': schema,
  '@shared/runtime/abortSignal': load('src/shared/runtime/abortSignal.ts'),
  'expo/fetch': { fetch: async (url, options) => { officialRequests.push({ url, options }); return officialResponse(url, options); } },
});
const kimiTools = load('src/features/webTools/application/KimiOfficialTools.ts', { '@platform/ai': { MoonshotToolsClient } });
const tools = { ...load('src/features/webTools/application/WebAgentTools.ts', { '@platform/web': web, './SearchConfiguration': searchConfiguration }), ...kimiTools };
const { AgentToolRegistry } = load('src/platform/agentRuntime/AgentToolRegistry.ts');
const { AgentToolExecutor } = load('src/platform/agentRuntime/AgentToolExecutor.ts', { '@shared/aiTools': schema });
const placeholder = (name) => ({ name, definition: { name, description: name, parameters: { type: 'object' } }, execute: async () => ({ success: true }) });
const proxy = new Proxy({}, { get: (_, name) => placeholder(String(name)) });
let defaults = {};
let overrides = [];
const featureNames = ['protocol', 'moments', 'wallet', 'calls', 'memory', 'deviceControl', 'companion', 'phoneTools', 'screenCapture', 'chat', 'stickers', 'togetherListening'];
const registration = load('src/host/composition/agent/createAgentToolRegistry.ts', {
  '@shared/aiTools': load('src/shared/aiTools/ToolCompletionIntent.ts'),
  '@platform/ai': endpoint,
  '@features/media': proxy,
  '@features/moments/composition': {},
  './ApplicationSettingsTools': { applicationSettingsTools: [] },
  './GroupManagementTools': { groupManagementTools: [] },
  ...Object.fromEntries(featureNames.map((name) => [`@features/${name}`, proxy])),
  '@features/webTools': tools,
  '@features/prompting': { readPromptDefaults: async () => ({ toolPermissions: defaults }) },
  '@features/assistants': new Proxy({ assistantToolPermissionRepository: { list: async () => overrides } }, {
    get: (target, name) => target[name] ?? placeholder(String(name)),
  }),
  '@features/phoneTools/neteaseComposition': { productionNetEaseChildTools: [] },
  '@platform/agentRuntime': { AgentToolRegistry },
  './LegacyAgentToolAdapter': load('src/host/composition/agent/LegacyAgentToolAdapter.ts', { '@shared/aiTools': {} }),
});

const names = ['web_search', 'web_fetch', 'download_file'];
const config = { enableTools: true, isHostAI: false, triggerSource: 'chat', allowedToolNames: names };
assert.deepEqual(registration.getRuntimeAllowedToolNamesForAI(config), names);
assert.deepEqual(registration.getRuntimeAllowedToolNamesForAI({ ...config, enableTools: false }), []);
for (const name of names) {
  const descriptor = registration.getToolPermissionDescriptors().find((tool) => tool.name === name);
  assert.equal(descriptor.owner, 'webTools');
  assert.equal(descriptor.defaultEnabled, true);
  assert.equal(descriptor.hostOnly, false);
  assert.ok((await registration.resolveAllowedToolNames('ordinary-ai')).includes(name));
}
defaults = { web_search: false };
assert.ok(!(await registration.resolveAllowedToolNames('ordinary-ai')).includes('web_search'));
overrides = [{ toolName: 'web_search', enabled: true }, { toolName: 'download_file', enabled: false }];
const allowed = await registration.resolveAllowedToolNames('ordinary-ai');
assert.ok(allowed.includes('web_search'));
assert.ok(!allowed.includes('download_file'));

const registry = registration.createAgentToolRegistry({ createLegacyContext: () => ({}) });
const { registerToolPackagesForHostRun } = load('src/host/composition/agent/ToolPackageExposure.ts');
const exposure = registerToolPackagesForHostRun({ registry, allowedToolNames: ['web_search', 'web_fetch'],
  bindings: registration.getToolPackageRuntimeBindings(registry), openPackageIds: [] });
assert.deepEqual(exposure.visibleToolNames(), []);
const executor = new AgentToolExecutor(registry);
const controller = new AbortController();
const task = { allowedToolNames: [...names, 'open_tool_package'] };
const context = { runId: 'run', task, toolCallId: 'call', abortSignal: controller.signal };
const execute = async (name, input) => {
  const preparation = executor.prepare({ name, arguments: JSON.stringify(input) }, task);
  assert.equal(preparation.status, 'ready');
  return executor.execute(preparation, context);
};
assert.equal((await execute('open_tool_package', { package_id: 'webTools' })).status, 'success');
assert.deepEqual(exposure.visibleToolNames(), ['web_search', 'web_fetch']);
assert.ok(!exposure.packageToolNames.includes('download_file'));

const result = await execute('web_search', { query: '资料' });
assert.equal(result.status, 'success');
assert.deepEqual(result.data, { ...nativeResult.data, defaultEngine: 'bing', availableEngines: ['bing', 'duckduckgo'] });
assert.ok(result.modelContent.includes('https://example.com'));
assert.deepEqual(calls.at(-1), ['search', 'request-1', '资料', 5, 'bing', null, 'basic', null]);
assert.equal(executor.prepare({ name: 'web_search', arguments: '{"query":" "}' }, task).status, 'rejected');
assert.equal(executor.prepare({ name: 'web_search', arguments: '{"query":"资料","limit":11}' }, task).status, 'rejected');
assert.equal(executor.prepare({ name: 'download_file', arguments: '{"url":"https://example.com","directory":"/other"}' }, task).status, 'rejected');

nativeResult = { ok: true, data: { text: '正文', truncated: true } };
assert.equal((await execute('web_fetch', { url: 'https://example.com' })).data.truncated, true);
assert.deepEqual(calls.at(-1), ['read', 'request-1', 'https://example.com', 12000, 0, null, null]);
nativeResult = { ok: true, data: { fileName: '报告-unique.pdf', directory: 'Download/RavenCat AI/', uri: 'content://downloads/1', sizeBytes: 123 } };
const downloaded = await execute('download_file', { url: 'https://example.com/report.pdf' });
assert.equal(downloaded.data.directory, 'Download/RavenCat AI/');
assert.ok(downloaded.modelContent.includes('报告-unique.pdf'));
assert.deepEqual(calls.at(-1), ['download', 'request-1', 'https://example.com/report.pdf', null]);
nativeResult = { ok: false, error: { code: 'WEB_SEARCH_UNAVAILABLE', message: '来源不可用' } };
assert.deepEqual(await execute('web_search', { query: '资料' }), {
  status: 'error', code: 'WEB_SEARCH_UNAVAILABLE', retryable: false, modelContent: '来源不可用。默认来源：bing；可用来源：bing、duckduckgo。需要时可显式指定 engine 换来源或改写关键词。',
});

const cancelled = new AbortController();
cancelled.abort(new Error('已取消'));
const count = calls.length;
const searchOptions = { engine: 'bing', apiKey: null, depth: 'basic', timeRange: null };
await assert.rejects(web.searchWeb('资料', 5, cancelled.signal, searchOptions), /已取消/u);
assert.equal(calls.length, count);
let resolvePending;
pending = new Promise((resolve) => { resolvePending = resolve; });
const running = new AbortController();
const operation = web.searchWeb('资料', 5, running.signal, searchOptions);
running.abort(new Error('运行取消'));
assert.deepEqual(calls.at(-1), ['cancel', 'request-1']);
resolvePending({ ok: true, data: {} });
await assert.rejects(operation, /运行取消/u);
const completed = new AbortController();
pending = undefined;
await web.searchWeb('资料', 5, completed.signal, searchOptions);
const completedCount = calls.length;
completed.abort();
assert.equal(calls.length, completedCount, '完成后取消监听必须释放');
let resolveImage;
pending = new Promise(resolve => { resolveImage = resolve; });
const imageController = new AbortController();
const imageOperation = web.downloadWebImage('https://example.com/cat.png', null, imageController.signal);
imageController.abort(new Error('取消图片下载'));
resolveImage({ ok: true, data: { uri: 'file:///temp-image' } });
await assert.rejects(imageOperation, /取消图片下载/);
assert.deepEqual(calls.at(-1), ['delete-temp', 'file:///temp-image'], '原生返回与取消竞态不能留下失去 owner 的暂存图');

// 同一工具允许显式换来源；未授权来源、未允许的深度与不支持的选项不会发起网络请求。
pending = undefined;
nativeResult = { ok: true, data: { engine: 'duckduckgo', source: 'DuckDuckGo', query: '资料', items: [] } };
assert.equal((await execute('web_search', { query: '资料', engine: 'duckduckgo', time_range: 'week' })).status, 'success');
assert.deepEqual(calls.at(-1), ['search', 'request-1', '资料', 5, 'duckduckgo', null, 'basic', 'week']);
for (const input of [{ engine: 'tavily' }, { engine: 'brave' }, { depth: 'advanced' }, { time_range: 'day' }]) {
  const before = calls.length;
  assert.equal((await execute('web_search', { query: '资料', ...input })).status, 'error');
  assert.equal(calls.length, before);
}
assert.equal(executor.prepare({ name: 'web_search', arguments: '{"query":"资料","engine":"unknown"}' }, task).status, 'rejected');
assert.equal(executor.prepare({ name: 'web_search', arguments: '{"query":"资料","api_key":"secret"}' }, task).status, 'rejected');
assert.equal(executor.prepare({ name: 'web_fetch', arguments: '{"url":"https://example.com","start_char":-1}' }, task).status, 'rejected');
await execute('web_fetch', { url: 'https://example.com', start_char: 12000, find: '目标', document_version: 'a'.repeat(64) });
assert.deepEqual(calls.at(-1), ['read', 'request-1', 'https://example.com', 12000, 12000, '目标', 'a'.repeat(64)]);

const testSignal = new AbortController().signal;
const initial = await searchRuntime.settings.read();
assert.equal(initial.defaultEngine, 'bing');
await assert.rejects(searchConfiguration.updateSearchConfiguration({ kind: 'enabled', engine: 'tavily', enabled: true }), /密钥/);
await assert.rejects(searchConfiguration.testAndSaveSearchKey('tavily', 'bad key', testSignal), /有效/);
assert.deepEqual(await searchRuntime.settings.read(), initial);
nativeResult = { ok: false, error: { code: 'WEB_API_AUTH_FAILED', message: '密钥无效' } };
await assert.rejects(searchConfiguration.testAndSaveSearchKey('tavily', 'test-tavily-key', testSignal), /密钥无效/);
assert.deepEqual(await searchRuntime.settings.read(), initial);
assert.equal(credentials.size, 0);

nativeResult = { ok: true, data: { engine: 'tavily', source: 'Tavily', items: [] } };
await searchConfiguration.testAndSaveSearchKey('tavily', 'test-tavily-key', testSignal);
assert.equal((await searchRuntime.settings.read()).defaultEngine, 'tavily', '首次成功配置自有服务自动设为默认');
const configuredResult = await execute('web_search', { query: '资料' });
assert.equal(calls.at(-1)[4], 'tavily');
assert.equal(calls.at(-1)[5], 'test-tavily-key');
assert.ok(!configuredResult.modelContent.includes('test-tavily-key'));
assert.ok(!JSON.stringify(await searchConfiguration.readSearchConfiguration()).includes('credentialRef'));
assert.equal((await searchConfiguration.readSearchConfiguration()).sources.find(source => source.engine === 'tavily').apiKey, 'test-tavily-key');
const beforeRetest = await searchRuntime.settings.read();
await searchConfiguration.testAndSaveSearchKey('tavily', 'test-tavily-key', testSignal);
assert.deepEqual(await searchRuntime.settings.read(), beforeRetest, '测试未修改的密钥不重复发布配置');
await assert.rejects(searchConfiguration.testAndSaveSearchKey('tavily', '', testSignal), /有效/, '清空输入后不能静默使用已保存密钥');
await searchConfiguration.testAndSaveSearchKey('brave', 'test-brave-key', testSignal);
assert.equal((await searchRuntime.settings.read()).defaultEngine, 'tavily', '后加服务不覆盖已有默认');
await searchConfiguration.updateSearchConfiguration({ kind: 'default', engine: 'brave' });
await searchConfiguration.testAndSaveSearchKey('tavily', 'replacement-key', testSignal);
assert.equal((await searchRuntime.settings.read()).defaultEngine, 'brave');
assert.ok(![...credentials.values()].includes('test-tavily-key'), '替换成功后回收旧凭据');
assert.equal((await execute('web_search', { query: '资料', engine: 'tavily', depth: 'advanced' })).status, 'error');
await searchConfiguration.updateSearchConfiguration({ kind: 'advanced', allowed: true });
assert.equal((await execute('web_search', { query: '资料', engine: 'tavily', depth: 'advanced' })).status, 'success');
assert.equal(calls.at(-1)[6], 'advanced');

// 测试期间修改配置：迟到成功不能重新启用来源或覆盖默认，未发布的新凭据必须回收。
let releaseTest;
pending = new Promise(resolve => { releaseTest = resolve; });
let enterTest;
const testEntered = new Promise(resolve => { enterTest = resolve; });
searchStarted = enterTest;
const lateSave = searchConfiguration.testAndSaveSearchKey('tavily', 'late-key', testSignal);
await testEntered;
searchStarted = undefined;
await searchConfiguration.updateSearchConfiguration({ kind: 'enabled', engine: 'tavily', enabled: false });
const beforeLateResult = await searchRuntime.settings.read();
releaseTest(nativeResult);
await assert.rejects(lateSave, /配置已改变/);
assert.deepEqual(await searchRuntime.settings.read(), beforeLateResult);
assert.ok(![...credentials.values()].includes('late-key'));
pending = undefined;

// 恢复时安全存储可能不在本机；错误必须可见，不自动使用免费来源冒充成功。
credentials.clear();
const missing = await execute('web_search', { query: '资料' });
assert.equal(missing.code, 'WEB_SEARCH_CREDENTIAL_MISSING');
const missingConfiguration = await searchConfiguration.readSearchConfiguration();
assert.equal(missingConfiguration.sources.find(source => source.engine === 'tavily').configured, false);
assert.equal(missingConfiguration.sources.find(source => source.engine === 'tavily').apiKey, '');
await searchConfiguration.updateSearchConfiguration({ kind: 'enabled', engine: 'brave', enabled: false });
assert.equal((await searchRuntime.settings.read()).defaultEngine, null);
assert.equal((await execute('web_search', { query: '资料' })).code, 'WEB_SEARCH_NOT_CONFIGURED');
await searchConfiguration.updateSearchConfiguration({ kind: 'default', engine: 'duckduckgo' });
const saved = await searchRuntime.settings.read();
await bootstrapSqlite(createSqliteExecutor(database));
assert.deepEqual(await searchRuntime.settings.read(), saved, '再次启动不覆盖配置');
assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
// 官方工具走相同权限、拆包与 Executor；协议响应在 Provider 边界验证。
const kimiNames = ['kimi_web_search', 'kimi_web_fetch', 'kimi_mew'];
for (const address of ['https://api.moonshot.cn', 'https://api.moonshot.ai/v1/', ' https://API.MOONSHOT.CN/v1 ']) {
  assert.ok(endpoint.resolveMoonshotAPIBaseURL(address));
  assert.deepEqual(registration.getRuntimeAllowedToolNamesForAI({ ...config, apiBaseUrl: address, allowedToolNames: kimiNames }), kimiNames);
}
for (const address of ['https://api.moonshot.cn.evil.test/v1', 'https://evil.test/kimi', 'http://api.moonshot.cn',
  'https://api.moonshot.cn:8443/v1', 'https://user@api.moonshot.cn/v1', 'https://api.moonshot.cn/proxy/v1',
  'https://api.moonshot.cn/v1?proxy=yes', 'https://api.moonshot.cn/v1#proxy', undefined, 'invalid']) {
  assert.equal(endpoint.resolveMoonshotAPIBaseURL(address), null);
  assert.deepEqual(registration.getRuntimeAllowedToolNamesForAI({ ...config, apiBaseUrl: address, allowedToolNames: kimiNames }), []);
}
assert.throws(() => new MoonshotToolsClient({ baseURL: 'https://evil.test/kimi', apiKey: 'secret-test-key' }));
for (const name of kimiNames) {
  assert.equal(registration.getToolPermissionDescriptors().find(tool => tool.name === name).defaultEnabled, false);
  assert.ok(!(await registration.resolveAllowedToolNames('ordinary-ai')).includes(name));
}
defaults = { kimi_web_search: true, kimi_web_fetch: true };
overrides = [{ toolName: 'kimi_web_fetch', enabled: false }];
const kimiPolicy = { ...config, apiBaseUrl: 'https://api.moonshot.cn/v1', allowedToolNames: await registration.resolveAllowedToolNames('ordinary-ai') };
assert.ok(registration.getRuntimeAllowedToolNamesForAI(kimiPolicy).includes('kimi_web_search'));
assert.ok(!registration.getRuntimeAllowedToolNamesForAI(kimiPolicy).includes('kimi_web_fetch'));
assert.deepEqual(registration.getRuntimeAllowedToolNamesForAI({ ...kimiPolicy, enableTools: false }), []);
const officialRegistry = registration.createAgentToolRegistry({ createLegacyContext: context => ({
  aiConfig: { apiBaseUrl: 'https://api.moonshot.cn', apiKey: 'secret-test-key' }, abortSignal: context.abortSignal,
}) });
const officialExecutor = new AgentToolExecutor(officialRegistry);
const officialTask = { allowedToolNames: [...kimiNames, 'open_tool_package'] };
const officialController = new AbortController();
const officialContext = { ...context, task: officialTask, abortSignal: officialController.signal };
const officialExposure = registerToolPackagesForHostRun({ registry: officialRegistry, allowedToolNames: kimiNames,
  bindings: registration.getToolPackageRuntimeBindings(officialRegistry), openPackageIds: [], directToolNames: ['kimi_web_search'] });
assert.deepEqual(officialExposure.visibleToolNames(), ['kimi_web_search']);
await officialRegistry.get('open_tool_package').execute({ package_id: 'kimiOfficial' }, officialContext);
assert.deepEqual(officialExposure.visibleToolNames(), kimiNames);
const blockedRegistry = registration.createAgentToolRegistry({ createLegacyContext: () => ({}) });
const blockedExposure = registerToolPackagesForHostRun({ registry: blockedRegistry, allowedToolNames: [],
  bindings: registration.getToolPackageRuntimeBindings(blockedRegistry), openPackageIds: ['kimiOfficial'], directToolNames: kimiNames });
assert.deepEqual(blockedExposure.visibleToolNames(), []);
assert.ok(!blockedExposure.instructions().catalog.includes('kimi_web_search'));
assert.equal(officialExecutor.prepare({ name: 'kimi_web_search', arguments: '{"query":"新闻"}' }, { allowedToolNames: [] }).status, 'rejected');
assert.equal(officialExecutor.prepare({ name: 'kimi_web_search', arguments: '{"query":" "}' }, officialTask).status, 'rejected');
assert.equal(officialExecutor.prepare({ name: 'kimi_web_fetch', arguments: '{"url":"file:///secret"}' }, officialTask).status, 'rejected');
const runOfficialTool = async (name, input) => {
  const prepared = officialExecutor.prepare({ name, arguments: JSON.stringify(input) }, officialTask);
  assert.equal(prepared.status, 'ready');
  return officialExecutor.execute(prepared, officialContext);
};
officialResponse = () => new Response(JSON.stringify({ search_results: [{ title: '文档', url: 'https://example.com', snippet: '正文片段', site_name: '示例', date: '' }] }));
const officialSearch = await runOfficialTool('kimi_web_search', { query: '新闻' });
assert.equal(officialSearch.status, 'success');
assert.ok(officialSearch.modelContent.includes('正文片段'));
assert.ok(!officialSearch.modelContent.includes('secret-test-key'));
assert.equal(officialRequests.at(-1).url, 'https://api.moonshot.cn/v1/tools/search');
assert.deepEqual(JSON.parse(officialRequests.at(-1).options.body), { text_query: '新闻', limit: 5, include_content: false, timeout_seconds: 30 });
assert.equal(officialRequests.at(-1).options.headers.Authorization, 'Bearer secret-test-key');
assert.equal(officialRequests.at(-1).options.redirect, 'error');
officialResponse = () => new Response(JSON.stringify({ url: 'https://example.com', title: '文档', markdown: '文'.repeat(20001) }));
const officialFetch = await runOfficialTool('kimi_web_fetch', { url: 'https://example.com' });
assert.equal(officialFetch.status, 'success');
assert.equal(officialFetch.data.markdown.length, 20000);
assert.equal(officialFetch.data.truncated, true);
assert.equal(officialRequests.at(-1).url, 'https://api.moonshot.cn/v1/tools/fetch');
officialResponse = () => new Response('secret-test-key', { status: 401 });
const unauthorized = await runOfficialTool('kimi_web_search', { query: '新闻' });
assert.equal(unauthorized.code, 'KIMI_TOOLS_HTTP_401');
assert.ok(!unauthorized.modelContent.includes('secret-test-key'));
officialResponse = () => new Response('{broken');
assert.equal((await runOfficialTool('kimi_web_search', { query: '新闻' })).code, 'KIMI_TOOLS_INVALID_RESPONSE');
officialResponse = () => new Response(JSON.stringify({ search_results: [{}] }));
assert.equal((await runOfficialTool('kimi_web_search', { query: '新闻' })).code, 'KIMI_TOOLS_INVALID_RESPONSE');
officialResponse = () => new Response('x'.repeat(2 * 1024 * 1024 + 1));
assert.equal((await runOfficialTool('kimi_web_fetch', { url: 'https://example.com' })).code, 'KIMI_TOOLS_RESPONSE_TOO_LARGE');
// 使用与本地名字不同的官方函数，验证发现、参数修正与固定 Formula 路由。
let mewFunctions = [{ type: 'function', function: { name: 'random_cat_blessing', description: '随机猫叫',
  parameters: { type: 'object', properties: { language: { type: 'string', enum: ['zh'] } }, required: ['language'], additionalProperties: false } } }];
let mewFiber = { status: 'succeeded', context: { output: '喵呜～祝你今天开心！' } };
officialResponse = (url, options) => {
  if (url.endsWith('/tools')) {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    return new Response(JSON.stringify({ tools: mewFunctions }));
  }
  assert.equal(url, 'https://api.moonshot.cn/v1/formulas/moonshot/mew:latest/fibers');
  assert.equal(options.method, 'POST');
  return new Response(JSON.stringify(mewFiber));
};
const beforeMew = officialRequests.length;
const needsMewInput = await runOfficialTool('kimi_mew', {});
assert.equal(needsMewInput.status, 'success');
assert.equal(needsMewInput.data.kind, 'input_required');
assert.equal(officialRequests.length, beforeMew + 1, '缺少官方参数时不能执行 fiber');
assert.ok(needsMewInput.modelContent.includes('language'));
const mewResult = await runOfficialTool('kimi_mew', { arguments: { language: 'zh' } });
assert.equal(mewResult.status, 'success');
assert.equal(mewResult.modelContent, '喵呜～祝你今天开心！');
assert.ok(!mewResult.modelContent.includes('外部资料'), '趣味工具直接返回结果，不套用网页资料包装');
assert.deepEqual(JSON.parse(officialRequests.at(-1).options.body), { name: 'random_cat_blessing', arguments: '{"language":"zh"}' });
const beforeUnknownMewFunction = officialRequests.length;
assert.equal((await runOfficialTool('kimi_mew', { function_name: 'memory', arguments: {} })).data.kind, 'input_required');
assert.equal(officialRequests.length, beforeUnknownMewFunction + 1, '不能调用官方声明以外的函数');
mewFunctions = [{ type: 'function', function: { name: 'cat_blessing', description: '随机猫叫', parameters: { type: 'object', properties: {}, additionalProperties: false } } }];
assert.equal((await runOfficialTool('kimi_mew', {})).modelContent, '喵呜～祝你今天开心！', '无参官方函数可以直接调用');
const encryptedMew = '----MOONSHOT ENCRYPTED BEGIN----example----MOONSHOT ENCRYPTED END----';
mewFiber = { status: 'succeeded', context: { encrypted_output: encryptedMew } };
assert.equal((await runOfficialTool('kimi_mew', {})).modelContent, encryptedMew, 'protected 输出原样回灌');
mewFiber = { status: 'failed', context: { output: '不能作为成功结果' } };
assert.equal((await runOfficialTool('kimi_mew', {})).code, 'KIMI_MEW_EXECUTION_FAILED');
mewFunctions = [{ type: 'function', function: { name: 'bad', description: '', parameters: { type: 'object', properties: { invalid: { type: 'nonsense' } } } } }];
const beforeBadMewSchema = officialRequests.length;
assert.equal((await runOfficialTool('kimi_mew', {})).code, 'KIMI_TOOLS_INVALID_SCHEMA');
assert.equal(officialRequests.length, beforeBadMewSchema + 1);
officialResponse = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
const pendingOfficial = runOfficialTool('kimi_web_search', { query: '新闻' });
officialController.abort();
await assert.rejects(pendingOfficial);
const requestsBeforeCancel = officialRequests.length;
await assert.rejects(runOfficialTool('kimi_web_search', { query: '新闻' }));
assert.equal(officialRequests.length, requestsBeforeCancel, '取消后不得继续触网');

database.close();
console.log('联网工具权限、取消、多来源切换、网页读取、密钥隔离、配置竞态、数据库升级，以及 Kimi 官方地址识别、拆包特批、REST 与 mew Formula 协议边界验证通过。');
