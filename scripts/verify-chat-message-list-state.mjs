import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { arrival } from './chat-message-arrival-fixture.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const frames = new Map();
let nextFrame = 0;

function loadModule(relativePath, requireModule = () => ({})) {
  const sourcePath = path.join(projectRoot, relativePath);
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: requireModule,
    console,
    Map,
    Set,
    Array,
    Object,
    String,
    Boolean,
    Number,
    Date,
    Math,
    JSON,
    Error,
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  return module.exports;
}

const metadata = loadModule('src/features/chat/messages/domain/chatMessageMetadata.ts');
const state = loadModule(
  'src/features/chat/presentation/messages/components/chatMessageListState.ts',
  (specifier) => {
    if (specifier === '@features/chat/messages/domain') {
      return metadata;
    }
    throw new Error(`未预期的运行时依赖：${specifier}`);
  },
);
const presentation = loadModule(
  'src/features/chat/presentation/messages/components/chatMessagePresentation.ts',
  (specifier) => {
    if (specifier === '@features/chat/messages/domain') {
      return metadata;
    }
    throw new Error(`未预期的 chatMessagePresentation 运行时依赖：${specifier}`);
  },
);
const themes = loadModule('src/shared/theme/themeVariants.ts');
const agentIdentity = loadModule('src/features/chat/messages/domain/AgentTimelineIdentity.ts');
const timelineOrdering = loadModule('src/features/chat/messages/domain/ChatTimelineOrdering.ts');
const transientStore = loadModule(
  'src/features/chat/messages/application/AgentTransientTimeline.ts',
  (specifier) => {
    if (specifier === '../domain/AgentTimelineIdentity') {
      return agentIdentity;
    }
    throw new Error(`未预期的 AgentTransientTimeline 运行时依赖：${specifier}`);
  },
);
const transientTimeline = loadModule(
  'src/features/chat/presentation/messages/components/useAgentTransientTimeline.ts',
  (specifier) => {
    if (specifier === 'react') {
      return {};
    }
    if (specifier === '@features/chat/messages/domain/ChatTimelineOrdering') {
      return timelineOrdering;
    }
    if (specifier === '@features/chat/messages/application/AgentTransientTimeline') {
      return transientStore;
    }
    throw new Error(`未预期的 useAgentTransientTimeline 运行时依赖：${specifier}`);
  },
);
const presentationRun = loadModule(
  'src/features/chat/presentation/messages/components/chatPresentationRun.ts',
  (specifier) => {
    if (specifier === '@features/chat/messages/domain') {
      return metadata;
    }
    throw new Error(`未预期的 presentation run 运行时依赖：${specifier}`);
  },
);
const actionGrouping = loadModule(
  'src/features/chat/presentation/messages/components/chatActionGrouping.ts',
  (specifier) => {
    if (specifier === '@features/chat/messages/domain') {
      return metadata;
    }
    if (specifier === '@features/chat/messages/application/AgentTransientTimeline') {
      return transientStore;
    }
    if (specifier === './chatPresentationRun') {
      return presentationRun;
    }
    throw new Error(`未预期的 action grouping 运行时依赖：${specifier}`);
  },
);
const renderUtils = loadModule(
  'src/features/chat/presentation/messages/components/chatMessageRenderUtils.ts',
  (specifier) => {
    if (specifier === './chatActionGrouping') return actionGrouping;
    throw new Error(`未预期的 render utils 运行时依赖：${specifier}`);
  },
);

function message(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    sessionId: 's1',
    text: '消息',
    isMe: false,
    isRead: true,
    senderType: 'assistant',
    time: '12:00',
    createdAt: '2026-09-09T12:00:00.000Z',
    showTimeSeparatorBefore: false,
    status: 'sent',
    metadataJson: null,
    ...overrides,
  };
}

function classify(previousKeys, messages, keys) {
  return state.classifyTailMutation({ previous: { keys: previousKeys }, messages, keys });
}

