import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 用实际 React 生命周期运行产品 hook，替身仅替代设备、数据库与网络边界。
function load(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  module.require = (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id);
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  return module.exports;
}

let call = { id: 'call-1', state: 'active', chatSessionId: 'session-1' };
let renderer;

// 聊天输入状态直接消费 Calls 的接通标记；重挂页面不改变通话生命周期。
const chatCallGateway = load('src/features/chat/conversation/application/ChatCallGateway.ts');
let activeCallSnapshot = null;
const activeCallListeners = new Set();
chatCallGateway.configureChatCallGateway({
  getActiveCallSnapshot: () => activeCallSnapshot,
  subscribeActiveCall(listener) {
    activeCallListeners.add(listener);
    return () => activeCallListeners.delete(listener);
  },
});
const chatDetail = load('src/features/chat/presentation/messages/ChatDetail/useChatDetail.ts', {
  '../components/chatTypes': { buildAIRequestConfig: (assistant) => assistant },
  '../components/useMessageHistoryState': { useMessageHistoryState: () => ({ messages: [] }) },
  '../components/useChatTimelineSync': { useChatTimelineSync() {} },
  './useChatSendFlow': { useChatSendFlow: () => ({}) },
  '../../../conversation/application/ChatCallGateway': chatCallGateway,
  '@shared/theme': { useTheme: () => ({}), getChatInteractionProfile: () => ({ enableAssistantMessageSegmentation: true }) },
});
let chatBlocked;
function ChatInputState({ sessionId = 'session-1', assistantId = 'ai-1' }) {
  chatBlocked = chatDetail.useChatDetail(sessionId, { id: assistantId }).isChatSendBlockedByActiveCall;
  return null;
}
try {
  await act(async () => { renderer = create(React.createElement(ChatInputState)); });
  assert.equal(chatBlocked, false);
  await act(async () => {
    activeCallSnapshot = { id: 'chat-call', state: 'active', chatSessionId: 'session-1', aiAssistantId: 'ai-1' };
    for (const listener of activeCallListeners) listener();
  });
  assert.equal(chatBlocked, true, '接通通知立即阻断输入');
  await act(async () => { renderer.update(React.createElement(ChatInputState, { sessionId: 'other', assistantId: 'other-ai' })); });
  assert.equal(chatBlocked, false, '其他角色的聊天不受影响');
  await act(async () => { renderer.update(React.createElement(ChatInputState, { sessionId: 'other', assistantId: 'ai-1' })); });
  assert.equal(chatBlocked, true, '同一 AI 的另一会话仍受通话限制');
  await act(async () => { renderer.unmount(); });
  assert.equal(activeCallListeners.size, 0, '卸载只释放订阅');
  assert.equal(activeCallSnapshot.id, 'chat-call', '页面卸载不清除接通标记');
  await act(async () => { renderer = create(React.createElement(ChatInputState)); });
  assert.equal(chatBlocked, true, '重新进入聊天直接读取当前接通标记');
  await act(async () => {
    activeCallSnapshot = null;
    for (const listener of activeCallListeners) listener();
  });
  assert.equal(chatBlocked, false, '挂断通知立即解除输入限制');
} finally {
  if (renderer) await act(async () => { renderer.unmount(); });
  renderer = null;
}

