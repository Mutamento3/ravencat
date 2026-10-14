/** 验证分页定位期间停下手势后，FlashList 仍消费最后一个原生位置。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(import.meta.dirname, '..');
const library = path.join(root, 'node_modules/@shopify/flash-list/dist');
const modules = new Map();
const timers = new Map();
let nextTimer = 0;
const native = {
  View: 'View', I18nManager: { isRTL: false },
  PixelRatio: { roundToNearestPixel: (n) => n, getPixelSizeForLayoutSize: (n) => n },
  Animated: { Value: class {}, createAnimatedComponent: (component) => component },
};
const data = Array.from({ length: 80 }, (_, id) => ({ id }));
const observed = [];
const props = { data, keyExtractor: (item) => String(item.id), onScroll: (event) => observed.push(event.nativeEvent.contentOffset.y) };
let manager;
let velocity;
const Scroll = React.forwardRef(function Scroll(props, ref) {
  return React.createElement('Scroller', { ...props, ref });
});
const boundaries = {
  './hooks/useRecyclerViewManager': { useRecyclerViewManager: () => ({ recyclerViewManager: manager, velocityTracker: velocity }) },
  './hooks/useRecyclerViewController': { useRecyclerViewController: () => ({ applyOffsetCorrection() {}, computeFirstVisibleIndexForOffsetCorrection() {}, applyInitialScrollIndex() {}, handlerMethods: {} }) },
  './hooks/useLayoutState': { useLayoutState: React.useState },
  './hooks/useOnLoad': { useOnListLoad() {} },
  './hooks/useBoundDetection': { useBoundDetection: () => ({ checkBounds() {} }) },
  './hooks/useSecondaryProps': { useSecondaryProps: () => ({ CompatScrollView: Scroll }) },
  './RecyclerViewContextProvider': { useRecyclerViewContext: () => null, RecyclerViewContextProvider: ({ children }) => children },
  './ViewHolderCollection': { ViewHolderCollection: () => null },
  './components/StickyHeaders': { StickyHeaders: () => null },
  './components/ScrollAnchor': { ScrollAnchor: () => null },
};
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const requireModule = (name) => {
    if (name === 'react') return React;
    if (name === 'react-native') return native;
    if (file.endsWith('/RecyclerView.js') && Object.hasOwn(boundaries, name)) return boundaries[name];
    assert.ok(name.startsWith('.'), `未声明的列表运行时依赖：${name}`);
    return load(path.resolve(path.dirname(file), `${name}.js`).replaceAll('\\', '/'));
  };
  vm.runInNewContext(source, {
    module, exports: module.exports, require: requireModule, console,
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  return module.exports;
}
const file = (name) => path.join(library, name).replaceAll('\\', '/');
const { RecyclerViewManager } = load(file('recyclerview/RecyclerViewManager.js'));
const { VelocityTracker } = load(file('recyclerview/helpers/VelocityTracker.js'));
const { RecyclerView } = load(file('recyclerview/RecyclerView.js'));
manager = new RecyclerViewManager(props);
velocity = new VelocityTracker();
manager.updateLayoutParams({ width: 400, height: 600 }, 0);
manager.modifyChildrenLayout(data.map((_, index) => ({ index, dimensions: { width: 400, height: 100 } })), data.length);
manager.hasRenderedProgressively = true;
manager.isFirstLayoutComplete = true;
const event = (y) => ({ persisted: false, persist() { this.persisted = true; }, nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 400, height: 8000 }, layoutMeasurement: { width: 400, height: 600 } } });
let renderer;
act(() => { renderer = create(React.createElement(RecyclerView, props)); });
const scroll = (y) => {
  const nativeEvent = event(y);
  act(() => renderer.root.findByType('Scroller').props.onScroll(nativeEvent));
  // RN 在事件派发后回收未 persist 的 SyntheticEvent。
  if (!nativeEvent.persisted) nativeEvent.nativeEvent = null;
};
scroll(3500);
manager.ignoreScrollEvents = true;
scroll(1600);
scroll(1137);
assert.equal(manager.getAbsoluteLastScrollOffset(), 3500, '定位修正期间暂停更新渲染窗口');
assert.deepEqual(observed, [3500], '暂停期间不把中间位置传给消费者');
act(() => {
  // 末次原生滚动和惯性结束都落在定位暂停期间，此后用户不再产生滚动事件。
  for (const callback of [...timers.values()]) callback();
  manager.ignoreScrollEvents = false;
});
assert.equal(manager.getAbsoluteLastScrollOffset(), 1137, '恢复时采用最终原生位置，不等待用户再次滑动');
assert.deepEqual(observed, [3500, 1137], '只消费末次位置，中间事件不重放');
const visible = manager.computeVisibleIndices();
assert.equal(visible.startIndex, 11, '渲染窗口覆盖手机实际停住的消息');
act(() => { manager.ignoreScrollEvents = false; });
assert.deepEqual(observed, [3500, 1137], '已消费的位置不重复发送');
manager.ignoreScrollEvents = true;
scroll(0);
act(() => { manager.ignoreScrollEvents = false; });
assert.equal(manager.getAbsoluteLastScrollOffset(), 0, '列表顶部的零位置也必须保留');
manager.ignoreScrollEvents = true;
scroll(400);
act(() => renderer.unmount());
manager.dispose();
manager.ignoreScrollEvents = false;
assert.deepEqual(observed, [3500, 1137, 0], '列表销毁后不再重放它持有的滚动事件');
velocity.cleanUp();
console.log('Chat scroll settle verification passed.');
