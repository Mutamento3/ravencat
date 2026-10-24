/** 配置页的可见选择、普通密钥输入、保存反馈、并发操作与离页取消。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';

const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function load(relative, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    assert.ok(Object.hasOwn(dependencies, id), `未装配依赖：${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}
const domain = load('src/features/webTools/domain/SearchSettings.ts');
let configuration = { defaultEngine: 'bing', allowAdvanced: false,
  sources: domain.SEARCH_SOURCES.map(source => ({ engine: source.engine, enabled: !source.needsKey, configured: !source.needsKey, apiKey: '' })) };
const changes = [];
let releaseTest;
let testSignal;
const Screen = load('src/features/webTools/presentation/WebSearchSettingsScreen.tsx', {
  'react-native': { ActivityIndicator: 'Loading', ScrollView: 'ScrollView', Text: 'Text', TouchableOpacity: 'Action', View: 'View' },
  'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
  'lucide-react-native': { Globe: 'Globe' },
  '@shared/theme': { ThemedSurface: 'Surface', useTheme: () => ({ colors: { brand: { primary: '#123' } } }), useThemedStyles: () => ({}) },
  '@shared/ui': { InputField: 'InputField', KeyboardAvoidingContainer: 'Avoiding', Toggle: 'Toggle', showAppDialog() {} },
  '@shared/ui/NavigationHeader': { default: 'Header', __esModule: true },
  '../domain/SearchSettings': domain,
  './searchSettingsStyles': { createSearchSettingsStyles: () => ({}) },
  '../application/SearchConfiguration': {
    readSearchConfiguration: async () => structuredClone(configuration),
    updateSearchConfiguration: async change => {
      changes.push(change);
      if (change.kind === 'default') configuration.defaultEngine = change.engine;
      if (change.kind === 'advanced') configuration.allowAdvanced = change.allowed;
      if (change.kind === 'enabled') {
        configuration.sources.find(source => source.engine === change.engine).enabled = change.enabled;
        if (!change.enabled && configuration.defaultEngine === change.engine) configuration.defaultEngine = null;
      }
    },
    testAndSaveSearchKey: async (engine, key, signal) => {
      testSignal = signal;
      changes.push({ engine, key });
      await new Promise(resolve => { releaseTest = resolve; });
      signal.throwIfAborted();
      const source = configuration.sources.find(source => source.engine === engine);
      source.configured = true; source.enabled = true; source.apiKey = key; configuration.defaultEngine = engine;
    },
  },
}).default;
let rendered;
await act(async () => { rendered = create(React.createElement(Screen, { onBack() {} })); });
const button = label => rendered.root.findAllByType('Action').find(node => node.props.accessibilityLabel === label);
const field = label => rendered.root.findAllByType('InputField').find(node => node.props.label === label);
const toggle = label => rendered.root.findAllByType('Toggle').find(node => node.props.accessibilityLabel === label);
assert.equal(rendered.root.findByType('Header').props.title, '联网搜索');
assert.ok(rendered.root.findByType('Header').props.help.sections.length > 0);
assert.equal(rendered.root.findAllByType('Avoiding').length, 1);
assert.equal(toggle('允许 AI 使用 Bing').props.value, true);
assert.equal(toggle('允许 AI 使用 Tavily').props.disabled, true);
assert.notEqual(field('Tavily API Key').props.secureTextEntry, true);
assert.notEqual(field('Brave Search API Key').props.secureTextEntry, true);
assert.equal(field('Tavily API Key').props.value, '');
await act(async () => button('将 DuckDuckGo 设为默认').props.onPress());
assert.deepEqual(changes.at(-1), { kind: 'default', engine: 'duckduckgo' });
await act(async () => field('Tavily API Key').props.onChangeText('user-key'));
await act(async () => button('测试并保存').props.onPress());
assert.equal(toggle('允许 AI 使用 Bing').props.disabled, true);
assert.equal(field('Tavily API Key').props.editable, false);
await act(async () => { releaseTest(); });
assert.equal(field('Tavily API Key').props.value, 'user-key', '保存后保留密钥');
assert.equal(toggle('允许 AI 使用 Tavily').props.value, true);
assert.ok(!button('将 Tavily 设为默认'), '显示保存后生效的默认来源');
await act(async () => toggle('允许 Tavily 深度搜索').props.onValueChange(true));
assert.equal(toggle('允许 Tavily 深度搜索').props.value, true);
await act(async () => rendered.unmount());
await act(async () => { rendered = create(React.createElement(Screen, { onBack() {} })); });
assert.equal(field('Tavily API Key').props.value, 'user-key', '重新打开页面回填已保存密钥');
assert.equal(field('Tavily API Key').props.placeholder, '填写 API Key');
await act(async () => toggle('允许 AI 使用 Tavily').props.onValueChange(false));
assert.equal(toggle('允许 AI 使用 Tavily').props.value, false);
assert.equal(field('Tavily API Key').props.value, 'user-key', '禁用来源保留密钥');
assert.ok(rendered.root.findAllByType('Text').some(node => [node.props.children].flat(Infinity).join('') === '默认来源：未选择'));

await act(async () => field('Brave Search API Key').props.onChangeText('another-key'));
await act(async () => button('测试并保存').props.onPress());
await act(async () => rendered.unmount());
assert.equal(testSignal.aborted, true, '离页取消测试请求');
await act(async () => { releaseTest(); });
assert.equal(configuration.sources.find(source => source.engine === 'brave').configured, false);
// 恢复的默认来源可能仍启用，但本机凭据已缺失；用户必须能关闭它。
configuration.defaultEngine = 'tavily';
Object.assign(configuration.sources.find(source => source.engine === 'tavily'), { enabled: true, configured: false, apiKey: '' });
await act(async () => { rendered = create(React.createElement(Screen, { onBack() {} })); });
assert.equal(field('Tavily API Key').props.value, '');
assert.equal(toggle('允许 AI 使用 Tavily').props.disabled, false);
await act(async () => toggle('允许 AI 使用 Tavily').props.onValueChange(false));
assert.equal(toggle('允许 AI 使用 Tavily').props.disabled, true);
await act(async () => rendered.unmount());
console.log('联网搜索页面：顶部说明、来源与默认选择、普通输入、异步反馈、深度开关和离页取消通过。');
