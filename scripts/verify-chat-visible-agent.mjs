import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relativePath = 'src/features/chat/reply/application/RunChatVisibleAgent.ts';
const absolutePath = path.join(repoRoot, relativePath);
const source = fs.readFileSync(absolutePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: absolutePath,
  reportDiagnostics: true,
});
assert.deepEqual(
  (compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error),
  [],
);

const durableMessages = [];
const commitCalls = [];
const uiSignals = [];
const transientEvents = [];
const repository = {
  upsertStatefulTimelineEntry: async (input) => {
    commitCalls.push({ messages: [input.message], previewText: input.previewText });
    const previous = durableMessages.find((message) => message.clientMessageId === input.message.clientMessageId);
    if (previous) { Object.assign(previous, input.message); return { message: previous, inserted: false }; }
    const message = { ...input.message, id: durableMessages.length + 1, showTimeSeparatorBefore: false };
    durableMessages.push(message);
    return { message, inserted: true };
  },
  commitMessages: async (input) => {
    commitCalls.push(input);
    const inserted = input.messages.map((message, index) => ({
      ...message,
      id: durableMessages.length + index + 1,
      isRead: false,
      showTimeSeparatorBefore: false,
    }));
    durableMessages.push(...inserted);
    return inserted;
  },
};
repository.upsertStatefulTimelineEntryInTransaction = (transaction, input) => repository.upsertStatefulTimelineEntry(input);

let projectorParams;
let mediaItems = null;
const deliveredMessages = [];
class TestProjector {
  constructor(params) {
    projectorParams = params;
  }

  async projectModelTurn(stepIndex, turn) {
    transientEvents.push({ type: 'model_turn', stepIndex, turn });
  }

  async handleEvent(event) {
    transientEvents.push(event);
  }

  async completeRun() {
    const result = await projectorParams.projection.commit.commitAgentTimeline({
      sessionId: projectorParams.sessionId,
      aiConfig: projectorParams.aiConfig, runtimeContext: projectorParams.runtimeContext,
      items: mediaItems ?? [
        { message: message('reasoning', '思考', `${projectorParams.replyRunId}:1`) },
        { message: message('system', '调用完成：安排自主醒来', `${projectorParams.replyRunId}:2`) },
      ],
    });
    projectorParams.timelineSink.onCommitted?.({
      runId: 'run-visible',
      messages: result.messages,
      outcome: result.outcome,
    });
  }

  async failRun() {}
  async failActivityRun() {}
  async checkpointActivityTimeline() { if (mediaItems) await this.completeRun(); }
}

const terminal = {
  runId: 'run-visible',
  taskId: 'task-visible',
  status: 'completed',
  terminalCode: 'COMPLETED',
  finalText: '内部结论',
  history: [],
  steps: [{ stepIndex: 1 }],
  stepCount: 1,
  toolCallCount: 1,
};
const runtimeDependencies = {
  tools: {},
  agent: {
    run: async (request) => {
      await request.eventSink({ type: 'model_turn_started', runId: request.runId, stepIndex: 1 });
      await request.eventSink({
        type: 'model_turn_completed', runId: request.runId, stepIndex: 1, hasToolCalls: false,
      });
      return terminal;
    },
  },
};
const module = { exports: {} };
const mocks = {
  '@platform/persistence': { databaseCoordinator: { openTaskExecutor: () => ({ withExclusiveTransactionAsync: (task) => task({}) }) } },
  '../../messages/domain': { buildSessionPreviewTextFromMessage: (message) => message.text },
  './CommittedAssistantSegmentDelivery': { deliverCommittedAssistantSegment: async (params) => deliveredMessages.push(params) },
  '../../messages/application/AgentTransientTimeline': {
    createAgentTransientTimelineSink: () => ({
      onCommitted: (event) => transientEvents.push({ type: 'committed', event }),
    }),
  },
  '../../messages/application/ChatMessageRuntime': {
    getChatMessageRuntimeDependencies: () => ({ messages: repository }),
  },
  '../../messages/events/ChatEvents': {
    emitChatMessagesUpdated: (sessionId) => uiSignals.push(sessionId),
  },
  '../agent/ChatAgentRunProjector': {
    ChatAgentRunFailedError: class extends Error {},
    ChatAgentRunProjector: TestProjector,
  },
  './ChatReplyMetadata': {
    buildMessageMetadata: (aiConfig, context, extra) => ({ ...context, ...extra }),
  },
  './ChatReplyUtils': { formatMessageTime: () => '08:00' },
  './ChatReplyRuntimeDependencies': {
    getChatReplyRuntimeDependencies: () => runtimeDependencies,
  },
};
new Function('exports', 'require', 'module', '__filename', '__dirname', compiled.outputText)(
  module.exports,
  (specifier) => {
    assert.ok(Object.hasOwn(mocks, specifier), `未声明运行时 mock：${specifier}`);
    return mocks[specifier];
  },
  module,
  absolutePath,
  path.dirname(absolutePath),
);