// 保留 Router 的异步派发边界：小窗恢复先提交 Host 状态，路径稍后才改变。
// 使用真实 Host 验证迟到的自动恢复不会留下第二层通话页；媒体生命周期另有专项验证。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const passThrough = ({ children }) => children;
const noop = () => {};
const done = async () => {};
const arrival = { pendingMessageIds: [] };
let pathname = '/chat/ai-1';
let hostActions;
let chatProps;
let resolveActiveQuery;
let deferActiveQuery = false;
const originalChatHref = `${pathname}?sessionId=session-1`;
const stack = ['/conversations', originalChatHref];
const navigationQueue = [];
const nativeLeaves = [];
const router = {
  push(pathname) { navigationQueue.push(() => stack.push(pathname)); },
  back() { navigationQueue.push(() => stack.pop()); },
  dismissTo(href) {
    navigationQueue.push(() => {
      const index = stack.lastIndexOf(href);
      if (index < 0) stack[stack.length - 1] = href;
      else stack.splice(index + 1);
    });
  },
  canGoBack: () => stack.length > 1,
};
const navigationContainerRef = { dispatch: noop };
const hostModule = load('src/host/KimiPhoneHost.tsx', {
  '../../modules/kimiphone-notifications': { async leaveCallScreen(callId, finished) { nativeLeaves.push({ callId, finished }); } },
  'react-native': { View: 'view', StyleSheet: { create: (value) => value }, AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) } },
  'expo-router': { useRouter: () => router, usePathname: () => pathname, useUnstableGlobalHref: () => stack.at(-1), useNavigationContainerRef: () => navigationContainerRef },
  'react-native-safe-area-context': { SafeAreaProvider: passThrough },
  'expo-splash-screen': { preventAutoHideAsync: done, hideAsync: done },
  '@shared/theme': { AppBackground: passThrough, ThemeProvider: passThrough, WallpaperProvider: passThrough },
  '@shared/ui': { AppDialogHost: passThrough },
  '@features/profile': {},
  '@platform/persistence': { initDatabase: done },
  '@features/assistants': { aiAssistantRepository: { listIds: async () => [] } },
  '@platform/device': { initializeNotifications: done, consumePendingNotificationResponses: async () => [], addNotificationResponseListener: () => ({ remove: noop }), getMessageArrivalSnapshot: async () => arrival },
  '@features/calls': {
    CallRuntimeProvider: passThrough,
    getActiveCall: () => deferActiveQuery ? new Promise((resolve) => { resolveActiveQuery = resolve; }) : Promise.resolve(null),
    getCallSession: async () => call,
    reconcileInterruptedCallFromPreviousProcess: async () => null,
    shouldRestoreCallScreen: () => true,
  },
  '@features/chat': { ChatRouterProvider: (props) => { chatProps = props; return props.children; }, listGroupChats: async () => [], getAssistantMessageArrivalSnapshot: () => arrival, subscribeAIMessageReceived: () => noop },
  '@features/chat/composition': { messageRepository: {}, setChatForegroundContext: noop, clearSessionTimelineCache: noop, emitChatMessagesUpdated: noop, applyAssistantMessageArrivalSnapshot: noop, interruptAbandonedGroupSpeechPlans: done },
  './composition/configureHostRuntime': { configureHostRuntime: noop },
  './shell/ApplicationUpdateProvider': { ApplicationUpdateProvider: passThrough },
  './composition/completePendingBackupRestore': { completePendingBackupRestore: done },
  './composition/migrateLegacyAvatarReferences': {},
  './media/LegacyMediaMigrationReporting': {},
  './runtime/StartupRecoveryCoordinator': { runStartupRecovery: done },
  './runtime/FloatingConversationProjection': { setFloatingConversationDatabaseReady: noop, syncFloatingConversation: done },
  './runtime/ConversationTurnCoordinator': { getConversationTurnCoordinator: () => ({ resumeTurnsAfterReset: noop }) },
  './runtime/AIMessageDeliveryCoordinator': {},
  '@shared/runtime/ConversationListReadySignal': {},
  './composition/agent': { resumeHostAgentRunsAfterReset: noop },
  './shell/HostErrorBoundary': { default: passThrough, __esModule: true },
  '@features/companion': { useCompanionFloatingBridge: noop },
  '@features/floatingLayer': { setAppForeground: done },
  '@features/deviceControl': { reconcileDeviceControl: async () => ({ active: [], native: {} }) },
  '@host/navigation/externalNavigation': {},
  '@host/navigation/useRootNavigationReady': { useRootNavigationReady: () => true },
  './application/resetApplicationData': {},
  './runtime/StickerAnnotationQueueCoordinator': { setStickerAnnotationForegroundActive: noop, initializeStickerAnnotationQueue: done, requestStickerAnnotationRun: noop },
  './runtime/StickerEmbeddingQueueCoordinator': { setStickerEmbeddingForegroundActive: noop, requestStickerEmbeddingRun: noop },
  './runtime/MemoryEmbeddingQueueCoordinator': { setMemoryEmbeddingForegroundActive: noop },
  './runtime/ChatSummaryQueueCoordinator': { setChatSummaryForegroundActive: noop },
  '@features/togetherListening': { reconcileTogetherListeningSystemPresentation: done, TogetherListeningInAppIndicator: () => null },
});
function HostRoute() {
  hostActions = hostModule.useHostCallActions();
  return pathname.startsWith('/calls/')
    ? React.createElement('call-screen')
    : React.createElement('conversation-list');
}
const hostTree = () => React.createElement(hostModule.default, null, React.createElement(HostRoute));
async function flushNavigation() {
  await act(async () => {
    navigationQueue.splice(0).forEach((navigate) => navigate());
    pathname = stack.at(-1).split('?')[0];
    renderer.update(hostTree());
  });
}
try {
  await act(async () => { renderer = create(hostTree()); });
  await act(async () => { chatProps.onCallCreated(call); });
  await flushNavigation();
  await act(async () => { hostActions.closeCallScreen(call.id); });
  await flushNavigation();
  assert.equal(pathname, '/chat/ai-1', '聊天发起的通话结束后保留原聊天页');
  await act(async () => { chatProps.onCallCreated(call); });
  await flushNavigation();
  await act(async () => { hostActions.minimizeCallScreen(call.id); });
  await flushNavigation();
  // 退出聊天，通话继续以小窗显示。
  await act(async () => { router.back(); });
  await flushNavigation();
  deferActiveQuery = true;
  await act(async () => { chatProps.onCallCreated(call); });
  await flushNavigation();
  await act(async () => { resolveActiveQuery(call); });
  await flushNavigation();
  assert.equal(stack.filter((path) => path.startsWith('/calls/')).length, 1, '小窗恢复与自动恢复竞态不得重复压入通话页');
  await act(async () => {
    call = { ...call, state: 'ended', endReason: 'userEnded' };
    hostActions.closeCallScreen(call.id);
  });
  await flushNavigation();
  assert.equal(pathname, '/chat/ai-1', '小窗恢复不得覆盖首次发起通话的聊天来源');
  assert.equal(renderer.root.findAllByType('call-screen').length, 0, '挂断不得留下已失去媒体会话的旧通话页');
  assert.deepEqual(nativeLeaves.map(leave => leave.finished), [true, false, true], '关闭或收起在退出路由前交给原生处理来源');
  deferActiveQuery = false;
  call = { ...call, id: 'call-2', state: 'active' };
  await act(async () => { chatProps.onCallCreated(call); });
  await flushNavigation();
  // Activity 销毁后 Headless/JS 进程仍活着；深链重建只留下通话路由，没有聊天栈。
  await act(async () => { renderer.unmount(); });
  stack.splice(0, stack.length, `/calls/${call.id}`);
  pathname = stack.at(-1);
  await act(async () => { renderer = create(hostTree()); });
  await act(async () => { hostActions.activateCallScreen(call.id); });
  await act(async () => {
    call = { ...call, state: 'ended', endReason: 'aiEnded' };
    hostActions.closeCallScreen(call.id);
  });
  await flushNavigation();
  assert.equal(stack.at(-1), originalChatHref, 'Activity 重建后 AI 挂断仍恢复首次发起的聊天及会话参数');
  console.log('通话宿主导航检查通过：首次聊天来源、小窗恢复竞态、Activity 重建后 AI 挂断、会话参数保留。');
} finally {
  if (renderer) await act(async () => { renderer.unmount(); });
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}