// 记录中的媒体属于记录条目，不能让整张记录卡变成无气泡的独立附件。
{
  for (const type of ['image', 'file']) {
    const params = {
      text: '', isMe: true, senderType: 'user',
      attachments: [{ id: 'attachment-a', type }], isToolStatusMessage: false,
    };
    assert.equal(renderUtils.buildMessageBubbleRenderState(params).isStandaloneAttachmentMessage, true);
    const shared = renderUtils.buildMessageBubbleRenderState({ ...params, isSharedRecord: true });
    assert.equal(shared.isStandaloneAttachmentMessage, false, '单个媒体的分享记录保留完整气泡');
    assert.equal(shared.variant, 'me');
  }
  assert.equal(renderUtils.buildMessageBubbleRenderState({
    text: '**附言**', isMe: true, senderType: 'user', attachments: [],
    isToolStatusMessage: false, isSharedRecord: true,
  }).shouldUseMarkdown, false, '旧记录的附言不改变记录卡布局');
}

// 回收资格由视图类别决定，不能随消息身份增长，也不能混用文本与媒体、行动步骤的容器。
{
  function item(overrides = {}) {
    const msg = overrides.msg ?? message();
    const attachments = overrides.attachments ?? [];
    return {
      msg, attachments, sticker: null, voice: null, actionGroup: null,
      processCard: null, togetherListeningCard: null, showTimeSeparator: false,
      bubbleRenderState: renderUtils.buildMessageBubbleRenderState({
        text: msg.text, isMe: msg.isMe, senderType: msg.senderType,
        attachments, isToolStatusMessage: false,
      }),
      ...overrides,
    };
  }
  const type = renderUtils.getMessageListItemType;
  const textItem = item();
  assert.equal(type(textItem), type(item({ msg: message({ id: 999, text: '另一条消息' }) })), '同类消息可复用');
  const mediaItems = [
    item({ attachments: [{ id: 'image-a', type: 'image' }] }),
    item({ sticker: { mediaAssetId: 'sticker-a' } }),
    item({ voice: { mediaAssetId: 'voice-a' } }),
    item({ msg: message({ text: '**Markdown**' }) }),
  ];
  assert.equal(new Set([textItem, ...mediaItems].map(type)).size, 5, '不同正文结构独立回收');
  assert.notEqual(type(textItem), type(item({ msg: userMessage() })), '两侧气泡不混用');
  assert.notEqual(type(textItem), type(item({ showTimeSeparator: true })), '日期行保留独立结构');
  assert.notEqual(
    type(item({ actionGroup: { key: 'group-a' } })),
    type(item({ processCard: { title: '思考' } })),
    '行动步骤与独立思考卡不混用',
  );
  const historyTypes = Array.from({ length: 500 }, (_, index) => type(item({ msg: message({ id: index }) })));
  assert.equal(new Set(historyTypes).size, 1, '长历史不为每条消息创建回收类别');
}

assert.equal(classify([], [message()], ['a']).type, 'initial');
assert.equal(classify(['a'], [message()], ['a']).type, 'unchanged');
assert.equal(classify(['a'], [message({ id: 2 })], ['b']).type, 'replacement-or-reorder');
assert.equal(classify(['a', 'b'], [message(), message(), message()], ['x', 'a', 'b']).type, 'replacement-or-reorder');

const appended = [message({ id: 1 }), message({ id: 2 }), message({ id: 3 })];
const appendMutation = classify(['a'], appended, ['a', 'b', 'c']);
assert.equal(appendMutation.type, 'append');
assert.deepEqual(Array.from(appendMutation.appendedMessages, (item) => item.id), [2, 3]);

// ActionGroup child 增长保留同一个列表 key：不是新独立消息，也不触发“新消息”提示。
const expandedActionGroupMutation = classify(
  ['presentation_action_group:run:run-1:db:1'],
  [message({ id: 1, senderType: 'reasoning' })],
  ['presentation_action_group:run:run-1:db:1'],
);
assert.equal(expandedActionGroupMutation.type, 'unchanged');
assert.equal(expandedActionGroupMutation.appendedMessages.length, 0);

