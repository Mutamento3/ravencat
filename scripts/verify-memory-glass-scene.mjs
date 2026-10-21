/** 验证记忆面板采样当前页面、场景隔离、交互可达性与普通主题表现。 */
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
    if (Object.hasOwn(dependencies, name)) {
      const dependency = dependencies[name];
      return Object.hasOwn(dependency, 'default') ? { __esModule: true, ...dependency } : dependency;
    }
    throw new Error(`缺少测试依赖 ${name}`);
  }, module, module.exports);
  return module.exports;
}

class AnimatedValue {
  constructor(value) { this.value = value; }
  stopAnimation() {}
}
const native = {
  View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal', TouchableOpacity: 'TouchableOpacity', TouchableWithoutFeedback: 'TouchableWithoutFeedback', FlatList: 'FlatList',
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
  StyleSheet: { create: styles => styles, absoluteFill: { position: 'absolute', inset: 0 }, absoluteFillObject: { position: 'absolute', inset: 0 }, hairlineWidth: 0.5 },
  Animated: {
    Value: AnimatedValue, View: 'AnimatedView',
    timing: (value, { toValue }) => ({ start: () => { value.value = toValue; } }),
    parallel: animations => ({ start: callback => { animations.forEach(animation => animation.start()); callback?.({ finished: true }); }, stop() {} }),
  },
};
const glass = { LiquidGlassBackdrop: 'NativeBackdrop', LiquidGlassEffect: 'NativeGlass' };
const scene = load('src/shared/theme/components/GlassScene.tsx', { '../../../../modules/liquid-glass': glass });
const themes = Object.fromEntries(['defaultLight', 'defaultDark', 'liquidGlass'].map(name => {
  const theme = Object.values(load(`src/shared/theme/themes/${name}.ts`))[0];
  return [theme.id, theme];
}));
let theme = themes['liquid-glass'];
const themed = { ...scene, useTheme: () => theme, useThemedStyles: factory => factory(theme), getThemeById: id => themes[id] };
const surface = load('src/shared/theme/components/GlassSurface.tsx', {
  'react-native-reanimated': { default: { createAnimatedComponent: component => component } },
  'react-native': native, '../../../../modules/liquid-glass': glass, '../useTheme': themed, './GlassScene': scene,
});
Object.assign(themed, load('src/shared/theme/components/ThemedSurface.tsx', {
  'react-native': native, '../useTheme': themed, './GlassSurface': surface,
}));
const safeArea = { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) };
native.Modal = function Modal(props) {
  React.useEffect(() => { props.onShow?.(); }, []);
  return props.visible ? React.createElement('Modal', props, props.children) : null;
};
const ModalSheet = load('src/shared/ui/ModalSheet.tsx', {
  'react-native': native, '@shared/theme': themed, 'react-native-safe-area-context': safeArea,
  './KeyboardAvoidingContainer': { default: 'KeyboardAvoidingContainer' },
}).default;
const styles = load('src/features/memory/presentation/memoryGalaxyStyles.ts', { 'react-native': native, '@shared/theme': themed });
const icons = Object.fromEntries(['Check', 'ChevronRight', 'Plus', 'Search', 'X', 'ChevronLeft', 'Settings2'].map(name => [name, name]));
const commands = { selectMemorySpace: async () => {}, addMemoryTrigger: async () => {} };
const ui = { ModalSheet, Toggle: 'Toggle', AppTextInput: 'AppTextInput', showAppDialog: () => {} };
const Panel = load('src/features/memory/presentation/MemorySpacePanel.tsx', {
  'react-native': native, 'lucide-react-native': icons, '@shared/ui': ui, '@shared/theme': themed,
  '../domain/Memory': { normalizeMemoryText: text => text.trim(), memorySearchText: entry => entry.content },
  '../application/MemoryCommands': commands, './memoryGalaxyStyles': styles,
}).default;
const snapshot = {
  spaces: [{ assistantId: 'assistant-1', assistantName: '测试星球', poolId: 'pool-1' }],
  selectedSpace: { assistantId: 'assistant-1', assistantName: '测试星球', poolId: 'pool-1' },
  entries: [], triggers: [],
};
const Screen = load('src/features/memory/presentation/MemoryScreen.tsx', {
  'react-native': native, 'react-native-safe-area-context': safeArea, 'lucide-react-native': icons,
  'expo-router': { useFocusEffect: callback => React.useEffect(callback, [callback]) },
  'react-native-reanimated': { useReducedMotion: () => true }, '@shared/ui': ui, '@shared/theme': themed,
  '../application/MemoryCommands': commands, './memoryGalaxyStyles': styles,
  './GalaxyBackground': { default: 'GalaxyBackground' }, './MemoryGalaxy': { default: 'MemoryGalaxy' },
  './MemorySpacePanel': { default: Panel }, './ShootingStar': { default: 'ShootingStar' }, './SplashOverlay': { default: () => null },
  './useMemoryManagementSnapshot': { default: () => ({ snapshot, error: null, refreshing: false, refresh() {} }) },
}).default;
const props = { onBack() {}, onOpenSettings() {}, onCreateMemory() {}, onEditMemory() {}, onOpenTrigger() {} };
const flatten = style => Object.assign({}, ...[style].flat().filter(Boolean));

