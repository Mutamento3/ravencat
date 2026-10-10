/** 历史图片加载、回收状态隔离及媒体读取成本回归。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
function load(relativePath, mocks) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', 'console', output)(
    module, module.exports,
    (name) => {
      assert.ok(Object.hasOwn(mocks, name), `未声明的依赖：${name}`);
      return mocks[name];
    },
    { ...console, error() {} },
  );
  return module.exports;
}

const reads = [];
const stats = [];
const assets = new Map([['primary', 'file:///primary'], ['thumb', 'file:///thumb']]);
const resolver = load('src/features/chat/messages/application/ResolveChatAttachmentMedia.ts', {
  '@features/media': {
    async resolveMediaAsset(id) {
      reads.push(id);
      if (!assets.has(id)) throw new Error('媒体缺失');
      return { localUri: assets.get(id) };
    },
  },
  '@platform/device/DeviceMediaService': {
    async getPersistentMediaInfo(uri) {
      stats.push(uri);
      return { exists: uri !== 'file:///missing' };
    },
  },
});
const resolveImage = resolver.resolveChatImageAttachmentUris;
assert.deepEqual(await resolveImage({ mediaAssetId: 'primary' }), {
  previewUri: 'file:///primary', fullSizeUri: 'file:///primary',
});
assert.deepEqual(reads, ['primary'], '没有独立缩略图时只解析一份媒体');
assert.equal(stats.length, 0, '已验证的 MediaAsset 不重复查询文件');
reads.length = 0;
await resolveImage({ mediaAssetId: 'primary', thumbnailMediaAssetId: 'primary' });
assert.deepEqual(reads, ['primary']);
assert.deepEqual(await resolveImage({ mediaAssetId: 'primary', thumbnailMediaAssetId: 'thumb' }), {
  previewUri: 'file:///thumb', fullSizeUri: 'file:///primary',
});
assert.deepEqual(await resolveImage({ mediaAssetId: 'missing', thumbnailMediaAssetId: 'thumb' }), {
  previewUri: 'file:///thumb', fullSizeUri: 'file:///thumb',
});
assert.deepEqual(await resolveImage({ mediaAssetId: 'primary', thumbnailMediaAssetId: 'missing' }), {
  previewUri: 'file:///primary', fullSizeUri: 'file:///primary',
});
assert.equal(await resolveImage({ mediaAssetId: 'missing' }), null);
assert.deepEqual(await resolveImage({ localUri: 'https://example.test/image' }), {
  previewUri: 'https://example.test/image', fullSizeUri: 'https://example.test/image',
});
assert.equal(stats.length, 0, '远程图片交给原生 Image 加载');
assert.deepEqual(await resolveImage({ localUri: 'file:///legacy' }), {
  previewUri: 'file:///legacy', fullSizeUri: 'file:///legacy',
});
assert.deepEqual(stats, ['file:///legacy'], '历史裸 URI 在文件边界检查一次');
assert.equal(await resolveImage({ localUri: 'file:///missing' }), null);

const store = load('src/platform/device/PersistentMediaStore.ts', {
  './MediaFileLifetime': load('src/platform/device/MediaFileLifetime.ts', {}),
  'expo-file-system/legacy': {
    documentDirectory: 'file:///documents/',
    async getInfoAsync(uri, options) {
      assert.notEqual(options?.md5, true, '展示存在性检查不能读取整份文件计算 MD5');
      return { exists: true, isDirectory: false, uri };
    },
  },
});
assert.equal((await store.persistentMediaStore.getInfo('file:///legacy')).exists, true);

// 只模拟 Hook 的生命周期契约，断言真实组件产出的用户界面与异步状态。
const slots = [];
let cursor = 0;
let effects = [];
const sameDeps = (left, right) => left && left.length === right.length
  && left.every((value, index) => Object.is(value, right[index]));
const initial = (value) => typeof value === 'function' ? value() : value;
function useState(value) {
  const index = cursor++;
  if (!slots[index]) {
    const slot = { value: initial(value) };
    slot.set = (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; };
    slots[index] = slot;
  }
  return [slots[index].value, slots[index].set];
}
function useRecyclingState(value, deps) {
  const index = cursor;
  const state = useState(value);
  if (!sameDeps(slots[index].deps, deps)) {
    slots[index].deps = deps;
    slots[index].value = initial(value);
  }
  return [slots[index].value, state[1]];
}
const react = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState,
  useMemo(factory, deps) {
    const index = cursor++;
    if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() };
    return slots[index].value;
  },
  useEffect(effect, deps) {
    const index = cursor++;
    if (!sameDeps(slots[index]?.deps, deps)) {
      const previous = slots[index];
      const next = { deps };
      slots[index] = next;
      effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
    }
  },
};
const pending = new Map();
let requests = 0;
const theme = {
  colors: { icon: { secondary: '#888' }, border: { light: '#ddd' }, text: { secondary: '#888' } },
  radius: { sm: 4 },
};
const Card = load('src/features/chat/presentation/messages/MessageBubble/ImageAttachmentCard.tsx', {
  react,
  'react-native': {
    ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View',
    StyleSheet: { create: (value) => value, absoluteFill: { position: 'absolute' } },
  },
  '@expo/vector-icons': { Ionicons: 'Icon' },
  '@shopify/flash-list': { useRecyclingState },
  '@shared/theme': { useTheme: () => theme, useThemedStyles: (factory) => factory(theme) },
  './ImagePreviewModal': { default: 'Preview', __esModule: true },
  '../../../messages/application/ResolveChatAttachmentMedia': {
    resolveChatImageAttachmentUris(reference) {
      requests += 1;
      return new Promise((resolve) => pending.set(reference.mediaAssetId, resolve));
    },
  },
}).default;
const props = (id) => ({
  attachment: { id, mediaAssetId: id, type: 'image', width: 220, height: 260 }, isMe: true,
});
function render(value) {
  cursor = 0;
  effects = [];
  const tree = Card(value);
  effects.forEach((effect) => effect());
  return tree;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree, type) => nodes(tree).find((node) => node.type === type);
const unavailable = (tree) => nodes(tree).some((node) => node.type === 'Text'
  && node.props.children.includes('图片不可用'));
async function finish(id, uris = { previewUri: id, fullSizeUri: id }) {
  pending.get(id)(uris);
  await Promise.resolve();
}
let tree = render(props('a'));
assert.ok(find(tree, 'ActivityIndicator'));
assert.equal(unavailable(tree), false, '解析期间不能假报图片不可用');
assert.equal(find(tree, 'Image').props.style.height, 260, '占位沿用图片真实尺寸');
await finish('a');
tree = render(props('a'));
assert.equal(find(tree, 'Image').props.source.uri, 'a');
assert.equal(find(tree, 'ActivityIndicator'), undefined);
render({ ...props('a'), attachment: { ...props('a').attachment, parsedText: '识别结果换代' } });
assert.equal(requests, 1, 'metadata 换代不能清空已显示图片或重新解析');
find(tree, 'Pressable').props.onPress();
assert.equal(find(render(props('a')), 'Preview').props.visible, true);
tree = render(props('b'));
assert.equal(find(tree, 'Preview').props.visible, false, '回收后不能继承上一条消息的预览');
assert.equal(find(tree, 'Image').props.source, undefined, '回收后不能显示上一张图');
await finish('b');
assert.equal(find(render(props('b')), 'Image').props.source.uri, 'b');
render(props('c'));
render(props('d'));
await finish('c');
assert.ok(find(render(props('d')), 'ActivityIndicator'), '上一张图的迟到结果不能覆盖当前图');
await finish('d');
assert.equal(find(render(props('d')), 'Image').props.source.uri, 'd');
render(props('missing'));
await finish('missing', null);
tree = render(props('missing'));
assert.equal(unavailable(tree), true, '只有确认无可用媒体后显示不可用');
assert.equal(find(tree, 'Image').props.style.height, 260, '失败状态也不能改变布局高度');
console.log('聊天图片加载与媒体读取回归通过');
