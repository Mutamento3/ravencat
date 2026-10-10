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

let call = { id: 'call-1', aiAssistantId: 'ai-1', direction: 'outgoing', state: 'active', acceptedAt: new Date().toISOString() };
let currentRuntime;
const backgroundReads = [];
let speechCallbacks;
let audioCallbacks;
const deletedFrames = [];
let cameraMounts = 0;
let cameraUnmounts = 0;
let microphoneStarts = 0;
let microphoneStops = 0;
let speechStarts = 0;
let speechCloses = 0;
const releasedCalls = [];
const selectedRoutes = [];
const transcripts = [];
const cleanupOrder = [];
let routeListener;
let routeRequest;
let cameraReady;
let deferCamera = true;
let finishReply;
let finishEventRead;
let deferEventRead = false;
const committedEvents = [];
const transcriptFacts = load('src/features/calls/application/events/CallTranscriptFacts.ts');
let routeState = { callId: call.id, revision: 1, route: 'earpiece', availableRoutes: ['earpiece', 'speaker'], pendingRoute: null, errorMessage: null };
function publishRoute(patch) {
  routeState = { ...routeState, ...patch, revision: routeState.revision + 1 };
  routeListener?.(routeState);
}
function finishRoute(error = null) {
  const request = routeRequest;
  routeRequest = null;
  publishRoute({ route: error ? routeState.route : request.route, pendingRoute: null, errorMessage: error });
  if (error) request.reject(new Error(error));
  else request.resolve();
}
const nativeDependencies = {
  native: {
    audioPlayback: {
      async endSession(callId) { releasedCalls.push(callId); cleanupOrder.push('audio-session'); },
      async getRouteState() { return routeState; },
      subscribeRoute(listener) { routeListener = listener; return () => { routeListener = null; }; },
      selectRoute(callId, route) {
        assert.equal(callId, call.id);
        selectedRoutes.push(route);
        publishRoute({ pendingRoute: route, errorMessage: null });
        return new Promise((resolve, reject) => { routeRequest = { route, resolve, reject }; });
      },
    },
    async requestCallCameraPermission() { return { granted: true }; },
    async requestMicrophonePermission() { return { granted: true }; },
    execution: {
      async isAlive() { return true; },
      async setPresentation() {}, async setMicrophone() {},
      async setCamera(callId, enabled) {
        if (enabled) {
          cameraMounts += 1;
          if (deferCamera) await new Promise(resolve => { cameraReady = resolve; });
        }
        else { cameraUnmounts += 1; cleanupOrder.push('camera'); }
      },
      async capture() { return { uri: 'file:///native-frame.jpg', width: 100, height: 100 }; },
      async deleteSnapshot(uri) { deletedFrames.push(uri); },
    },
  },
  repositories: { calls: {
    async getSessionById() { return call; },
    async appendEvent(event) {
      const committed = { ...event, id: `event-${committedEvents.length}`, createdAt: new Date().toISOString() };
      committedEvents.push(committed);
      return committed;
    },
  } },
};
const dependenciesModule = { getCallRuntimeDependencies: () => nativeDependencies };
const nativeStarts = [];
const { createCallExecutionAdapter } = load('src/features/calls/infrastructure/NativeCallExecutionAdapter.ts', {
  '../../../../modules/call-runtime': { nativeCallRuntime: { async start(options) { nativeStarts.push(options); } } },
});
const executionAdapter = createCallExecutionAdapter(id => `kimiphone://calls/${id}`, async assistantId => {
  assert.equal(assistantId, 'ai-1');
  return { name: 'AI', avatar: 'file:///ai-avatar.jpg' };
});
await executionAdapter.start(call);
assert.deepEqual(nativeStarts, [{
  callId: 'call-1', name: 'AI', avatarUri: 'file:///ai-avatar.jpg', direction: 'outgoing', returnUri: 'kimiphone://calls/call-1',
}], '通话宿主的展示契约携带当前 AI 头像，不使用全屏通话背景代替');
const transcriptWriter = load('src/features/calls/application/events/AppendCallTranscriptEvent.ts', {
  '../runtime/CallRuntimeDependencies': dependenciesModule,
  './CallTranscriptFacts': transcriptFacts,
});
const { CallTTSPlaybackQueue } = load('src/features/calls/application/runtime/CallTTSPlaybackQueue.ts', {
  '@platform/device': { temporarySpeechAudioStore: { async deleteIfExists() {} } },
  '@features/speech': { async synthesizeTextToSpeech() { return { success: true, audioUri: 'file:///sentence.wav' }; } },
  '../events/AppendCallSystemEvent': { async appendCallErrorEvent() {} },
  '../events/CallTranscriptFacts': transcriptFacts,
  './CallRuntimeDependencies': dependenciesModule,
});
nativeDependencies.native.audioPlayback.play = async () => ({ playbackId: 'sentence', finished: Promise.resolve() });
const media = load('src/features/calls/application/runtime/CallMediaSession.ts', { './CallRuntimeDependencies': dependenciesModule });
const snapshots = load('src/features/calls/application/snapshots/CallSnapshotProviderRegistry.ts');
const application = {
  ...snapshots,
  async getCallSession() { return call; },
  async listCallEvents() {
    const snapshot = [...committedEvents];
    if (deferEventRead) return new Promise(resolve => { finishEventRead = () => resolve(snapshot); });
    return snapshot;
  },
  async loadCallBackgroundUri(assistantId) { backgroundReads.push(assistantId); return 'file:///role-background.jpg'; },
  async appendCallCameraStateEvent() {},
  async appendCallErrorEvent() {},
  async attachCallSnapshot() { return { callId: call.id }; },
  getCallReplyRunPhase: () => 'idle',
  subscribeCallReplyRunPhase: () => () => {},
  subscribeCallSentencePlayback: () => () => {},
  callTTSPlaybackQueue: { async interruptForUserSpeech() {} },
  async submitCallUserInput({ userText }) {
    transcripts.push(userText);
    await transcriptWriter.appendUserSpeechText({ callId: call.id, text: userText });
    await new Promise(resolve => { finishReply = resolve; });
    return { status: 'completed' };
  },
  async endCall() {
    call = { ...call, state: 'ended', endReason: 'userEnded' };
    await media.finishCallMediaSession(call);
    return { call };
  },
};
const runtimeModule = load('src/features/calls/application/runtime/CallMediaRuntime.ts', {
  'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
  'expo-image-picker': {},
  'expo-camera': { Camera: { async requestMicrophonePermissionsAsync() { return { granted: true }; } } },
  '@features/assistants': { async listAIAssistants() { return [{ id: 'ai-1', name: 'AI' }]; } },
  '@features/profile': { async getCurrentUserProfile() { return { name: '用户' }; } },
  '@features/speech': {
    async startRealtimeSpeechToText(options) {
      speechStarts += 1;
      speechCallbacks = options;
      return { success: true, session: {
        sendAudioChunk() {}, finish() {},
        close() { speechCloses += 1; cleanupOrder.push('asr'); },
      } };
    },
  },
  '@platform/device': { realtimeSpeechAudioSource: {
    async start(options) {
      microphoneStarts += 1;
      audioCallbacks = options;
      return { echoCancellationEnabled: true, async stop() { microphoneStops += 1; cleanupOrder.push('microphone'); } };
    },
  } },
  '../lifecycle': application,
  '../queries/GetCallSession': application,
  '../CallBackgroundSettings': application,
  '../events/AppendCallSystemEvent': application,
  '../events/AppendCallCameraStateEvent': application,
  '../events/CallTranscriptFacts': transcriptFacts,
  '../snapshots/AttachCallSnapshot': application,
  '../snapshots/CallSnapshotProviderRegistry': application,
  './RunCallTurn': application,
  './CallReplyRunState': application,
  './CallTTSPlaybackQueue': application,
  './CallRuntimeDependencies': dependenciesModule,
  './CallRuntimeHelpers': load('src/features/calls/application/runtime/CallRuntimeHelpers.ts'),
  './CallSpeechDuplexGuard': load('src/features/calls/application/runtime/CallSpeechDuplexGuard.ts'),
  './CallMediaSession': media,
});