let renderer;
await act(async () => { renderer = create(React.createElement(scene.GlassBackdrop, { sceneId: 'decorative' }, '背景')); });
assert.equal(renderer.root.findByType('NativeBackdrop').props.pointerEvents, 'none', '装饰背景保持触摸穿透');
assert.equal(renderer.root.findByType('NativeBackdrop').props.importantForAccessibility, 'no-hide-descendants');
await act(async () => { renderer.unmount(); });

for (theme of Object.values(themes)) {
  await act(async () => { renderer = create(React.createElement(Screen, props)); });
  const layout = renderer.root.findAllByType('View').find(node => node.props.onLayout);
  await act(async () => { layout.props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }); });
  const source = renderer.root.findAllByType('NativeBackdrop')[0];
  if (theme.effects.glass.enabled) {
    assert.notEqual(source.props.sceneId, 'app', '记忆页独立于全局壁纸');
    assert.equal(source.props.pointerEvents, 'auto');
    assert.equal(source.props.accessibilityElementsHidden, false);
    assert.equal(source.props.importantForAccessibility, 'auto');
    source.findByType('GalaxyBackground');
    source.findByType('MemoryGalaxy');
  } else {
    assert.equal(source, undefined, '普通主题不注册玻璃背景源');
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await act(async () => { renderer.root.findByType('MemoryGalaxy').props.onSelect('assistant-1'); });
    assert.equal(renderer.root.findByType('MemoryGalaxy').props.paused, true);
    if (source) {
      const effect = renderer.root.findByType('NativeGlass');
      assert.equal(effect.props.sceneId, source.props.sceneId, '每次打开均采样当前记忆页');
      for (let ancestor = effect.parent; ancestor; ancestor = ancestor.parent) {
        assert.notEqual(ancestor, source, '弹窗不得进入自身的采样源');
      }
      assert.equal(flatten(renderer.root.findAllByType('Text').find(node => node.props.children === '测试星球').props.style).color, themes['default-dark'].colors.text.primary);
      assert.equal(renderer.root.findByType('AppTextInput').props.placeholderTextColor, themes['default-dark'].colors.text.secondary);
    } else {
      assert.equal(renderer.root.findAllByType('NativeGlass').length, 0);
      assert.equal(flatten(renderer.root.findAllByType('Text').find(node => node.props.children === '测试星球').props.style).color, theme.colors.text.primary);
    }
    await act(async () => { renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === '收起记忆面板').props.onPress(); });
    assert.equal(renderer.root.findAllByType('Modal').length, 0);
  }
  if (source) {
    let second;
    await act(async () => { second = create(React.createElement(Screen, props)); });
    assert.notEqual(second.root.findByType('NativeBackdrop').props.sceneId, source.props.sceneId, '多个页面实例不能串场景');
    await act(async () => { second.unmount(); });
  }
  await act(async () => { renderer.unmount(); });
}
console.log('记忆玻璃场景验证通过：当前页面采样、开关面板、交互与无障碍、实例隔离及普通主题。');
