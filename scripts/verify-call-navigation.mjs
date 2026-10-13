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
const stack = ['/conversations', pathname];
const navigationQueue = [];
const router = {
  push(pathname) { navigationQueue.push(() => stack.push(pathname)); },
  back() { navigationQueue.push(() => stack.pop()); },
  canGoBack: () => stack.length > 1,
};
const hostModule = load('src/host/KimiPhoneHost.tsx', {
  'react-native': { View: 'view', StyleSheet: { create: (value) => value }, AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) } },
  'expo-router': { useRouter: () => router, usePathname: () => pathname },
  'react-native-safe-area-context': { SafeAreaProvider: passThrough },
  'expo-splash-screen': { preventAutoHideAsync: done, hideAsync: done },
  '@shared/theme': { AppBackground: passThrough, ThemeProvider: passThrough, WallpaperProvider: passThrough },
  '@shared/ui': { AppDialogHost: passThrough },
  '@features/profile': {},
  '@platform/persistence': { initDatabase: done },
  '@features/assistants': { aiAssistantRepository: { getAll: async () => [] } },
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
    pathname = stack.at(-1);
    renderer.update(hostTree());
  });
}
try {
  await act(async () => { renderer = create(hostTree()); });
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
  assert.equal(pathname, '/conversations', '离开聊天后恢复小窗并挂断，应回到原会话列表');
  assert.equal(renderer.root.findAllByType('call-screen').length, 0, '挂断不得留下已失去媒体会话的旧通话页');
  console.log('通话宿主导航检查通过：小窗恢复与迟到查询竞态、单一通话页、挂断返回会话列表。');
} finally {
  if (renderer) await act(async () => { renderer.unmount(); });
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
