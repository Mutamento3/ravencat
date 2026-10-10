/** 思维链按消息隔离展开状态、流式更新与回收后的尺寸回归。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '..');
const fromRepo = createRequire(path.join(root, 'package.json'));
const ts = fromRepo('typescript');
const React = fromRepo('react');
const { create, act } = fromRepo('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
function load(file, mocks = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output)(module, module.exports, (name) => {
    assert.ok(Object.hasOwn(mocks, name), `未声明依赖：${name}`);
    return mocks[name];
  });
  return module.exports;
}
// 渲染视觉边界使用占位组件，React 和 FlashList 的状态 Hook 使用真实实现。
let layouts = 0;
const recyclerContext = { layout: () => { layouts++; } };
const { useLayoutState } = load('node_modules/@shopify/flash-list/src/recyclerview/hooks/useLayoutState.ts', {
  react: React,
  '../RecyclerViewContextProvider': { useRecyclerViewContext: () => recyclerContext },
});
const { useRecyclingState } = load('node_modules/@shopify/flash-list/src/recyclerview/hooks/useRecyclingState.ts', {
  react: React, './useLayoutState': { useLayoutState },
});
const flash = { useRecyclingState };
let theme = load('src/shared/theme/themes/defaultLight.ts').defaultLightTheme;
const themeApi = {
  useTheme: () => theme,
  isMoonKimiTheme: (value) => value.id === 'moon-kimi',
  isPaperNoteTheme: (value) => value.id === 'paper-note',
  GlassSurface: 'GlassSurface',
};
const native = { View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: (value) => value, hairlineWidth: 1 } };
const styles = { createMessageBubbleStyles: () => ({}) };
const contents = {
  BubbleAttachmentList: 'Attachments', BubbleTextContent: 'Body', TranslationBlock: 'Translation',
  COMMON_PLAIN_TEXT_STYLE: {}, MOON_KIMI_AI_PARAGRAPH_SPACING: 1,
  createMarkdownStylePreset: () => ({}), getBubbleVariant: () => 'reasoning',
  shouldRenderMarkdownText: () => false, shouldUseWideMarkdownLayout: () => false,
};
const defaultStub = (name) => ({ __esModule: true, default: name });
const Bubble = load('src/features/chat/presentation/messages/MessageBubble/index.tsx', {
  react: React, 'react-native': native, '@shared/theme': themeApi, '@shopify/flash-list': flash,
  './styles': styles, './Avatar': { Avatar: 'Avatar' }, './ReplyQuote': { ReplyQuote: 'Quote' },
  './TokenInfo': { TokenInfo: 'TokenInfo' }, './ReasoningHeader': { ReasoningHeader: 'ReasoningHeader' },
  '../components/SharedChatRecordView': defaultStub('SharedChatRecord'),
  './OfficialReplicaProcessCard': defaultStub('ProcessCard'), './PaperNoteMessageFrame': defaultStub('PaperFrame'),
  './StickerMessageCard': defaultStub('Sticker'), './VoiceMessageCard': defaultStub('Voice'),
  './layoutProbe': { isLayoutProbeEnabled: () => false }, './MessageBubbleContent': contents,
}).default;
const bubbleProps = (id) => ({ messageId: id, text: `思考 ${id}`, isMe: false, senderType: 'reasoning', onPreviewFile: () => {}, reasoningSurface: theme.id === 'moon-kimi' ? 'official-replica' : 'default' });
function header(renderer) { return renderer.root.findByType(theme.id === 'moon-kimi' ? 'ProcessCard' : 'ReasoningHeader'); }
function expanded(renderer) { const props = header(renderer).props; return props.expanded ?? props.isExpanded; }
for (const id of ['default-light', 'paper-note', 'moon-kimi']) {
  theme = { ...theme, id };
  let renderer;
  act(() => { renderer = create(React.createElement(Bubble, bubbleProps(101))); });
  assert.equal(expanded(renderer), false);
  const previousLayouts = layouts;
  act(() => header(renderer).props.onToggle());
  assert.equal(expanded(renderer), true);
  assert.ok(layouts > previousLayouts, '展开改变列表项高度时应通知列表重新布局');
  if (id === 'moon-kimi') {
    act(() => {
      header(renderer).props.onBodyLayout({ nativeEvent: { layout: { height: 100 } } });
      header(renderer).props.onContentSizeChange(200, 300);
    });
    assert.equal(header(renderer).props.scrollable, true);
  }
  act(() => renderer.update(React.createElement(Bubble, { ...bubbleProps(101), text: '同一条消息追加思考' })));
  assert.equal(expanded(renderer), true);
  if (id === 'moon-kimi') {
    assert.equal(header(renderer).props.scrollable, true, '同一消息更新正文时保留已测量尺寸');
  }
  act(() => renderer.update(React.createElement(Bubble, bubbleProps(102))));
  assert.equal(expanded(renderer), false, '回收实例换消息后不能继承上一条思维链的展开状态');
  act(() => header(renderer).props.onToggle());
  assert.equal(expanded(renderer), true);
  if (id === 'moon-kimi') {
    assert.equal(header(renderer).props.scrollable, false, '新消息不能继承上一条的滚动尺寸');
    act(() => header(renderer).props.onContentSizeChange(200, 300));
    assert.equal(header(renderer).props.scrollable, false, '新消息尚未测量视口时不能使用旧视口尺寸');
    act(() => header(renderer).props.onBodyLayout({ nativeEvent: { layout: { height: 100 } } }));
    assert.equal(header(renderer).props.scrollable, true);
  }
  act(() => renderer.update(React.createElement(Bubble, bubbleProps(101))));
  assert.equal(expanded(renderer), false, '回收回上一条消息时也不能继承另一条思维链的展开状态');
  if (id === 'moon-kimi') {
    act(() => header(renderer).props.onToggle());
    act(() => header(renderer).props.onBodyLayout({ nativeEvent: { layout: { height: 100 } } }));
    assert.equal(header(renderer).props.scrollable, false, '新消息尚未测量正文时不能使用旧正文尺寸');
  }
  act(() => renderer.unmount());
  console.log(`${id}: 思维链同消息保留状态，换消息重置状态`);
}
theme = { ...theme, id: 'default-light' };
let independent;
act(() => { independent = create(React.createElement(React.Fragment, null, React.createElement(Bubble, { ...bubbleProps(201), key: 'a' }), React.createElement(Bubble, { ...bubbleProps(202), key: 'b' }))); });
act(() => independent.root.findAllByType('ReasoningHeader')[0].props.onToggle());
assert.deepEqual(independent.root.findAllByType('ReasoningHeader').map((node) => node.props.isExpanded), [true, false]);
act(() => independent.root.findAllByType('ReasoningHeader')[1].props.onToggle());
assert.deepEqual(independent.root.findAllByType('ReasoningHeader').map((node) => node.props.isExpanded), [true, true]);
act(() => independent.root.findAllByType('ReasoningHeader')[0].props.onToggle());
assert.deepEqual(independent.root.findAllByType('ReasoningHeader').map((node) => node.props.isExpanded), [false, true]);
act(() => independent.unmount());
console.log('同时挂载的不同气泡状态独立，没有直接共享展开状态');

const ActionGroup = load('src/features/chat/presentation/messages/MessageBubble/ActionGroupProcessCard.tsx', {
  react: React, 'react-native': native, '@expo/vector-icons': { Ionicons: 'Icon' },
  '@shopify/flash-list': { ...flash, useMappingHelper: () => ({ getMappingKey: (key) => key }) },
  '@features/chat/messages/domain': {
    parseMessageMetadata: (message) => JSON.parse(message.metadataJson),
    isToolStatusMessageMetadata: (metadata) => metadata.type === 'toolStatus',
  },
  '@features/chat/messages/application/AgentTransientTimeline': { getAgentTimelineRenderKey: (message) => String(message.id) },
  '@shared/theme': { ...themeApi, getChatInteractionProfile: (value) => ({ reasoningSurface: value.id === 'moon-kimi' ? 'official-replica' : 'default', toolStatusSurface: value.id === 'moon-kimi' ? 'official-replica' : 'default' }) },
  './styles': styles, './OfficialReplicaProcessCard': defaultStub('ProcessCard'), './MessageBubbleContent': contents,
}).default;
for (const id of ['default-light', 'paper-note', 'moon-kimi']) {
  theme = { ...theme, id };
  const children = ['已调用：打开朋友圈', '已调用：读取动态', '已调用：点赞'].map((displayText, index) => ({ id: index + 1, senderType: 'system', text: displayText, metadataJson: JSON.stringify({ type: 'toolStatus', status: 'completed', displayText }) }));
  const group = { key: 'tools-only', children, isRunning: false };
  let renderer;
  act(() => { renderer = create(React.createElement(ActionGroup, { group })); });
  act(() => renderer.root.findByType(id === 'moon-kimi' ? 'ProcessCard' : 'TouchableOpacity').props[id === 'moon-kimi' ? 'onToggle' : 'onPress']());
  assert.equal(renderer.root.findAllByType('Body').length, 0, '纯工具步骤不得生成思维链占位');
  const texts = renderer.root.findAllByType('Text').map((node) => node.props.children);
  assert.deepEqual(texts.filter((text) => String(text).startsWith('已调用：')), children.map((child) => child.text), '无思维链的模型仍应完整按顺序展示每个工具步骤');
  const reasoning = { id: 4, senderType: 'reasoning', text: '真实思考内容', metadataJson: '{}' };
  act(() => renderer.update(React.createElement(ActionGroup, { group: { ...group, children: [reasoning, ...children] } })));
  assert.deepEqual(renderer.root.findAllByType('Body').map((node) => node.props.text), ['真实思考内容'], '修复纯工具步骤后，真实思维链仍须完整显示');
  act(() => renderer.unmount());
}
console.log('Chat reasoning state verification passed.');