assert.equal(state.isNewMessagePromptEligible(message()), true, '普通 assistant 应提示');
assert.equal(state.isNewMessagePromptEligible(message({ isMe: true, senderType: 'user' })), false);
assert.equal(state.isNewMessagePromptEligible(message({ senderType: 'reasoning' })), false);
assert.equal(state.isNewMessagePromptEligible(message({ senderType: 'tool' })), false);

function callMetadata(overrides = {}) {
  return JSON.stringify({
    type: 'callStatus',
    callId: 'call-1',
    callStatus: 'callEnded',
    direction: 'incoming',
    initiator: 'ai',
    ownerRole: 'assistant',
    actor: 'ai',
    endReason: 'aiEnded',
    displayText: '通话结束',
    aiContextText: '通话结束',
    source: 'callRuntime',
    ...overrides,
  });
}

assert.equal(state.isNewMessagePromptEligible(message({ metadataJson: callMetadata() })), false);
assert.equal(state.isNewMessagePromptEligible(message({
  metadataJson: callMetadata({ callStatus: 'callRejectedByUser', endReason: 'userRejected' }),
})), false, '用户主动拒接不提示');
assert.equal(state.isNewMessagePromptEligible(message({
  metadataJson: callMetadata({ callStatus: 'callMissed', endReason: 'missedByUser' }),
})), true, 'AI 主动来电且用户未接应提示');
assert.equal(state.isNewMessagePromptEligible(message({
  metadataJson: JSON.stringify({ triggerSource: 'call' }),
})), false, '通话中产生的普通文本不提示');

assert.equal(state.resolveBottomFollowState({
  followingBottom: true,
  isUserInteracting: false,
  isNearBottom: false,
}), true, '内容增长不能取消贴底意图');
assert.equal(state.resolveBottomFollowState({
  followingBottom: true,
  isUserInteracting: true,
  isNearBottom: false,
}), false, '用户主动滚离才取消贴底');
assert.equal(state.resolveBottomFollowState({
  followingBottom: false,
  isUserInteracting: true,
  isNearBottom: true,
}), true, '用户回到底部应恢复跟随');
assert.equal(state.resolveBottomFollowState({
  followingBottom: true,
  isUserInteracting: false,
  isNearBottom: false,
}), true, '展开中的 ActionGroup 高度增长时，既有贴底意图应继续保留');
assert.equal(state.resolveBottomFollowState({
  followingBottom: false,
  isUserInteracting: false,
  isNearBottom: false,
}), false, '用户已主动滚离后，ActionGroup 高度增长不得恢复贴底');

// 分段到达回归：重进和历史共享当前进度，旧异步快照不能回退。
function userMessage(id = 20) {
  return message({ id, isMe: true, senderType: 'user' });
}
{
  const messages = [userMessage(20), ...[30, 31, 32].map((id) => message({ id }))];
  const visible = () => Array.from(arrival.projectArrivedAssistantMessages(
    messages, arrival.getAssistantMessageArrivalSnapshot().pendingMessageIds,
  ), (item) => item.id);
  let notifications = 0;
  const unsubscribe = arrival.subscribeAssistantMessageArrival(() => { notifications += 1; });
  arrival.applyAssistantMessageArrivalSnapshot({ revision: 1, pendingMessageIds: [30, 31, 32], pendingSessionIds: ['s1'] });
  assert.deepEqual(visible(), [20]);
  arrival.applyAssistantMessageArrivalSnapshot({ revision: 2, pendingMessageIds: [31, 32], pendingSessionIds: ['s1'] });
  assert.deepEqual(visible(), [20, 30]);
  arrival.applyAssistantMessageArrivalSnapshot({ revision: 1, pendingMessageIds: [30, 31, 32], pendingSessionIds: ['s1'] });
  assert.deepEqual(visible(), [20, 30], '旧快照不能隐藏已到达消息');
  arrival.applyAssistantMessageArrivalSnapshot({ revision: 3, pendingMessageIds: [32], pendingSessionIds: ['s1'] });
  assert.deepEqual(visible(), [20, 30, 31]);
  arrival.applyAssistantMessageArrivalSnapshot({ revision: 4, pendingMessageIds: [], pendingSessionIds: [] });
  assert.deepEqual(visible(), [20, 30, 31, 32]);
  assert.deepEqual(visible(), [20, 30, 31, 32], '重进页面和历史不补播');
  assert.equal(notifications, 4);
  unsubscribe();
  const independent = [
    message({ id: 40, turnRunId: 'pending-run' }),
    message({ id: 41, turnRunId: 'pending-run', senderType: 'reasoning' }),
    message({ id: 42, turnRunId: 'other-run' }),
    userMessage(43),
  ];
  assert.deepEqual(Array.from(arrival.projectArrivedAssistantMessages(independent, [40]), (item) => item.id), [42, 43]);
}

