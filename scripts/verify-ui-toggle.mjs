/** 验证开关的受控状态、异步确认、禁用契约及玻璃主题可见性。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const { act, create } = require('react-test-renderer');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function load(file, dependencies = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`缺少测试依赖 ${name}`);
  }, module, module.exports);
  return module.exports;
}

// 动画替身立即到达终点，只检查展示结果，不锁定生产代码的动画调用顺序。
class AnimatedValue {
  constructor(value) { this.value = value; }
  interpolate({ inputRange, outputRange }) {
    return { current: () => outputRange[0] + (this.value - inputRange[0]) / (inputRange[1] - inputRange[0]) * (outputRange[1] - outputRange[0]) };
  }
}
const native = {
  View: 'View', Text: 'Text', Pressable: 'Pressable',
  StyleSheet: { create: (styles) => styles, absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
  Animated: { View: 'AnimatedView', Value: AnimatedValue, timing: (value, config) => ({ start: () => { value.value = config.toValue; }, stop: () => {} }) },
};
const themes = ['defaultLight', 'defaultDark', 'liquidGlass', 'moonKimi', 'paperNote'].map((name) =>
  Object.values(load(`src/shared/theme/themes/${name}.ts`))[0]);
let theme = themes[0];
const themed = { useThemedStyles: (factory) => factory(theme) };
const toggleModule = load('src/shared/ui/Toggle.tsx', { 'react-native': native, '@shared/theme': themed });
const Toggle = toggleModule.default;
const ToggleField = load('src/shared/ui/ToggleField.tsx', { 'react-native': native, '@shared/theme': themed, './Toggle': toggleModule }).default;
let renderer;
const control = () => renderer.root.findByType('Pressable');
const checked = () => control().props.accessibilityState.checked;
const changes = [];
let accept;
function DeferredField() {
  const [value, setValue] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  return React.createElement(ToggleField, {
    label: '启用配置', hint: '由页面确认保存结果', value, disabled: pending,
    onValueChange: (next) => { changes.push(next); setPending(true); accept = (success) => { if (success) setValue(next); setPending(false); }; },
  });
}
await act(async () => { renderer = create(React.createElement(DeferredField)); });
assert.equal(control().props.accessibilityRole, 'switch');
assert.equal(control().props.accessibilityLabel, '启用配置');
await act(async () => { control().props.onPress(); });
assert.deepEqual(changes, [true]);
assert.equal(checked(), false, '等待保存或确认期间不擅自显示开启');
assert.equal(control().props.disabled, true);
assert.equal(control().props.accessibilityState.disabled, true);
await act(async () => { accept(false); });
assert.equal(checked(), false, '取消确认或保存失败保留原状态');
assert.equal(control().props.disabled, false);
await act(async () => { control().props.onPress(); accept(true); });
assert.equal(checked(), true, '页面接受后展示开启');
await act(async () => { control().props.onPress(); });
assert.equal(checked(), true, '关闭也由页面确认');
await act(async () => { accept(true); });
assert.equal(checked(), false);
assert.deepEqual(changes, [true, true, false]);
await act(async () => { renderer.unmount(); });

const flatten = (style) => Object.assign({}, ...[style].flat().filter(Boolean));
for (theme of themes) {
  const props = { accessibilityLabel: '主题开关', onValueChange: () => {} };
  await act(async () => { renderer = create(React.createElement(Toggle, { ...props, value: false })); });
  const offTrack = renderer.root.findAllByType('View').map((node) => flatten(node.props.style)).find((style) => style.backgroundColor);
  const animatedStyles = () => renderer.root.findAllByType('AnimatedView').map((node) => flatten(node.props.style));
  const thumb = animatedStyles().find((style) => style.transform);
  assert.match(offTrack.backgroundColor, /^#[\da-f]{6}$/i, `${theme.id} 关闭轨道不透明`);
  assert.match(offTrack.borderColor, /^#[\da-f]{6}$/i, `${theme.id} 关闭轮廓不透明`);
  assert.match(thumb.backgroundColor, /^#[\da-f]{6}$/i, `${theme.id} 滑块不透明`);
  assert.notEqual(offTrack.backgroundColor, thumb.backgroundColor, '关闭状态滑块与轨道可区分');
  const offPosition = thumb.transform[0].translateX.current();
  await act(async () => { renderer.update(React.createElement(Toggle, { ...props, value: true })); });
  assert.equal(checked(), true);
  const onThumb = animatedStyles().find((style) => style.transform);
  assert.ok(onThumb.transform[0].translateX.current() > offPosition, '开启后滑块移向右侧');
  assert.ok(animatedStyles().some((style) => style.backgroundColor === theme.colors.brand.primary && style.opacity.value === 1));
  await act(async () => { renderer.update(React.createElement(Toggle, { ...props, value: false, disabled: true })); });
  assert.equal(checked(), false, '外部状态更新同步到开关');
  assert.equal(control().props.disabled, true);
  await act(async () => { renderer.unmount(); });
}
console.log('统一开关验证通过：异步保存、取消确认、外部状态更新、禁用及五个主题的可见性。');
