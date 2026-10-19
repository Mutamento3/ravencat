/** 纸条主题的消息布局回归；媒体与原生渲染边界使用占位，布局组件和 React 使用真实实现。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = path.resolve(import.meta.dirname, '..');
function load(file, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output)(module, module.exports, (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `未声明依赖：${name}`);
    return dependencies[name];
  });
  return module.exports;
}

const flatten = (value) => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const native = {
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', Pressable: 'Pressable',
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
  StyleSheet: { create: (value) => value, flatten, hairlineWidth: 1, absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
};
const variants = load('src/shared/theme/themeVariants.ts');
const metadata = load('src/features/chat/messages/domain/chatMessageMetadata.ts', {
  './SharedChatRecord': {}, './ChatSticker': load('src/features/chat/messages/domain/ChatSticker.ts'),
});
const presentation = load('src/features/chat/presentation/messages/components/chatMessagePresentation.ts', {
  '@features/chat/messages/domain': metadata,
});
const themes = ['defaultLight', 'defaultDark', 'liquidGlass', 'moonKimi', 'paperNote'].map((name) =>
  load(`src/shared/theme/themes/${name}.ts`)[`${name}Theme`]);
let theme = themes.at(-1);
const themeContext = React.createContext(null);
const themeApi = {
  ...variants, useTheme: () => React.useContext(themeContext),
  useThemedStyles: (factory) => factory(React.useContext(themeContext)),
  ThemedSurface: 'Surface', GlassSurface: 'GlassSurface',
};
const bubbleDir = 'src/features/chat/presentation/messages/MessageBubble/';
const expansion = load('src/features/chat/presentation/messages/components/reasoningExpansionState.ts', {
  react: React, '@shopify/flash-list': { useRecyclingState: React.useState },
});
const base = { react: React, 'react-native': native, '@shared/theme': themeApi };
const styles = load(`${bubbleDir}styles.ts`, {
  ...base,
  './textStyles': load(`${bubbleDir}textStyles.ts`, base),
  './paperNoteStyles': load(`${bubbleDir}paperNoteStyles.ts`, base),
  './supplementStyles': load(`${bubbleDir}supplementStyles.ts`, base),
});
const frame = load(`${bubbleDir}PaperNoteMessageFrame.tsx`, { ...base, './styles': styles });
const stub = (name) => ({ __esModule: true, default: name });
const quote = load(`${bubbleDir}ReplyQuote.tsx`, {
  ...base, './styles': styles, './AttachmentCard': stub('Attachment'),
  './StickerMessageCard': stub('Sticker'), './VoiceMessageCard': stub('Voice'),
});
const contents = load(`${bubbleDir}MessageBubbleContent.tsx`, {
  './selectableMarkdownRenderer': { createSelectableMarkdownRenderer: () => () => null },
  ...base, './styles': styles, './AttachmentCard': stub('Attachment'),
  '@shopify/flash-list': { useMappingHelper: () => ({ getMappingKey: (id) => id }) },
  'react-native-markdown-renderer': { __esModule: true, default: 'Markdown', MarkdownIt: () => ({}), hasParents: () => false },
});
const Bubble = load(`${bubbleDir}index.tsx`, {
  '../components/reasoningExpansionState': expansion,
  '@platform/device': { releaseTextSelectionFocus: async () => {} },
  ...base, './styles': styles, './PaperNoteMessageFrame': frame, './ReplyQuote': quote,
  './MessageBubbleContent': contents, './Avatar': { Avatar: 'Avatar' },
  './TokenInfo': { TokenInfo: () => null }, './ReasoningHeader': { ReasoningHeader: 'Reasoning' },
  './OfficialReplicaProcessCard': stub('Process'), './StickerMessageCard': stub('Sticker'),
  './VoiceMessageCard': stub('Voice'), '../components/SharedChatRecordView': stub('SharedRecord'),
  './layoutProbe': { isLayoutProbeEnabled: () => false },
  '@shopify/flash-list': { useRecyclingState: React.useState },
}).default;
const Card = load('src/features/chat/presentation/messages/components/TogetherListeningActivityCard.tsx', {
  ...base, '@shared/ui': { showAppDialog: () => {} }, 'lucide-react-native': { Headphones: 'Headphones' },
  '../MessageBubble/Avatar': { Avatar: 'Avatar' }, '../MessageBubble/PaperNoteMessageFrame': frame,
}).default;
function render(Component, props) {
  let renderer;
  act(() => { renderer = create(themedElement(Component, props)); });
  return renderer;
}
const themedElement = (Component, props) => React.createElement(
  expansion.ReasoningExpansionContext.Provider, { value: new Set() },
  React.createElement(themeContext.Provider, { value: theme }, React.createElement(Component, props)));
const text = (renderer, content) => renderer.root.findAllByType('Text').find((node) =>
  [node.props.children].flat().join('') === content);
const viewStyle = (node) => flatten(node.parent.props.style);

// 同一步的文字、语音与表情共用逻辑编号；隐藏思考和合并文字都不能吞掉媒体。
for (theme of themes) {
  const profile = variants.getChatInteractionProfile(theme);
  const message = (id, text, extra = {}) => ({
    id, text, senderType: 'assistant', isMe: false, logicalMessageId: 'step-1',
    segmentIndex: 0, segmentTotal: 1, status: 'sent', ...extra,
  });
  const voice = message(3, '思考正文', { metadataJson: JSON.stringify({ kind: 'voice', voice: {
    schemaVersion: 1, mediaAssetId: 'voice-1', mimeType: 'audio/mpeg', durationMs: 2000,
    transcriptSource: 'assistant_source_text',
  } }) });
  const sticker = message(4, '', { metadataJson: JSON.stringify({ kind: 'sticker', sticker: {
    stickerId: 's1', mediaAssetId: 'sticker-1', name: '开心', description: null, tags: [],
    emotion: null, mimeType: 'image/png', width: null, height: null, isAnimated: false,
  } }) });
  const reasoning = message(0, '思考正文', { senderType: 'reasoning' });
  const input = [reasoning, message(1, '第一段', { segmentTotal: 2 }),
    message(2, '第二段', { segmentIndex: 1, segmentTotal: 2 }), voice, sticker];
  const visible = presentation.collapseAssistantSegmentsForPresentation(input, profile);
  assert.ok(visible.includes(voice), `${theme.id} 必须保留独立语音及其元数据`);
  assert.ok(visible.includes(sticker), `${theme.id} 必须保留独立表情`);
  assert.deepEqual(visible.filter(item => item.id === 1 || item.id === 2).map(item => item.text),
    profile.enableAssistantMessageSegmentation ? ['第一段', '第二段'] : ['第一段\n\n第二段']);
  const renderer = render(Bubble, {
    messageId: voice.id, text: voice.text, senderType: voice.senderType, isMe: false,
    voice: metadata.getMessageVoice(voice), onPreviewFile: () => {},
  });
  assert.equal(renderer.root.findAllByType('Voice').length, 1);
  act(() => renderer.unmount());
}

// 引用、译文与正文共用左侧起点；其他主题仍保留用户右侧对齐。
for (theme of themes) {
  const renderer = render(Bubble, {
    messageId: 1, text: '用户正文', isMe: true, senderType: 'user', userName: '枫渡',
    replyToText: '被引用的文字', translation: { text: '译文', sourceLabel: '模型' }, onPreviewFile: () => {},
  });
  const alignment = theme.id === 'paper-note' ? 'flex-start' : 'flex-end';
  assert.equal(viewStyle(text(renderer, '被引用的文字')).alignSelf, alignment, `${theme.id} 引用对齐`);
  assert.equal(viewStyle(text(renderer, '译文')).alignSelf, alignment, `${theme.id} 译文对齐`);
  if (theme.id === 'paper-note') {
    assert.ok(text(renderer, '枫渡：'));
    assert.equal(renderer.root.findAllByType('Avatar').length, 0);
  }
  act(() => renderer.unmount());
}

// 通话、语音、表情、图片、文件和分享记录均在纸条姓名下展示。
theme = themes.at(-1);
for (const [kind, extra, expected] of [
  ['通话', { text: '通话已结束 01:23' }, 'Text'],
  ['语音', { voice: { mediaAssetId: 'voice-1', durationMs: 2000 }, isVoiceTranscriptExpanded: true }, 'Voice'],
  ['表情包', { text: '', sticker: { mediaAssetId: 'sticker-1' } }, 'Sticker'],
  ['图片', { text: '', attachments: [{ id: 'image-1', type: 'image' }] }, 'Attachment'],
  ['文件', { text: '', attachments: [{ id: 'file-1', type: 'file' }] }, 'Attachment'],
  ['分享记录', { sharedRecord: { entries: [] } }, 'SharedRecord'],
]) {
  for (const isMe of [true, false]) {
    const renderer = render(Bubble, {
      messageId: 1, text: '消息', senderType: isMe ? 'user' : 'assistant', isMe,
      userName: '枫渡', aiName: 'Raven', onPreviewFile: () => {}, ...extra,
    });
    assert.ok(text(renderer, isMe ? '枫渡：' : 'Raven：'), `${kind} 应显示发言者`);
    assert.equal(renderer.root.findAllByType('Avatar').length, 0);
    const content = renderer.root.findAllByType(expected).at(-1);
    assert.ok(content, `${kind} 内容应保留`);
    const ancestors = [];
    for (let node = content; node; node = node.parent) ancestors.push(flatten(node.props.style));
    assert.ok(ancestors.some((style) => style.width === '100%' && style.paddingHorizontal === theme.spacing.lg), `${kind} 应使用纸条页宽和缩进`);
    assert.ok(ancestors.every((style) => style.alignSelf !== 'flex-end' && style.justifyContent !== 'flex-end'), `${kind} 不应靠右`);
    act(() => renderer.unmount());
  }
}

// 一起听的两种发起人、生命周期和操作按钮保留；切换主题后恢复各自布局。
for (const isMe of [true, false]) {
  for (const [phase, actions] of [['pending_ai_response', []], ['pending_user_response', ['decline', 'accept']], ['active', ['leave']], ['ended', []]]) {
    theme = themes.at(-1);
    const calls = [];
    const props = {
      identity: { role: isMe ? 'user' : 'ai', isMe, name: isMe ? '枫渡' : 'Raven', avatarContent: null },
      viewModel: { activityId: 'listen-1', isMe, phase, title: '🎧 一起听', body: '状态正文', durationText: '01:23', actions },
      ...Object.fromEntries(['Accept', 'Decline', 'Leave'].map((action) => [`on${action}`, async (id) => { calls.push([action.toLowerCase(), id]); return { status: 'ok' }; }])),
    };
    const renderer = render(Card, props);
    const surface = renderer.root.findByType('Surface');
    assert.equal(surface.props.backgroundColor, 'transparent');
    assert.equal(flatten(surface.props.style).borderWidth, 0);
    assert.ok(text(renderer, isMe ? '枫渡：' : 'Raven：'));
    assert.ok(text(renderer, '状态正文'));
    assert.ok(text(renderer, '一起听时长 01:23'));
    assert.equal(renderer.root.findAllByType('Avatar').length, 0);
    for (const [index, action] of actions.entries()) {
      await act(async () => renderer.root.findAllByType('TouchableOpacity')[index].props.onPress());
      assert.deepEqual(calls.at(-1), [action, 'listen-1']);
    }
    theme = themes[0];
    act(() => renderer.update(themedElement(Card, props)));
    assert.equal(renderer.root.findAllByType('Avatar').length, 1);
    assert.equal(flatten(renderer.root.findByType('Surface').parent.props.style).justifyContent, isMe ? 'flex-end' : 'flex-start');
    act(() => renderer.unmount());
  }
}
console.log('Paper Note 消息布局回归验证通过。');
