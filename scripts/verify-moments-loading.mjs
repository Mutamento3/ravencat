/** 真实 React 生命周期验证：图片暂存态、解码失败、刷新复用与旧请求隔离。 */
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
console.log('Moments 图片加载状态 / 刷新复用 / 首屏暂存态验证通过。');