const modelTurn = { assistantText: '内部结论', reasoningText: '', toolCalls: [] };
const result = await module.exports.runChatVisibleAgent({
  sessionId: 'session-visible',
  runId: 'run-visible',
  aiConfig: {
    id: 'host-ai', agentId: 'host-agent', name: 'Raven', model: 'model',
    apiKey: 'key', apiBaseUrl: 'https://example.test', allowMultipleBubbles: true,
  },
  runtimeContext: {
    triggerSource: 'raven_cat_wake', triggerReason: 'self_wake',
    relatedEntityType: 'raven_cat_self_wake', relatedEntityId: 'wake-visible',
  },
  finalAssistantPolicy: 'commit_as_reply',
  prepare: async () => ({
  request: {
    task: {
      id: 'task-visible', type: 'raven_cat_autonomous', source: 'raven_cat_wake', goal: 'wake',
      assistantId: 'host-ai', sessionId: 'session-visible', allowedToolNames: ['schedule_self_wake'],
      modelTransport: 'complete', maxSteps: 10, maxToolCalls: 30, maxToolCallsPerStep: 3,
      createdAt: '2026-09-08T00:00:00.000Z',
    },
    initialHistory: [],
  },
  modelGateway: {
    runTurn: async () => { throw new Error('本测试不直接调用 model gateway'); },
    takeCompletedTurn: () => modelTurn,
  },
  createLegacyContext: () => ({}),
  }),
});

assert.equal(result, terminal);
assert.equal(projectorParams.finalAssistantPolicy, 'commit_as_reply');
assert.equal(projectorParams.runtimeContext.replyRunId, 'run-visible');
assert.equal(projectorParams.runtimeContext.relatedEntityId, 'wake-visible');
assert.equal(commitCalls.length, 2);
assert.equal(commitCalls[0].previewText, null, 'autonomous timeline 不得冒充主动发信改写会话预览');
assert.deepEqual(
  commitCalls.flatMap((call) => call.messages.map((item) => [item.turnRunId, item.turnItemIndex])),
  [['run-visible', 1], ['run-visible', 2]],
);
assert.deepEqual(
  durableMessages.map((item) => item.text),
  ['思考', '调用完成：安排自主醒来'],
  '页面未挂载时仍必须由 Chat repository 持久化，重新读取可见',
);
assert.ok(uiSignals.includes('session-visible'));
assert.ok(transientEvents.some((event) => event.type === 'model_turn'));

function message(senderType, text, clientMessageId) {
  return {
    sessionId: 'session-visible', text, isMe: false, senderType, agentId: 'host-agent',
    apiMessageId: null, clientMessageId, time: '08:00', createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z', replyToId: null, replyToText: null,
    status: 'sent', tokensUsed: 5, promptTokens: 3, completionTokens: 2,
    metadataJson: JSON.stringify({ replyRunId: 'run-visible', relatedEntityId: 'wake-visible' }),
  };
}

// 准备阶段尚未访问模型就失败，开始与失败仍必须成为 durable Chat 记录。
const beforePreparationFailure = durableMessages.length;
await assert.rejects(module.exports.runChatVisibleAgent({
  sessionId: 'session-visible', runId: 'preparation-failure',
  aiConfig: { id: 'host-ai', agentId: 'host-agent', name: 'Raven' },
  runtimeContext: { triggerReason: 'self_wake' }, finalAssistantPolicy: 'autonomous_reply',
  prepare: async () => {
    assert.equal(JSON.parse(durableMessages.at(-1).metadataJson).phase, 'started');
    throw new Error('准备失败');
  },
}), /准备失败/);
const failureRecords = durableMessages.slice(beforePreparationFailure);
assert.deepEqual(failureRecords.map((message) => JSON.parse(message.metadataJson).phase), ['started', 'terminal']);
assert.equal(JSON.parse(failureRecords[1].metadataJson).terminalCode, 'EXECUTION_FAILED');
assert.deepEqual(failureRecords.map((message) => message.turnItemIndex), [1, 2]);
assert.ok(commitCalls.every((call) => call.previewText === null));