const registry = load('src/features/calls/application/runtime/CallMediaRuntimeRegistry.ts');
const { CallRuntimeProvider, useCallRuntime } = load('src/features/calls/presentation/CallRuntimeProvider.tsx', {
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24 }) },
  '../application/runtime/CallMediaRuntimeRegistry': registry,
  '../application/runtime/CallRuntimeDependencies': dependenciesModule,
});
function Screen({ callId }) { currentRuntime = useCallRuntime(callId); return React.createElement('screen'); }
function MiniWindow({ callId }) { currentRuntime = useCallRuntime(callId); return React.createElement('mini-window'); }
function tree(callId, minimized) {
  return React.createElement(CallRuntimeProvider, { callId, minimized, onMinimizedCallEnded() {} },
    callId ? React.createElement(minimized ? MiniWindow : Screen, { callId }) : null);
}

const scrolls = [];
const ScrollView = React.forwardRef(function LyricsScrollView(props, ref) {
  React.useImperativeHandle(ref, () => ({ scrollToEnd: options => { scrolls.push(options); } }));
  return React.createElement('lyrics-scroll', props);
});
const { default: TranscriptOverlay } = load('src/features/calls/presentation/components/CallTranscriptOverlay.tsx', {
  'react-native': { ScrollView, Text: 'lyric', View: 'view' },
  '@shared/theme': { useThemedStyles: () => ({}) },
  './CallTranscriptOverlay.styles': {},
});
const previousAnimationFrame = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = callback => { callback(); return 0; };
let lyrics;
const renderLyrics = () => React.createElement(TranscriptOverlay, {
  events: currentRuntime.events,
  interimText: currentRuntime.pendingUserSpeechText || currentRuntime.interimSpeechText,
});
const lyricTexts = () => lyrics.root.findAllByType('lyric').map(row => row.props.children);