// 运行真实通话页面和挂断按钮，复现“终态先到、清理稍后完成”的异步顺序。
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const rn = { View: 'view', Text: 'text', TouchableOpacity: 'button', ActivityIndicator: 'loading',
  BackHandler: { addEventListener: () => ({ remove: noop }) } };
const theme = { useTheme: () => ({ colors: { feedback: { error: 'red' }, icon: { inverse: 'white' } } }), useThemedStyles: () => ({}) };
const activeScreen = load('src/features/calls/presentation/CallActiveScreen.tsx', {
  'react-native': rn,
  '@shared/ui': {}, '@shared/theme': theme,
  'react-native-safe-area-context': { SafeAreaView: passThrough, useSafeAreaInsets: () => ({ top: 0 }) },
  'expo-status-bar': { StatusBar: () => null },
  'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
  './styles': {},
  './components/CallAvatarHeader': { default: () => null, __esModule: true },
  './components/CallBackgroundLayer': { default: passThrough, __esModule: true },
  './components/CallTranscriptOverlay': { default: () => null, __esModule: true },
  './components/CallControls': { default: () => null, __esModule: true },
  './components/CallTextInputModal': { default: () => null, __esModule: true },
  '../application/runtime/CallRuntimeDependencies': {},
});
let runtime;
const screen = load('src/features/calls/presentation/CallScreen.tsx', {
  'react-native': rn, '@shared/ui': {},
  './CallRuntimeProvider': { useCallRuntime: () => runtime },
  './CallActiveScreen': activeScreen,
}).default;
let closeCount = 0;
let finishHangUp;
const page = () => React.createElement(screen, { callId: 'call', onClose: () => { closeCount++; }, onMinimize: noop });
try {
  runtime = { call: { id: 'call', state: 'active' }, availableAudioRoutes: [], elapsedSeconds: 0,
    async hangUp() {
      runtime = { ...runtime, call: { ...runtime.call, state: 'ended' } };
      renderer.update(page());
      await new Promise(resolve => { finishHangUp = resolve; });
      return true;
    } };
  await act(async () => { renderer = create(page()); });
  let hangingUp;
  await act(async () => { hangingUp = renderer.root.findAllByType('button').at(-1).props.onPress(); });
  assert.equal(closeCount, 1, '终态立即退出，不等待挂断清理完成');
  assert.equal(renderer.toJSON(), null, '终态不绘制任何结束页或返回聊天中间态');
  await act(async () => {
    runtime = { ...runtime, shouldExit: true };
    renderer.update(page());
    finishHangUp();
    await hangingUp;
  });
  assert.equal(closeCount, 1, '清理信号和挂断回执晚到不得再返回一层');
  await act(async () => { renderer.unmount(); });
  for (const state of ['ended', 'rejected', 'missed', 'failed']) {
    closeCount = 0;
    runtime = { call: { id: 'call', state } };
    await act(async () => { renderer = create(page()); });
    assert.equal(closeCount, 1, `${state} 终态进入立即退出`);
    assert.equal(renderer.toJSON(), null);
    await act(async () => { renderer.unmount(); });
  }
  console.log('通话页面退出检查通过：终态立即退出、清理继续、晚到信号不重复返回、所有终态无结束页。');
} finally {
  if (renderer) await act(async () => { renderer.unmount(); });
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
