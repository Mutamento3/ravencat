import { agentToolSchemaDependencies } from './helpers/agent-tool-schema-dependencies.mjs';
/** 联网工具的公开参数、结果、权限、拆包与取消行为验证。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
const native = {
  createRequest: () => 'request-1',
  cancelRequest: (id) => calls.push(['cancel', id]),
  search: async (...args) => { calls.push(['search', ...args]); return pending ?? nativeResult; },
  readPage: async (...args) => { calls.push(['read', ...args]); return nativeResult; },
  download: async (...args) => { calls.push(['download', ...args]); return nativeResult; },
  downloadImage: async (...args) => { calls.push(['image', ...args]); return pending ?? nativeResult; },
};
const web = load('src/platform/web/WebTools.ts', {
  expo: { requireNativeModule: () => native },
  'expo-file-system': { File: class { constructor(uri) { this.uri = uri; } delete() { calls.push(['delete-temp', this.uri]); } } },
  '@shared/runtime/abortSignal': load('src/shared/runtime/abortSignal.ts'),
});
const tools = load('src/features/webTools/application/WebAgentTools.ts', { '@platform/web': web });
const { AgentToolRegistry } = load('src/platform/agentRuntime/AgentToolRegistry.ts');
const schema = load('src/shared/aiTools/AgentToolInputSchema.ts', agentToolSchemaDependencies);
const { AgentToolExecutor } = load('src/platform/agentRuntime/AgentToolExecutor.ts', { '@shared/aiTools': schema });
const placeholder = (name) => ({ name, definition: { name, description: name, parameters: { type: 'object' } }, execute: async () => ({ success: true }) });
const proxy = new Proxy({}, { get: (_, name) => placeholder(String(name)) });
let defaults = {};
let overrides = [];
const featureNames = ['protocol', 'moments', 'wallet', 'calls', 'memory', 'deviceControl', 'companion', 'phoneTools', 'screenCapture', 'chat', 'stickers', 'togetherListening'];
const registration = load('src/host/composition/agent/createAgentToolRegistry.ts', {
  '@features/media': proxy,
  './assertImageToolRunCurrent': { assertImageToolRunCurrent: () => {} },
  ...Object.fromEntries(featureNames.map((name) => [`@features/${name}`, proxy])),
  '@features/webTools': tools,
  '@features/prompting': { readPromptDefaults: async () => ({ toolPermissions: defaults }) },
  '@features/assistants': new Proxy({ assistantToolPermissionRepository: { list: async () => overrides }, createChangeOwnAvatarTool: () => placeholder('change_own_avatar') }, {
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
assert.deepEqual(result.data, nativeResult.data);
assert.ok(result.modelContent.includes('https://example.com'));
assert.deepEqual(calls.at(-1), ['search', 'request-1', '资料', 5]);
assert.equal(executor.prepare({ name: 'web_search', arguments: '{"query":" "}' }, task).status, 'rejected');
assert.equal(executor.prepare({ name: 'web_search', arguments: '{"query":"资料","limit":11}' }, task).status, 'rejected');
assert.equal(executor.prepare({ name: 'download_file', arguments: '{"url":"https://example.com","directory":"/other"}' }, task).status, 'rejected');

nativeResult = { ok: true, data: { text: '正文', truncated: true } };
assert.equal((await execute('web_fetch', { url: 'https://example.com' })).data.truncated, true);
assert.deepEqual(calls.at(-1), ['read', 'request-1', 'https://example.com', 12000]);
nativeResult = { ok: true, data: { fileName: '报告-unique.pdf', directory: 'Download/RavenCat AI/', uri: 'content://downloads/1', sizeBytes: 123 } };
const downloaded = await execute('download_file', { url: 'https://example.com/report.pdf' });
assert.equal(downloaded.data.directory, 'Download/RavenCat AI/');
assert.ok(downloaded.modelContent.includes('报告-unique.pdf'));
assert.deepEqual(calls.at(-1), ['download', 'request-1', 'https://example.com/report.pdf', null]);
nativeResult = { ok: false, error: { code: 'WEB_SEARCH_UNAVAILABLE', message: '来源不可用' } };
assert.deepEqual(await execute('web_search', { query: '资料' }), {
  status: 'error', code: 'WEB_SEARCH_UNAVAILABLE', retryable: false, modelContent: '来源不可用',
});

const cancelled = new AbortController();
cancelled.abort(new Error('已取消'));
const count = calls.length;
await assert.rejects(web.searchWeb('资料', 5, cancelled.signal), /已取消/u);
assert.equal(calls.length, count);
let resolvePending;
pending = new Promise((resolve) => { resolvePending = resolve; });
const running = new AbortController();
const operation = web.searchWeb('资料', 5, running.signal);
running.abort(new Error('运行取消'));
assert.deepEqual(calls.at(-1), ['cancel', 'request-1']);
resolvePending({ ok: true, data: {} });
await assert.rejects(operation, /运行取消/u);
const completed = new AbortController();
pending = undefined;
await web.searchWeb('资料', 5, completed.signal);
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
console.log('联网工具参数、结果、普通 AI 权限、拆包与取消行为验证通过。');