// 零工具 run 也有明确的开始和结束，不要求调用 send_message。
const beforeActivity = durableMessages.length;
await module.exports.runChatVisibleAgent({
  sessionId: 'session-visible', runId: 'activity-visible',
  aiConfig: { id: 'host-ai', agentId: 'host-agent', name: 'Raven' },
  runtimeContext: { triggerReason: 'self_wake' }, finalAssistantPolicy: 'autonomous_reply',
  prepare: async () => ({ request: { task: { allowedToolNames: [], modelTransport: 'complete' } },
    modelGateway: { takeCompletedTurn: () => modelTurn }, createLegacyContext: () => ({}) }),
});
const activityRecords = durableMessages.slice(beforeActivity);
assert.equal(JSON.parse(activityRecords[0].metadataJson).phase, 'started');
assert.equal(JSON.parse(activityRecords.at(-1).metadataJson).terminalCode, 'COMPLETED');
assert.deepEqual(activityRecords.map((message) => message.turnItemIndex), [1, 2, 3, 4, 5]);

// 自主语音在真实消息事务内关联音频；多次过程存档只提交一次媒体并交付一次。
let materialized = 0;
let finalized = 0;
let discarded = 0;
const voiceItem = {
  message: message('assistant', '这是一条语音', 'voice-activity:voice'),
  materializeInTransaction: async (transaction, input) => {
    assert.ok(transaction);
    materialized += 1;
    return { ...input, metadataJson: JSON.stringify({ kind: 'voice', voice: { mediaAssetId: 'audio-asset' } }) };
  },
  finalizeAfterCommit: async () => {
    assert.ok(durableMessages.some((message) => message.clientMessageId === 'voice-activity:voice'));
    finalized += 1;
  },
  discardAfterRollback: async () => { discarded += 1; },
};
runtimeDependencies.agent.run = async (request) => {
  await request.eventSink({ type: 'model_turn_started', stepIndex: 1 });
  await request.eventSink({ type: 'model_turn_completed', stepIndex: 1 });
  mediaItems = [voiceItem];
  await request.eventSink({ type: 'tool_call_completed', stepIndex: 1 });
  await request.eventSink({ type: 'step_completed', stepIndex: 1 });
  return terminal;
};
await module.exports.runChatVisibleAgent({
  sessionId: 'session-visible', runId: 'voice-activity',
  aiConfig: { id: 'host-ai', agentId: 'host-agent', name: 'Raven' },
  runtimeContext: { triggerReason: 'self_wake' }, finalAssistantPolicy: 'autonomous_reply',
  prepare: async () => ({ request: { task: { allowedToolNames: ['send_voice_message'], modelTransport: 'stream' } },
    modelGateway: { takeCompletedTurn: () => modelTurn }, createLegacyContext: () => ({}) }),
});
assert.equal(materialized, 1);
assert.equal(finalized, 1);
assert.equal(discarded, 0);
assert.equal(durableMessages.filter((message) => message.clientMessageId === 'voice-activity:voice').length, 1);
assert.equal(deliveredMessages.length, 1);
assert.equal(JSON.parse(deliveredMessages[0].metadataJson).voice.mediaAssetId, 'audio-asset');

// 媒体事务未提交时清理 prepared backing，不产生可播放消息或通知。
mediaItems = null;
const originalUpsertInTransaction = repository.upsertStatefulTimelineEntryInTransaction;
repository.upsertStatefulTimelineEntryInTransaction = async (transaction, input) => {
  if (input.message.clientMessageId === 'rollback-voice') throw new Error('媒体事务失败');
  return originalUpsertInTransaction(transaction, input);
};
const rollbackVoice = { ...voiceItem, message: message('assistant', '未发送的语音', 'rollback-voice') };
runtimeDependencies.agent.run = async (request) => {
  mediaItems = [rollbackVoice];
  await request.eventSink({ type: 'tool_call_completed', stepIndex: 1 });
  return terminal;
};
await assert.rejects(module.exports.runChatVisibleAgent({
  sessionId: 'session-visible', runId: 'rollback-activity',
  aiConfig: { id: 'host-ai', agentId: 'host-agent', name: 'Raven' },
  runtimeContext: { triggerReason: 'self_wake' }, finalAssistantPolicy: 'autonomous_reply',
  prepare: async () => ({ request: { task: { allowedToolNames: ['send_voice_message'], modelTransport: 'stream' } },
    modelGateway: { takeCompletedTurn: () => modelTurn }, createLegacyContext: () => ({}) }),
}), /媒体事务失败/);
assert.equal(discarded, 1);
assert.equal(finalized, 1);
assert.equal(deliveredMessages.length, 1);
assert.ok(!durableMessages.some((message) => message.clientMessageId === 'rollback-voice'));
repository.upsertStatefulTimelineEntryInTransaction = originalUpsertInTransaction;
mediaItems = null;