// 行动步骤回归：隐藏正文时，不能让后续过程越过它形成假的连续分组。
{
  const sessionId = 'action-order';
  const runId = 'action-order-run';
  const otherRunId = 'independent-run';
  const user = userMessage(51);
  const kinds = ['reasoning', 'tool', 'assistant', 'reasoning', 'tool', 'assistant'];
  const texts = ['R1', 'T1', 'A1', 'R2', 'T2', 'A2'];
  const snapshots = kinds.map((kind, index) => ({
    runId,
    sequence: index + 1,
    stepIndex: Math.floor(index / 3),
    kind,
    status: 'sent',
    text: texts[index],
    clientMessageId: agentIdentity.buildAgentTimelineClientMessageId(runId, index + 1),
    createdAt: `2026-09-09T12:00:0${index + 1}.000Z`,
    time: '12:00',
  }));
  function merge(persistedMessages = [user], suppressTransientAssistantText = true) {
    return transientTimeline.mergeTimelineRenderMessages({
      persistedMessages,
      // 顺序由真实 timeline sorter 决定，不能依赖调用方的数组排列。
      transientMessages: transientStore.snapshotAgentTransientTimelineWithReplacements(sessionId).reverse(),
      suppressTransientAssistantText,
    });
  }
  function project(messages) {
    return Array.from(actionGrouping.segmentContiguousAgentActions(messages), (item) => (
      item.kind === 'message'
        ? item.message.text
        : Array.from(item.children, (child) => child.text)
    ));
  }

  transientStore.applyAgentTransientTimelineSnapshots({ sessionId, snapshots: snapshots.slice(0, 2) });
  const firstGroup = actionGrouping.segmentContiguousAgentActions(merge())[1];
  assert.deepEqual(project(merge()), [user.text, ['R1', 'T1']]);
  transientStore.applyAgentTransientTimelineSnapshots({ sessionId, snapshots });
  const beforeCommit = merge();
  assert.deepEqual(
    project(beforeCommit),
    [user.text, ['R1', 'T1']],
    'R1 T1 A1 R2 T2 A2 在等待正文时只能展示第一组，不能合成 R1 T1 R2 T2',
  );
  assert.equal(actionGrouping.segmentContiguousAgentActions(beforeCommit)[1].key, firstGroup.key);
  assert.deepEqual(
    project(merge([user], false)),
    [user.text, ['R1', 'T1'], 'A1', ['R2', 'T2'], 'A2'],
    '正文可直接展示的主题应实时保留全部事件顺序',
  );

  const nextUser = { ...userMessage(52), createdAt: '2026-09-09T12:00:08.000Z' };
  const externalCard = message({
    id: 53,
    senderType: 'system',
    text: '同 run 工具产生的卡片',
    turnRunId: runId,
    turnItemIndex: null,
    createdAt: '2026-09-09T12:00:05.500Z',
  });
  transientStore.applyAgentTransientTimelineSnapshots({
    sessionId,
    snapshots: [{
      ...snapshots[0],
      runId: otherRunId,
      clientMessageId: agentIdentity.buildAgentTimelineClientMessageId(otherRunId, 1),
      text: '独立 run 的思考',
      createdAt: '2026-09-09T12:00:07.000Z',
    }],
  });
  assert.deepEqual(
    project(merge([user, externalCard, nextUser])),
    [user.text, ['R1', 'T1'], ['独立 run 的思考'], nextUser.text],
    '同 run 的后续卡片不能越过正文，但用户消息与其他 run 不受影响',
  );
  transientStore.clearAgentTransientTimelineRun(otherRunId, sessionId);

  let turnItemIndex = 0;
  function committed(sequence, text, segmentIndex = 0, segmentTotal = 1) {
    const snapshot = snapshots[sequence - 1];
    turnItemIndex += 1;
    return message({
      id: 400 + turnItemIndex,
      senderType: snapshot.kind === 'tool' ? 'system' : snapshot.kind,
      text,
      createdAt: snapshot.createdAt,
      clientMessageId: agentIdentity.buildAgentTimelineClientMessageId(runId, sequence, segmentIndex),
      logicalMessageId: `agent_timeline:${runId}:step:${snapshot.stepIndex}`,
      turnRunId: runId,
      turnItemIndex,
      segmentIndex,
      segmentTotal,
      metadataJson: snapshot.kind === 'tool'
        ? JSON.stringify({
            type: 'toolStatus', status: 'completed', toolNames: [], displayNames: [],
            displayText: text, source: 'chatToolFlow',
          })
        : null,
    });
  }
  const committedMessages = [
    committed(1, 'R1'), committed(2, 'T1'),
    committed(3, 'A1a', 0, 2), committed(3, 'A1b', 1, 2),
    committed(4, 'R2'), committed(5, 'T2'), committed(6, 'A2'),
  ];
  transientStore.reconcileAgentTransientTimelineCommit(sessionId, runId, committedMessages);
  const afterCommit = merge();
  assert.deepEqual(
    project(arrival.projectArrivedAssistantMessages(afterCommit, [404, 407])),
    [user.text, ['R1', 'T1'], 'A1a'],
    '未到达正文同时阻止同一 run 的后续过程越过它',
  );
  assert.deepEqual(
    project(arrival.projectArrivedAssistantMessages(afterCommit, [])),
    [user.text, ['R1', 'T1'], 'A1a', 'A1b', ['R2', 'T2'], 'A2'],
    '到达后按真实正文边界分开行动步骤',
  );
  assert.equal(actionGrouping.segmentContiguousAgentActions(afterCommit)[1].key, firstGroup.key);
  transientStore.acknowledgeAgentTransientTimelineCommitted(sessionId, committedMessages);
  assert.deepEqual(project(merge([user, ...committedMessages])), project(afterCommit));

  // 没有正文分界时，跨 step 的过程保持连续，不能机械地按 step 拆组。
  transientStore.applyAgentTransientTimelineSnapshots({
    sessionId,
    snapshots: [snapshots[0], snapshots[1], snapshots[3], snapshots[4]],
  });
  assert.deepEqual(project(merge()), [user.text, ['R1', 'T1', 'R2', 'T2']]);
  transientStore.clearAgentTransientTimelineRun(runId, sessionId);
  assert.deepEqual(Array.from(merge()), [user], 'run 清理后不保留展示阻挡状态');
}

