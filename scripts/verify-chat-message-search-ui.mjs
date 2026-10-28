/** 验证用户检索、迟到查询隔离、分页、上下文及路由输入边界。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, Module } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
function load(relative, dependencies) {
  const filename = path.join(root, relative), module = new Module(filename);
  module.filename = filename;
  module.require = id => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id);
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return module.exports;
}
const theme = {
  colors: { background: { screen: 'white' }, surface: { default: 'white' }, text: { primary: 'black', secondary: 'gray' }, brand: { primary: 'blue' }, border: { light: 'gray' }, feedback: { error: 'red' } },
  spacing: { md: 16, sm: 8 }, radius: { lg: 16 },
};
const FlatList = React.forwardRef(function List({ data, renderItem, ListHeaderComponent, ListFooterComponent, ListEmptyComponent }, ref) {
  React.useImperativeHandle(ref, () => ({ scrollToOffset() {} }));
  return React.createElement('List', null, ListHeaderComponent,
    data.length ? data.map(item => React.createElement(React.Fragment, { key: item.messageId }, renderItem({ item }))) : ListEmptyComponent,
    ListFooterComponent);
});
const shared = {
  react: React,
  'react-native': { FlatList, ActivityIndicator: 'ActivityIndicator', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View', Keyboard: { dismiss() {} }, StyleSheet: { create: value => value } },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  '@shared/theme': { useTheme: () => theme, useThemedStyles: factory => factory(theme) },
  '@shared/ui': { AppTextInput: 'AppTextInput', KeyboardAvoidingContainer: 'KeyboardAvoidingContainer', NavigationHeader: 'NavigationHeader' },
  'lucide-react-native': { Search: 'Search', X: 'X' },
};
const record = (id, text = '蓝鲸计划') => ({ messageId: id, conversationId: 'direct', author: { role: 'assistant', name: '助手', assistantId: 'ai' }, text, createdAt: '2026-10-01T00:00:00Z' });
const calls = [], opened = [];
let execute = async () => ({ entries: [record(2)], nextOffset: 20 });
const SearchScreen = load('src/features/chat/presentation/messages/ChatMessageSearchScreen.tsx', {
  ...shared, '../../messages/application/SearchChatMessages': { searchConversationMessages: input => { calls.push(input); return execute(input); } },
}).default;
let view;
const textOf = node => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const button = text => view.root.findAllByType('TouchableOpacity').find(node => textOf(node) === text);
const change = async text => act(async () => { view.root.findByType('AppTextInput').props.onChangeText(text); });
const submit = async () => act(async () => { view.root.findByType('AppTextInput').props.onSubmitEditing(); });
await act(async () => { view = create(React.createElement(SearchScreen, { conversationId: 'direct', onBack() {}, onOpenMessage: id => opened.push(id) })); });
await change('   ');
await submit();
assert.equal(calls.length, 0);
await change(' 蓝鲸 ');
await submit();
assert.deepEqual(calls.at(-1), { conversationId: 'direct', keywords: ['蓝鲸'], offset: 0 });
await act(async () => { view.root.findByProps({ accessibilityLabel: '查看助手的消息上下文' }).props.onPress(); });
assert.deepEqual(opened, [2]);
execute = async () => ({ entries: [record(1)], nextOffset: null });
await act(async () => { button('加载更多').props.onPress(); });
assert.equal(calls.at(-1).offset, 20);
assert.equal(view.root.findAllByProps({ accessibilityLabel: '查看助手的消息上下文' }).length, 2);

let resolveOld;
execute = () => new Promise(resolve => { resolveOld = resolve; });
await change('旧查询');
await submit();
await change('新查询');
execute = async () => ({ entries: [record(3, '新查询命中')], nextOffset: null });
await submit();
await act(async () => { resolveOld({ entries: [record(9, '旧查询不应出现')], nextOffset: null }); });
assert.ok(textOf(view.root).includes('新查询命中'));
assert.ok(!textOf(view.root).includes('旧查询不应出现'));

execute = async () => { throw new Error('数据库读取失败'); };
await change('失败');
await submit();
assert.ok(textOf(view.root).includes('数据库读取失败'));
assert.ok(!textOf(view.root).includes('没有找到相关聊天记录'));
execute = async () => ({ entries: [], nextOffset: null });
await act(async () => { button('重试').props.onPress(); });
assert.ok(textOf(view.root).includes('没有找到相关聊天记录'));
await act(async () => { view.root.findByProps({ accessibilityLabel: '清空关键词' }).props.onPress(); });
assert.equal(view.root.findByType('AppTextInput').props.value, '');
await act(async () => { view.unmount(); });

const contextCalls = [];
const ContextScreen = load('src/features/chat/presentation/messages/ChatMessageContextScreen.tsx', {
  ...shared,
  '../../messages/application/ReadChatMessageContext': { readConversationMessageContext: async (id, input) => {
    contextCalls.push([id, input]);
    return { entries: [record(input.messageId - 1), record(input.messageId), record(input.messageId + 1)], hasMoreBefore: true, hasMoreAfter: true };
  } },
}).default;
await act(async () => { view = create(React.createElement(ContextScreen, { conversationId: 'group', messageId: 10, onBack() {} })); });
assert.deepEqual(contextCalls[0], ['group', { messageId: 10, before: 10, after: 10 }]);
assert.ok(textOf(view.root).includes('搜索结果'));
await act(async () => { button('查看更早的消息').props.onPress(); });
assert.deepEqual(contextCalls.at(-1), ['group', { messageId: 9, before: 20, after: 0 }]);
await act(async () => { button('回到搜索结果').props.onPress(); });
assert.equal(contextCalls.at(-1)[1].messageId, 10);
await act(async () => { button('查看更晚的消息').props.onPress(); });
assert.deepEqual(contextCalls.at(-1), ['group', { messageId: 11, before: 0, after: 20 }]);
await act(async () => { view.unmount(); });

let groupSearchOpened = false;
const GroupOptions = load('src/features/chat/presentation/group/GroupOptions.tsx', {
  ...shared,
  'react-native': { ...shared['react-native'], ScrollView: 'ScrollView', TextInput: 'TextInput' },
  '@shared/ui': { GroupAvatar: 'GroupAvatar', showAppDialog() {} },
  '@shared/ui/NavigationHeader': { __esModule: true, default: 'NavigationHeader' },
  'lucide-react-native': { Camera: 'Camera', ChevronRight: 'ChevronRight', Pencil: 'Pencil' },
  '@platform/device/DeviceMediaService': { PERSISTENT_IMAGE_CATEGORY: { groupAvatar: 'group' }, usePersistentAvatarDraft: () => ({ avatarUri: null }) },
  '../messages/components/ChatWallpaperSettings': { __esModule: true, default: 'ChatWallpaperSettings' },
  './GroupMembersSection': { __esModule: true, default: 'GroupMembersSection' },
}).default;
await act(async () => { view = create(React.createElement(GroupOptions, {
  groupId: 'group', groupDetails: { group: { name: '测试群' }, members: [] }, chatBackgroundKey: 'group:group',
  onSummary() {}, onSearchMessages() { groupSearchOpened = true; },
})); });
await act(async () => { button('搜索聊天记录').props.onPress(); });
assert.equal(groupSearchOpened, true, '群信息中的入口应发出搜索意图');
await act(async () => { view.unmount(); });

for (const kind of ['direct', 'group']) {
  const isGroup = kind === 'group', idKey = isGroup ? 'groupId' : 'aiId';
  const base = isGroup ? 'src/app/chat/groups/[groupId]' : 'src/app/chat/[aiId]';
  const Screen = isGroup ? 'GroupSearchRouteScreen' : 'ChatSearchRouteScreen';
  let params = { [idKey]: [kind] };
  const pushed = [];
  const dependencies = {
    '@features/chat': { [Screen]: Screen },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push: value => pushed.push(value) }), Redirect: 'Redirect' },
  };
  const Route = load(`${base}/search.tsx`, dependencies).default;
  await act(async () => { view = create(React.createElement(Route)); });
  await act(async () => { view.root.findByType(Screen).props.onOpenMessage(42); });
  assert.deepEqual(pushed[0].params, { [idKey]: kind, messageId: 42 });
  assert.ok(pushed[0].pathname.endsWith('/message-context'));
  await act(async () => { view.unmount(); });
  const ContextRoute = load(`${base}/message-context.tsx`, dependencies).default;
  for (const messageId of ['0', '-1', 'abc', '1.5', undefined]) {
    params = { [idKey]: kind, messageId };
    await act(async () => { view = create(React.createElement(ContextRoute)); });
    assert.equal(view.root.findByType('Redirect').props.href, '/conversations');
    await act(async () => { view.unmount(); });
  }
  params = { [idKey]: kind, messageId: ['42'] };
  await act(async () => { view = create(React.createElement(ContextRoute)); });
  assert.equal(view.root.findByType(Screen).props.messageId, 42);
  await act(async () => { view.unmount(); });
}
console.log('用户聊天检索界面通过：输入、分页、过期结果隔离、失败重试、上下文翻页与单聊／群聊路由边界。');