// 只返回了一半工具请求也足以证明 AI 已响应，不能等工具真正执行才留下证据。
runtimeDependencies.agent.run = async (request) => {
  await request.eventSink({ type: 'model_turn_started', stepIndex: 1 });
  await request.eventSink({ type: 'model_tool_request_started', stepIndex: 1, toolCallId: 'partial', toolName: null });
  return { ...terminal, terminalCode: 'MODEL_REQUEST_FAILED' };
};
await module.exports.runChatVisibleAgent({
  sessionId: 'session-visible', runId: 'partial-tool-response',
  aiConfig: { id: 'host-ai', agentId: 'host-agent', name: 'Raven' },
  runtimeContext: { triggerReason: 'self_wake' }, finalAssistantPolicy: 'autonomous_reply',
  prepare: async () => ({ request: { task: { allowedToolNames: ['send_voice_message'], modelTransport: 'stream' } },
    modelGateway: { takeCompletedTurn: () => modelTurn }, createLegacyContext: () => ({}) }),
});
assert.ok(durableMessages.some((message) => message.turnRunId === 'partial-tool-response'
  && JSON.parse(message.metadataJson).phase === 'responded'));
// 流式正文先存为过程，结束时复用原行并只交付一次；后续分段沿用真实分段信息。
const beforePromotion = durableMessages.length;
const beforeTextDelivery = deliveredMessages.length;
const draftText = { ...message('system', '今天过得怎么样？\n\n我想你了。', 'promoted-text:0'), isRead: true };
runtimeDependencies.agent.run = async (request) => {
  mediaItems = [{ message: draftText }];
  await request.eventSink({ type: 'model_turn_started', stepIndex: 1 });
  await request.eventSink({ type: 'assistant_text_delta', stepIndex: 1, text: draftText.text });
  await request.eventSink({ type: 'model_turn_completed', stepIndex: 1 });
  assert.equal(deliveredMessages.length, beforeTextDelivery, '过程存档不能发送消息');
  mediaItems = [
    { message: { ...draftText, senderType: 'assistant', isRead: false, text: '今天过得怎么样？', segmentIndex: 0, segmentTotal: 2, logicalMessageId: 'text-logical' } },
    { message: { ...message('assistant', '我想你了。', 'promoted-text:1'), segmentIndex: 1, segmentTotal: 2, logicalMessageId: 'text-logical' } },
  ];
  return terminal;
};
await module.exports.runChatVisibleAgent({
  sessionId: 'session-visible', runId: 'promoted-text',
  aiConfig: { id: 'host-ai', agentId: 'host-agent', name: 'Raven' },
  runtimeContext: { triggerReason: 'ai_schedule' }, finalAssistantPolicy: 'autonomous_reply',
  prepare: async () => ({ request: { task: { allowedToolNames: [], modelTransport: 'stream' } },
    modelGateway: { takeCompletedTurn: () => modelTurn }, createLegacyContext: () => ({}) }),
});
assert.equal(durableMessages.filter((message) => message.clientMessageId === draftText.clientMessageId).length, 1);
assert.deepEqual(durableMessages.slice(beforePromotion).filter((message) => message.senderType === 'assistant').map((message) => message.text), ['今天过得怎么样？', '我想你了。']);
assert.deepEqual(deliveredMessages.slice(beforeTextDelivery).map((item) => [item.segmentIndex, item.segmentTotal]), [[0, 2], [1, 2]]);
assert.ok(durableMessages.find((message) => message.clientMessageId === draftText.clientMessageId).isRead === false);
mediaItems = null;
console.log('Chat-visible Agent：无页面存档、执行证据、正文转换、分段和一次交付通过。');