// 主题只决定气泡呈现方式，不拥有另一套到达计时器。
assert.equal(presentation.ownsCanonicalSegmentedAssistantPresentation(themes.getChatInteractionProfile({ id: 'daylight' })), true);
assert.equal(presentation.ownsCanonicalSegmentedAssistantPresentation(themes.getChatInteractionProfile({ id: 'liquid-glass' })), true);
assert.equal(presentation.ownsCanonicalSegmentedAssistantPresentation(themes.getChatInteractionProfile({ id: 'moon-kimi' })), false);
assert.equal(presentation.ownsCanonicalSegmentedAssistantPresentation(themes.getChatInteractionProfile({ id: 'paper-note' })), false);

// 原生列表只模拟布局完成、尺寸变化和滚动命令；跟随决策使用真实组件。
{
  let scrolls = 0;
  let offset = 600;
  const FlashList = React.forwardRef(function FlashList(props, ref) {
    React.useImperativeHandle(ref, () => ({
      scrollToEnd: () => { scrolls++; offset = 1000; },
    }), []);
    return React.createElement('FlashList', props);
  });
  const toolStatus = loadModule(
    'src/features/chat/presentation/messages/components/chatToolStatusPresentation.ts',
    () => metadata,
  );
  const togetherListening = loadModule(
    'src/features/chat/presentation/messages/components/togetherListeningCardViewModel.ts',
    () => metadata,
  );
  const theme = loadModule('src/shared/theme/themes/moonKimi.ts').moonKimiTheme;
  const boundaries = {
    react: React,
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable' },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    '@shopify/flash-list': { FlashList },
    '@features/chat/messages/domain': { ...metadata, buildSessionPreviewTextFromMessage: (msg) => msg.text },
    '@shared/utils/timeFormat': { formatMessageTime: () => '12:00' },
    './ChatMessageListParts': { MessageListItem: 'MessageListItem' },
    '../../../messages/domain/ChatMessageSelection': { getChatSelectionKey: (msg) => String(msg.id) },
    './chatMessageRenderUtils': renderUtils,
    '../MessageBubble/layoutProbe': { createLayoutProbeCellRenderer: () => undefined },
    './togetherListeningCardViewModel': togetherListening,
    './chatMessagePresentation': presentation,
    './chatToolStatusPresentation': toolStatus,
    './chatActionGrouping': actionGrouping,
    './chatPresentationRun': presentationRun,
    './chatStyles': { createMessageListStyles: () => ({}) },
    './useAgentTransientTimeline': { useAgentTransientTimeline: (_session, messages) => ({ messages }) },
    '@features/chat/messages/application/AgentTransientTimeline': transientStore,
    '@shared/theme': { ...themes, useTheme: () => theme },
    './chatMessageListState': state,
    './chatHistoryPagination': loadModule('src/features/chat/presentation/messages/components/chatHistoryPagination.ts'),
    './useArrivedAssistantMessages': { useArrivedAssistantMessages: (messages) => messages },
  };
  const List = loadModule(
    'src/features/chat/presentation/messages/components/ChatMessageList.tsx',
    (name) => {
      assert.ok(Object.hasOwn(boundaries, name), `未声明的列表依赖：${name}`);
      return boundaries[name];
    },
  ).default;
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback()));
  };
  let messages = [message({ id: 601, senderType: 'reasoning' }), message({ id: 602 })];
  let props = { sessionId: 's1', messages, hasMore: false, isLoadingMore: false, onPreviewFile: () => {}, onDismissInputSurface: () => {} };
  let renderer;
  act(() => { renderer = create(React.createElement(List, props)); });
  const list = () => renderer.root.findByType('FlashList');
  const commit = (height) => {
    act(() => {
      // 模拟 FlashList 自带贴底配置的行为，覆盖第二条滚动入口。
      if (list().props.maintainVisibleContentPosition.autoscrollToBottomThreshold != null) {
        scrolls++; offset = 1000;
      }
      list().props.onContentSizeChange(400, height);
      list().props.onCommitLayoutEffect();
    });
    flushFrames();
  };
  const update = (changes) => {
    props = { ...props, ...changes };
    act(() => renderer.update(React.createElement(List, props)));
  };
  const usageMessage = message({ id: 602, tokensUsed: 120, promptTokens: 100, completionTokens: 20,
    metadataJson: '{"cachedTokens":80}' });
  update({ messages: [messages[0], usageMessage], aiAssistant: { id: 'ai', showTokenUsage: true } });
  assert.equal(list().props.data.at(-1).displayTokensUsed, 120, '开启选择后实际列表提供用量提示');
  update({ aiAssistant: { id: 'ai', showTokenUsage: false } });
  assert.equal(list().props.data.at(-1).displayTokensUsed, 0, '关闭选择后实际列表隐藏所有用量提示');
  assert.equal(usageMessage.tokensUsed, 120, '关闭展示不会修改消息用量事实');
  assert.equal(JSON.parse(usageMessage.metadataJson).cachedTokens, 80);
  update({ aiAssistant: { id: 'ai', showTokenUsage: true } });
  assert.equal(list().props.data.at(-1).displayTokensUsed, 120, '重新开启立即显示已有消息用量');
  update({ messages, aiAssistant: undefined });
  commit(1200);
  scrolls = 0; offset = 600;
  commit(1500);
  commit(1200);
  assert.equal(scrolls, 0, '展开和收起思维链只改变高度，不能滚到底部');
  assert.equal(offset, 600, '展开后阅读位置保留');
  update({ translations: { 602: { text: '译文', sourceLabel: '测试' } } });
  commit(1350);
  assert.equal(scrolls, 0, '展示变化不能冒充新消息');
  messages = [...messages, message({ id: 603, text: '流式正文' })];
  update({ messages }); commit(1450);
  assert.equal(scrolls, 1, '尾部新消息在布局完成后跟随');
  messages = [...messages.slice(0, -1), message({ id: 603, text: '流式正文继续增长' })];
  update({ messages }); commit(1550);
  assert.equal(scrolls, 2, '相同消息身份的流式更新仍应跟随');
  commit(1800);
  assert.equal(scrolls, 2, '消息更新完成后，另一次局部展开不能沿用跟随请求');
  messages = [message({ id: 600 }), ...messages];
  update({ messages }); commit(2000);
  assert.equal(scrolls, 2, '历史 prepend 不触发贴底');
  const away = { nativeEvent: { contentOffset: { y: 100 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 600 } } };
  act(() => {
    list().props.onScrollBeginDrag();
    list().props.onScroll(away);
    list().props.onScrollEndDrag(away);
  });
  messages = [...messages, message({ id: 604 })];
  update({ messages }); commit(2100);
  assert.equal(scrolls, 2, '用户滚离底部时，新消息不得拉回');
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: '查看新消息' }).length > 0, true);
  act(() => list().props.onScrollEndDrag({ nativeEvent: { ...away.nativeEvent, contentOffset: { y: 1500 }, contentSize: { height: 2100 } } }));
  update({ pauseAutoScroll: true, messages: [...messages, message({ id: 605 })] });
  commit(2200);
  assert.equal(scrolls, 2, '分享预览暂停期间不得自动跟随');

  const layout = (height) => {
    act(() => list().props.onLayout({ nativeEvent: { layout: { height } } }));
    flushFrames();
  };
  update({ pauseAutoScroll: false });
  layout(600);
  assert.equal(scrolls, 2, '首次测量视口由列表初始定位负责');
  // 键盘打开时，原生滚动事件可能先于布局事件报告缩小后的视口。
  act(() => list().props.onScroll({ nativeEvent: {
    contentOffset: { y: 1600 }, contentSize: { height: 2200 }, layoutMeasurement: { height: 300 },
  } }));
  layout(300);
  assert.equal(scrolls, 3, '原本贴底时，键盘缩小视口仍应让最新消息出现在键盘上方');
  layout(300);
  commit(2400);
  assert.equal(scrolls, 3, '键盘打开后，同高度布局或思维链展开仍不能强制贴底');
  layout(600);
  assert.equal(scrolls, 4, '键盘收起后，贴底状态随视口恢复');
  act(() => list().props.onScrollEndDrag(away));
  layout(300);
  layout(600);
  assert.equal(scrolls, 4, '阅读历史时，键盘开关不得拉回最新消息');
  act(() => list().props.onScrollEndDrag({ nativeEvent: {
    contentOffset: { y: 1800 }, contentSize: { height: 2400 }, layoutMeasurement: { height: 600 },
  } }));
  update({ pauseAutoScroll: true });
  layout(300);
  assert.equal(scrolls, 4, '分享预览暂停期间，视口变化也不得自动跟随');
  update({ pauseAutoScroll: false });
  // 用户在等待下一帧布局跟随时滚离底部，应取消此次自动跟随。
  act(() => {
    list().props.onLayout({ nativeEvent: { layout: { height: 600 } } });
    list().props.onScrollEndDrag(away);
  });
  flushFrames();
  assert.equal(scrolls, 4, '视口跟随执行前仍应尊重用户新产生的上翻意图');
  act(() => renderer.unmount());
}
console.log('Chat message list state verification passed.');
