/** 真实 React 生命周期验证：图片暂存态、刷新复用、封面更新与旧请求隔离。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(import.meta.dirname, '..');
function load(relative, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `缺少依赖：${name}`);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const pending = new Map();
const reads = [];
const MediaImage = load('src/features/moments/presentation/MomentMediaImage.tsx', {
  react: React,
  'react-native': {
    ActivityIndicator: 'Spinner', Image: 'Image', Text: 'Text', View: 'View',
    StyleSheet: { create: (styles) => styles, absoluteFillObject: {} },
  },
  '@shared/theme': { useTheme: () => ({ colors: { brand: { primary: '#123' }, text: { secondary: '#456' } } }) },
  '@features/media': { resolveMediaAsset: (id) => {
    reads.push(id);
    const request = deferred();
    pending.set(id, request);
    return request.promise;
  } },
}).default;
const renderImage = (id) => React.createElement(MediaImage, { mediaAssetId: id, style: {}, resizeMode: 'cover' });
let renderer;
await act(async () => { renderer = create(renderImage('first')); });
assert.equal(renderer.root.findAllByType('Spinner').length, 1, '文件解析期间有占位');
await act(async () => { pending.get('first').resolve({ localUri: 'file:///first.jpg' }); });
assert.equal(renderer.root.findByType('Image').props.source.uri, 'file:///first.jpg');
assert.equal(renderer.root.findAllByType('Spinner').length, 1, '文件解析完成仍等待原生图片解码');
await act(async () => { renderer.root.findByType('Image').props.onLoad(); });
assert.equal(renderer.root.findAllByType('Spinner').length, 0);
await act(async () => { renderer.update(renderImage('first')); });
assert.deepEqual(reads, ['first'], '刷新其他事实不能重新解析同一图片');

await act(async () => { renderer.update(renderImage('old')); });
await act(async () => { renderer.update(renderImage('new')); });
await act(async () => { pending.get('old').resolve({ localUri: 'file:///old.jpg' }); });
assert.equal(renderer.root.findAllByType('Image').length, 0, '旧请求返回不能覆盖新资产');
assert.equal(renderer.root.findAllByType('Spinner').length, 1);
await act(async () => { pending.get('new').resolve({ localUri: 'file:///new.jpg' }); });
await act(async () => { renderer.root.findByType('Image').props.onError(); });
assert.equal(renderer.root.findAllByType('Spinner').length, 0, '原生解码失败结束暂存态');
assert.equal(renderer.root.findByType('Text').children.join(''), '图片不可用');
assert.equal(renderer.root.findAllByType('Image').length, 0);
await act(async () => { renderer.unmount(); });

// 资源缺失在展示边界终结，不能让加载指示器永久转动。
await act(async () => { renderer = create(renderImage('missing')); });
const warn = console.warn;
try {
  console.warn = () => {};
  await act(async () => { pending.get('missing').reject(new Error('backing missing')); });
} finally { console.warn = warn; }
assert.equal(renderer.root.findAllByType('Spinner').length, 0);
assert.equal(renderer.root.findByType('Text').children.join(''), '图片不可用');
await act(async () => { renderer.unmount(); });

// 首次读取之前已经处于加载态，焦点刷新保留旧列表。
let pageRequest = deferred();
const useMoments = load('src/features/moments/presentation/useMoments.ts', {
  react: React,
  '@features/profile': { SELF_USER_PROFILE_ID: 'self' },
  '../presentationFacade': {
    getCurrentMomentUserProfile: async () => ({ id: 'self', name: '用户' }),
    listMomentRecords: () => pageRequest.promise,
  },
  '../application/MomentMediaAnalysis': { subscribeMomentMediaAnalysisUpdated: () => () => {} },
}).default;
let state;
function Probe() { state = useMoments(); return null; }
await act(async () => { renderer = create(React.createElement(Probe)); });
assert.equal(state.initialLoading, true, '首次渲染不闪出空列表');
let loading;
await act(async () => { loading = state.loadMoments(); });
const firstPage = [{ id: 'moment-1', createdAt: '2026-10-07', media: [] }];
await act(async () => { pageRequest.resolve(firstPage); await loading; });
assert.equal(state.initialLoading, false);
assert.deepEqual(state.moments, firstPage);
pageRequest = deferred();
await act(async () => { loading = state.reloadLoadedMoments(); });
assert.equal(state.refreshing, true);
assert.equal(state.initialLoading, false);
assert.deepEqual(state.moments, firstPage, '刷新等待期间保留已有内容');
await act(async () => { pageRequest.resolve(firstPage); await loading; });
await act(async () => { renderer.unmount(); });

// 保活页面刷新动态或导航回调时，已显示的封面不能退回默认图或重新读取。
const profileListeners = new Set();
const initialCoverRead = deferred();
let profileReads = 0;
const coverController = load('src/features/moments/presentation/useMomentsCover.ts', {
  react: React,
  '@shared/ui': {},
  'react-native': {},
  'expo-image-picker': {},
  '@platform/device/DeviceMediaService': {},
  '../../../../assets/ravenphone_bg.png': 'default-cover',
  '@features/profile': {
    DEFAULT_USER_PROFILE: { name: '用户', avatar: null, momentsCover: null, momentsCoverMediaAssetId: null },
    getCurrentUserProfile: () => { profileReads++; return initialCoverRead.promise; },
    subscribeUserProfileUpdated: listener => {
      profileListeners.add(listener);
      return () => { profileListeners.delete(listener); };
    },
  },
});
const theme = {
  colors: {
    background: { app: '#fff', screen: '#fff' }, surface: { default: '#fff' },
    text: { secondary: '#666', tertiary: '#999' }, brand: { primary: '#123', onPrimary: '#fff' },
    icon: { primary: '#123' },
  },
  effects: { glass: { enabled: false } }, spacing: { sm: 4, lg: 16, xl: 24 },
  radius: { sm: 4 }, shadow: { md: {} },
};
const nativeUI = {
  ActivityIndicator: 'Spinner', ImageBackground: 'CoverImage', Text: 'Text',
  TouchableOpacity: 'Button', View: 'View', StyleSheet: { create: styles => styles },
};
const Header = load('src/features/moments/presentation/MomentsHeader.tsx', {
  react: React, 'react-native': nativeUI,
  '@expo/vector-icons': { Ionicons: 'Icon' }, '@shared/ui': { UserAvatar: 'Avatar' },
  '@shared/ui/NavigationHeader': 'NavigationHeader',
  '@shared/theme': { useTheme: () => theme },
  './MomentsCoverPreviewModal': 'CoverPreview',
  './useMomentsCover': coverController,
}).default;
// 复用 FlatList 的公开契约：元素直接渲染，组件类型通过 React 创建实例。
function FlatList({ ListHeaderComponent }) {
  return React.isValidElement(ListHeaderComponent)
    ? ListHeaderComponent
    : React.createElement(ListHeaderComponent);
}
const noop = () => {};
let timelineReloads = 0;
const timeline = {
  moments: [{ id: 'moment-1' }], initialLoading: false, refreshing: false,
  loadingMore: false, hasMoreMoments: false, currentUserId: 'self',
  loadMoments: noop, loadMoreMoments: noop, reloadLoadedMoments: () => { timelineReloads++; },
};
const Tab = load('src/features/moments/presentation/MomentsTab.tsx', {
  react: React, 'react-native': { ...nativeUI, FlatList },
  '@shared/ui': {}, 'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
  '@shared/theme': { useTheme: () => theme }, './useMoments': () => timeline,
  './MomentItem': 'MomentItem', './MomentsHeader': Header,
  './momentActionFeedback': {},
}).default;
const renderTab = revision => React.createElement(Tab, {
  refreshRevision: revision, onPublishPress: () => {}, onSettingsPress: () => {},
});
await act(async () => { renderer = create(renderTab(0)); });
assert.equal(renderer.root.findByType('CoverImage').props.source, 'default-cover');
await act(async () => {
  initialCoverRead.resolve({ name: '用户', avatar: null, momentsCover: 'file:///cover.jpg', momentsCoverMediaAssetId: 'cover' });
});
const loadedCoverSource = renderer.root.findByType('CoverImage').props.source;
assert.deepEqual(loadedCoverSource, { uri: 'file:///cover.jpg' });
await act(async () => { renderer.update(renderTab(1)); });
await act(async () => { renderer.update(renderTab(2)); });
assert.equal(timelineReloads, 2, '切回页面仍刷新动态');
assert.equal(profileReads, 1, '切回页面不能重新读取封面资料');
assert.deepEqual(renderer.root.findByType('CoverImage').props.source, loadedCoverSource, '切回页面保留已显示的图片来源');
await act(async () => { renderer.update(renderTab(2)); });
assert.equal(profileReads, 1, '导航回调变化不能重挂载封面');
await act(async () => {
  for (const listener of profileListeners) listener({ name: '新名称', avatar: null, momentsCover: 'file:///new-cover.jpg', momentsCoverMediaAssetId: 'new-cover' });
});
assert.deepEqual(renderer.root.findByType('CoverImage').props.source, { uri: 'file:///new-cover.jpg' }, '已提交的新封面即时显示');
assert.equal(renderer.root.findByType('Avatar').props.name, '新名称');
await act(async () => {
  for (const listener of profileListeners) listener({ name: '新名称', avatar: null, momentsCover: null, momentsCoverMediaAssetId: null });
});
assert.equal(renderer.root.findByType('CoverImage').props.source, 'default-cover', '恢复默认封面即时同步');
await act(async () => { renderer.unmount(); });
assert.equal(profileListeners.size, 0, '封面卸载后解除资料订阅');
console.log('Moments 图片加载状态 / 首屏暂存态 / 保活封面复用与更新验证通过。');
