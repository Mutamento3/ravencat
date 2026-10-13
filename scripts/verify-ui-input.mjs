/** 公共输入契约：受控草稿、原生焦点、显式密码模式和窗口键盘监听生命周期。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(import.meta.dirname, '..');
function load(file, dependencies) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((id) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    throw new Error(`未装配的输入验证依赖 ${id}`);
  }, module, module.exports);
  return module.exports;
}
const listeners = new Map();
let visible = false;
const native = {
  TextInput: 'Input', Text: 'Text', View: 'View', KeyboardAvoidingView: 'Avoiding',
  StyleSheet: { create: (styles) => styles },
  Keyboard: {
    isVisible() { assert.equal(this, native.Keyboard); return visible; },
    addListener(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      const subscriptions = listeners.get(event);
      subscriptions.add(callback);
      return { remove() { subscriptions.delete(callback); if (!subscriptions.size) listeners.delete(event); } };
    },
  },
};
const theme = { colors: { text: { primary: '#111', secondary: '#444', tertiary: '#777' }, surface: { input: '#eee' }, feedback: { error: '#f00' } },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, radius: { md: 8 } };
const dependencies = { 'react-native': native, '@shared/theme': { useTheme: () => theme, useThemedStyles: (factory) => factory(theme) } };
const inputModule = load('src/shared/ui/AppTextInput.tsx', dependencies);
const Input = inputModule.default;
const Field = load('src/shared/ui/InputField.tsx', { ...dependencies, './AppTextInput': inputModule }).default;
const Container = load('src/shared/ui/KeyboardAvoidingContainer.tsx', dependencies).default;
let rendered;

// 页面仍拥有草稿；输入控件转发编辑和原生焦点，不因父组件更新重建原生输入。
const ref = React.createRef();
const inputNative = { focused: false, focus() { this.focused = true; }, blur() { this.focused = false; } };
const changes = [];
function Editor({ enabled = true }) {
  const [value, setValue] = React.useState('第一行');
  return React.createElement(Container, { enabled }, React.createElement(Input, {
    ref, value, autoGrow: true, onChangeText: (text) => { changes.push(text); setValue(text); },
  }));
}
await act(async () => { rendered = create(React.createElement(Editor), { createNodeMock: (element) => element.type === 'Input' ? inputNative : null }); });
ref.current.focus();
await act(async () => rendered.root.findByType('Input').props.onChangeText('第一行\n第二行'));
assert.deepEqual(changes, ['第一行\n第二行']);
assert.equal(rendered.root.findByType('Input').props.value, '第一行\n第二行');
assert.equal(rendered.root.findByType('Input').props.multiline, true);
assert.equal(ref.current, inputNative);
assert.equal(ref.current.focused, true);
for (let cycle = 0; cycle < 3; cycle++) {
  visible = true;
  await act(async () => { for (const listener of listeners.get('keyboardDidShow')) listener(); });
  assert.equal(rendered.root.findByType('Avoiding').props.enabled, true);
  visible = false;
  await act(async () => { for (const listener of listeners.get('keyboardDidHide')) listener(); });
  assert.equal(rendered.root.findByType('Avoiding').props.enabled, false);
  assert.equal(rendered.root.findByType('Input').props.value, '第一行\n第二行');
}
await act(async () => rendered.update(React.createElement(Editor, { enabled: false })));
assert.equal(listeners.size, 0, '窗口关闭后释放键盘监听');
visible = true;
await act(async () => rendered.update(React.createElement(Editor)));
assert.equal(rendered.root.findByType('Avoiding').props.enabled, true, '接入已经打开键盘的窗口时读取当前状态');
await act(async () => rendered.unmount());
assert.equal(listeners.size, 0, '窗口卸载后释放键盘监听');
assert.equal(ref.current, null);

// 字段名称不是密码语义；只有调用方明确声明的敏感输入才遮蔽。
await act(async () => { rendered = create(React.createElement(Field, { label: 'API Key', value: 'key', autoGrow: true, onChangeText() {} })); });
assert.notEqual(rendered.root.findByType('Input').props.secureTextEntry, true);
await act(async () => rendered.update(React.createElement(Input, { value: 'token', secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false, onChangeText() {} })));
assert.equal(rendered.root.findByType('Input').props.secureTextEntry, true);
assert.equal(rendered.root.findByType('Input').props.multiline, false);
await act(async () => rendered.update(React.createElement(Input, { value: '13', keyboardType: 'number-pad', submitBehavior: 'submit', onChangeText() {} })));
assert.equal(rendered.root.findByType('Input').props.keyboardType, 'number-pad');
assert.equal(rendered.root.findByType('Input').props.submitBehavior, 'submit');
await act(async () => rendered.unmount());
console.log('verify-ui-input: 输入草稿、原生 ref、密码语义、键盘反复开合及窗口监听生命周期通过。');