let renderer;
try {
  const hosted = runtimeModule.createCallMediaRuntime(call.id);
  registry.registerHostedCallMediaRuntime(call.id, hosted);
  await hosted.initialize();
  await act(async () => { renderer = create(tree(call.id, false)); });
  assert.equal(currentRuntime.call.id, call.id);
  assert.deepEqual(backgroundReads, [call.aiAssistantId], '通话根据会话中的角色读取背景');
  assert.equal(currentRuntime.backgroundUri, 'file:///role-background.jpg');
  let opening;
  await act(async () => {
    await currentRuntime.startRealtimeSpeech();
    opening = currentRuntime.toggleCamera();
  });
  assert.equal(currentRuntime.cameraEnabled, true, '第一次点击立即提交摄像头开启状态');
  assert.equal(currentRuntime.isCameraReady, false, '原生绑定期间显示启动状态');
  assert.equal((await snapshots.requestCallSnapshotFromProvider(call.id, 'look_at_user')).status, 'camera_not_ready', '启动中的画面不能误报可截帧');
  await act(async () => { cameraReady(); await opening; });
  deferCamera = false;
  let switching;
  await act(async () => { switching = currentRuntime.cycleAudioRoute(); });
  assert.equal(currentRuntime.audioRoute, 'earpiece', '请求成功前不得把目标设备画成实际路由');
  assert.equal(currentRuntime.isAudioRouteSwitching, true);
  await act(async () => { await currentRuntime.cycleAudioRoute(); });
  assert.deepEqual(selectedRoutes, ['speaker'], '连续点击不能发出多个切换请求');
  await act(async () => { finishRoute(); await switching; });
  assert.equal(currentRuntime.audioRoute, 'speaker');
  assert.equal(currentRuntime.isAudioRouteSwitching, false);
  await act(async () => { publishRoute({ route: 'headset', availableRoutes: ['earpiece', 'speaker', 'headset'] }); });
  assert.equal(currentRuntime.audioRoute, 'headset', '耳机接入以原生实际设备事件更新');
  assert.equal(currentRuntime.availableAudioRoutes.length, 3);
  await act(async () => { switching = currentRuntime.cycleAudioRoute(); });
  assert.equal(currentRuntime.audioRoute, 'headset');
  await act(async () => { finishRoute(); await switching; });
  assert.equal(currentRuntime.audioRoute, 'earpiece', '三态从耳机循环回听筒');
  await act(async () => { switching = currentRuntime.cycleAudioRoute(); });
  await act(async () => { finishRoute('测试：切换被系统拒绝'); await switching; });
  assert.equal(currentRuntime.audioRoute, 'earpiece');
  assert.equal(currentRuntime.errorMessage, '测试：切换被系统拒绝');
  assert.equal(currentRuntime.isAudioRouteSwitching, false);
  await act(async () => { publishRoute({ availableRoutes: ['earpiece', 'speaker'], errorMessage: null }); });
  assert.equal(currentRuntime.availableAudioRoutes.length, 2);
  await act(async () => { routeListener({ ...routeState, revision: 1, route: 'speaker' }); });
  assert.equal(currentRuntime.audioRoute, 'earpiece', '晚到的旧快照不能覆盖最新实际设备');
  assert.equal(currentRuntime.isListening, true);
  assert.equal(currentRuntime.cameraEnabled, true);
  assert.equal(currentRuntime.isCameraReady, true);
  assert.equal(currentRuntime.audioRoute, 'earpiece');
  const originalAudioCallbacks = audioCallbacks;

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await act(async () => { renderer.update(tree(call.id, true)); });
    assert.equal(currentRuntime.isListening, true);
    assert.equal(currentRuntime.audioRoute, 'earpiece');
    let frame;
    await act(async () => { frame = await snapshots.requestCallSnapshotFromProvider(call.id, 'look_at_user'); });
    assert.equal(frame.status, 'captured', '小窗中仍能获取当前相机快照');
    await act(async () => { renderer.update(tree(call.id, false)); });
  }
  assert.deepEqual(deletedFrames, Array(3).fill('file:///native-frame.jpg'), '快照转交后释放每一个原生临时文件');
  assert.equal(microphoneStarts, 1);
  assert.equal(microphoneStops, 0);
  assert.equal(speechStarts, 1);
  assert.equal(speechCloses, 0);
  assert.equal(cameraMounts, 1);
  assert.equal(cameraUnmounts, 0);
  assert.equal(audioCallbacks, originalAudioCallbacks);
  assert.deepEqual(selectedRoutes, ['speaker', 'earpiece', 'speaker'], '切换展示端不能重新设置默认路由');
  assert.deepEqual(releasedCalls, []);

  await act(async () => { speechCallbacks.onFinalTranscript({ index: 0, text: '收起后继续说话' }); });
  assert.deepEqual(transcripts, ['收起后继续说话']);
  assert.equal(currentRuntime.pendingUserSpeechText, null, '用户文本提交后立即替换临时行，无需等待模型回复');
  await act(async () => { lyrics = create(renderLyrics()); });
  assert.deepEqual(lyricTexts(), ['收起后继续说话']);
  const tts = new CallTTSPlaybackQueue();
  await act(async () => {
    await tts.enqueueAISpeech({ callId: call.id, assistantId: 'ai-1', text: '第一句。' });
  });
  await act(async () => { lyrics.update(renderLyrics()); });
  assert.deepEqual(lyricTexts(), ['收起后继续说话', '第一句。'], 'AI 逐句开播追加在用户之后，播放结束仍保留');
  const firstRow = lyrics.root.findAllByType('lyric')[1];
  const previousScrolls = scrolls.length;
  await act(async () => {
    await tts.enqueueAISpeech({ callId: call.id, assistantId: 'ai-1', text: '第二句。' });
  });
  await act(async () => { lyrics.update(renderLyrics()); });
  assert.deepEqual(lyricTexts(), ['收起后继续说话', '第一句。', '第二句。'], '整轮回复仍未结束时也保留全部已播放句子');
  assert.equal(lyrics.root.findAllByType('lyric')[1], firstRow, '历史行不因后一句开播重建');
  assert.ok(scrolls.length > previousScrolls, '贴底时新句自动跟随歌词流');
  await act(async () => { lyrics.root.findByType('lyrics-scroll').props.onScrollBeginDrag(); });
  const historyScrolls = scrolls.length;
  await act(async () => {
    await tts.enqueueAISpeech({ callId: call.id, assistantId: 'ai-1', text: '第三句。' });
  });
  await act(async () => { lyrics.update(renderLyrics()); });
  assert.equal(scrolls.length, historyScrolls, '翻历史时新句不抢夺滚动位置');
  deferEventRead = true;
  let staleRefresh;
  await act(async () => { staleRefresh = currentRuntime.refresh(); });
  await act(async () => {
    await transcriptWriter.appendUserSpeechText({ callId: call.id, text: '新提交的文本' });
    finishEventRead();
    await staleRefresh;
  });
  deferEventRead = false;
  assert.equal(currentRuntime.events.at(-1).text, '新提交的文本', '晚到历史查询不能覆盖已提交的新字幕');
  await act(async () => { transcriptFacts.publishCallTranscriptFact(committedEvents.at(-1)); });
  assert.equal(currentRuntime.events.filter(event => event.text === '新提交的文本').length, 1, '历史读取与提交推送共用事件身份去重');
  await act(async () => { finishReply(); });
  assert.deepEqual(currentRuntime.events.filter(event => event.kind === 'ttsStarted').map(event => event.text), ['第一句。', '第二句。', '第三句。']);
  await act(async () => { await currentRuntime.stopRealtimeSpeech(); });
  assert.deepEqual(releasedCalls, [], '暂停录音不结束通话音频会话');
  await act(async () => { await currentRuntime.startRealtimeSpeech(); });
  cleanupOrder.length = 0;
  await act(async () => { assert.equal(await currentRuntime.hangUp(), true); });
  assert.equal(currentRuntime.isListening, false);
  assert.equal(currentRuntime.cameraEnabled, false);
  assert.equal(cameraUnmounts, 1);
  assert.deepEqual(cleanupOrder, ['microphone', 'asr', 'camera', 'audio-session']);
  assert.deepEqual(releasedCalls, ['call-1']);

  await act(async () => { renderer.update(tree(null, false)); });
  call = { ...call, id: 'call-2', state: 'active', endReason: null };
  routeState = { ...routeState, callId: call.id, revision: 1, route: 'earpiece', errorMessage: null };
  await act(async () => {
    const hosted = runtimeModule.createCallMediaRuntime(call.id);
    registry.registerHostedCallMediaRuntime(call.id, hosted);
    await hosted.initialize();
    renderer.update(tree(call.id, false));
  });
  await act(async () => { routeListener({ ...routeState, callId: 'call-1', revision: 100, route: 'headset' }); });
  assert.equal(currentRuntime.audioRoute, 'earpiece', '上一通电话的晚到设备事件不能影响新通话');
  assert.equal(currentRuntime.isListening, false);
  assert.equal(currentRuntime.cameraEnabled, false);
  assert.equal(currentRuntime.audioRoute, 'earpiece');
  await act(async () => { await currentRuntime.startRealtimeSpeech(); await currentRuntime.toggleCamera(); });
  cleanupOrder.length = 0;
  await act(async () => {
    call = { ...call, state: 'ended', endReason: 'aiEnded' };
    await media.finishCallMediaSession(call);
  });
  assert.equal(currentRuntime.shouldExit, true);
  assert.equal(currentRuntime.isListening, false);
  assert.equal(currentRuntime.cameraEnabled, false);
  assert.deepEqual(cleanupOrder, ['microphone', 'asr', 'camera', 'audio-session']);
  console.log('通话媒体生命周期检查通过：首次相机启动、逐句歌词追加/跟随/翻历史、晚到读取与去重、路由、收起/恢复、快照、语音、暂停、用户/AI挂断与下一通电话。');
} finally {
  if (lyrics) await act(async () => { lyrics.unmount(); });
  if (renderer) await act(async () => { renderer.unmount(); });
  globalThis.requestAnimationFrame = previousAnimationFrame;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
