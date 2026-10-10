/**
 * 普通聊天 AI 回复 execution host（ConversationTurnExecutionTask）契约验证。
 *
 * 以 data: URL 动态编译 ConversationTurnCoordinator.ts 与 AIMessageDeliveryCoordinator.ts，
 * 桩掉跨 Feature / platform / shared / react-native 值导入，用内存 fake 验证：
 *
 * 行为断言：
 * 1. onCommitted 显式 executionMode=delegate_to_android_host（普通页面，即使有 notifyUI）：
 *    executionHost.start 被以 ([sessionId], { correlationId, deliveryTiming }) 调用，
 *    turns.claimIfIdle 未被调用；
 * 2. onCommitted 显式 executionMode=inline_current_host（调用方本身是 execution host，
 *    如悬浮任务）：turns.claimIfIdle 被调用，executionHost.start 未被调用；
 * 3. executeTurnFromHost 必须等待 run 到达 terminal：executeTurn gate 放行前 Promise 不 settle，
 *    放行后 resolve 'executed'；
 * 4. 无双 claim：已有活句柄时 executeTurnFromHost 返回 'already_active'，claimIfIdle 只被调一次；
 * 5. 重投不重复执行：claimIfIdle 落空且 highWatermark<=replyCursor → 'skipped'，takeOverOrphan 不调；
 * 6. 孤儿接管：claimIfIdle 落空、highWatermark>replyCursor、无终态覆盖 → takeOverOrphan 并 'executed'；
 * 7. 终态覆盖防隐式 retry：findTerminalRunCovering 命中 → 'skipped'，takeOverOrphan 不调；
 * 8. recovery 委派：recoverConversationTurns 只收集待恢复会话并一次性 executionHost.start，
 *    页面 runtime 不 claim / 不 takeOverOrphan / 不执行 run / 不注册 activeHandle；
 * 9. 交付策略（AIMessageDeliveryCoordinator）：
 *    - 前台会话（AppState active + isChatConversationForeground）→ 不发系统通知；
 *    - 后台 → sendAIMessageNotification 被调且 eventId = logicalMessageId:segmentIndex；
 *    - userNotificationHandled=true → 不发系统通知。
 *
 * 静态断言：
 * 10. SendUserMessage.ts 不再引用 executeUserReplyTurn / launchTurn（页面不独占执行生命周期）；
 * 11. ConversationTurnCoordinator 的 onCommitted 路径以 [sessionId] 调 executionHost.start；
 *     recoverConversationTurns 路径不含 claimIfIdle / takeOverOrphan / executeRun；
 *     index.js 注册 registerHeadlessTask('ConversationTurnExecutionTask'；
 *     原生 service Kotlin 含 TASK_KEY = "ConversationTurnExecutionTask"；
 *     ConversationTurnHeadlessTask 任务数据为 sessionIds 数组并串行 executeTurnFromHost；
 * 12. FloatingMessageHeadlessTask 只负责调用 Floating Layer runtime 注入的消息执行入口；
 *     deliveryTiming: 'immediate' 与 await replyCompletion 仍由 RavenCat 的消息执行用例持有；
 * 13. KimiPhoneHost.tsx 不再引用 sendAIMessageNotification；
 *     configureCompanionHeadlessRuntime.ts 注册 configureAIMessageDeliveryCoordinator。
 */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function transpileToModuleUrl(sourceText) {
  const output = ts.transpileModule(sourceText, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ============================================================================
// 协调器模块编译（与 verify-chat-turn-host-coordinator.mjs 相同的桩策略）
// ============================================================================
const chatReplyAbortModuleUrl = transpileToModuleUrl(
  read('src/features/chat/reply/application/ChatReplyAbort.ts'),
);

const chatStub = `import { isChatReplyRunCancellationError } from '${chatReplyAbortModuleUrl}';
const conversationTurnRepository = null;
const executeUserReplyTurn = null;
const sessionRepository = null;`;

const coordinatorSource = read('src/host/runtime/ConversationTurnCoordinator.ts');
const chatCompositionImportPattern =
  /import\s*\{[\s\S]*?\}\s*from\s*['"]@features\/chat\/composition['"];/;
const stubbedCoordinatorSource = coordinatorSource
  .replace(chatCompositionImportPattern, chatStub)
  .replace(chatCompositionImportPattern, '')
  .replace(
    /import\s*\{\s*aiAssistantRepository\s*\}\s*from\s*['"]@features\/assistants['"];/,
    'const aiAssistantRepository = null;',
  )
  .replace(
    /import\s*\{\s*startConversationTurnExecutionHost\s*\}\s*from\s*['"]@platform\/device['"];/,
    'const startConversationTurnExecutionHost = async () => false;',
  )
  .replace(
    /import\s*\{\s*logTurnTimeline\s*\}\s*from\s*['"]@shared\/diagnostics\/TurnTimelineLog['"];/,
    'const logTurnTimeline = () => {};',
  );
assert.ok(
  !stubbedCoordinatorSource.includes("'@features/chat'")
    && !stubbedCoordinatorSource.includes("'@features/chat/composition'")
    && !stubbedCoordinatorSource.includes("'@features/assistants'")
    && !stubbedCoordinatorSource.includes("'@platform/device'")
    && !stubbedCoordinatorSource.includes("'@shared/diagnostics/TurnTimelineLog'"),
  '协调器测试桩必须移除跨 Feature / platform / shared 值导入',
);
const coordinatorModuleUrl = transpileToModuleUrl(stubbedCoordinatorSource);
const { createConversationTurnCoordinator } = await import(coordinatorModuleUrl);

const aiConfig = { id: 'ai1', agentId: 'agent1', name: 'AI' };

/**
 * 内存 fake：回合仓储（claim 结果可编排）+ 可控 executeTurn + execution host 触发口。
 * options.claimResult：'run'（默认）或 null，模拟 claimIfIdle 是否落空。
 */
function createFakes(options = {}) {
  let runSeq = 0;
  const calls = {
    claimIfIdle: [],
    takeOverOrphan: [],
    revoke: [],
    executionHostStart: [],
  };
  const executions = new Map(); // runId -> { signal, gate, params }
  const makeRun = (sessionId, kind) => ({
    runId: `run-${++runSeq}`,
    sessionId,
    kind,
    replyCursorAtClaim: 0,
    inputHighWatermark: 10,
    revisionAtClaim: 1,
    status: 'active',
    terminalReason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    terminalAt: null,
  });
  const turns = {
    claimIfIdle: async (sessionId, kind) => {
      calls.claimIfIdle.push({ sessionId, kind });
      if (options.claimResult === null) {
        return null;
      }
      return makeRun(sessionId, kind);
    },
    takeOverOrphan: async (sessionId, kind) => {
      calls.takeOverOrphan.push({ sessionId, kind });
      return makeRun(sessionId, kind);
    },
    revoke: async (run, status, reason) => {
      calls.revoke.push({ runId: run.runId, status, reason });
    },
    findTerminalRunCovering: options.findTerminalRunCovering ?? (async () => null),
    getSessionTurnSnapshot: options.getSessionTurnSnapshot ?? (async () => null),
    listSessionsWithUnrepliedInput: async () => [],
  };
  const executeTurn = (params) => {
    const gate = deferred();
    executions.set(params.run.runId, { signal: params.signal, gate, params });
    return gate.promise;
  };
  const executionHost = {
    start: async (sessionIds, startOptions) => {
      calls.executionHostStart.push({ sessionIds, options: startOptions });
      return true;
    },
  };
  return { calls, executions, turns, executeTurn, executionHost };
}

function createCoordinator(fakes) {
  return createConversationTurnCoordinator({
    turns: fakes.turns,
    executeTurn: fakes.executeTurn,
    resolveAIConfig: async () => aiConfig,
    executionHost: fakes.executionHost,
  });
}

// ============================================================================
// 断言 1：普通页面显式委派（即使携带 presentation callback）只启动 execution host，不就地 claim。
// ============================================================================
{
  const fakes = createFakes();
  const coordinator = createCoordinator(fakes);

  await coordinator.onCanonicalUserMessageCommitted({
    sessionId: 's1',
    message: { id: 1 },
    aiConfig,
    executionMode: 'delegate_to_android_host',
    correlationId: 'corr-page-1',
    deliveryTiming: 'paced',
    replyCallbacks: { notifyUI: () => {} },
  });

  assert.equal(fakes.calls.executionHostStart.length, 1, '页面路径必须启动 execution host');
  assert.deepEqual(
    fakes.calls.executionHostStart[0].sessionIds,
    ['s1'],
    '页面路径必须以单元素会话数组启动 execution host',
  );
  assert.deepEqual(
    fakes.calls.executionHostStart[0].options,
    { correlationId: 'corr-page-1', deliveryTiming: 'paced' },
    'executionHost.start 必须携带 correlationId 与 deliveryTiming',
  );
  assert.equal(fakes.calls.claimIfIdle.length, 0, '页面 runtime 不得先 claim');
}

// ============================================================================
// 断言 2：显式 inline_current_host 的受控 execution host 就地 claim（悬浮任务不回归）。
// ============================================================================
{
  const fakes = createFakes();
  const coordinator = createCoordinator(fakes);

  await coordinator.onCanonicalUserMessageCommitted({
    sessionId: 's1',
    message: { id: 2 },
    aiConfig,
    executionMode: 'inline_current_host',
    correlationId: 'corr-floating-1',
    deliveryTiming: 'immediate',
    replyCallbacks: { notifyUI: () => {} },
  });

  assert.equal(fakes.calls.claimIfIdle.length, 1, '显式 inline_current_host 必须就地 claimIfIdle');
  assert.equal(fakes.calls.executionHostStart.length, 0, '显式 inline_current_host 不得再启动 execution host');
  // 清理：放行执行，避免悬挂句柄（各用例 fake 独立，仅为完整性）。
  fakes.executions.get('run-1').gate.resolve('committed');
  await flush();
}

// 断言 2b：callback 不能隐式升级 execution ownership；缺省 mode 仍安全委派。
{
  const fakes = createFakes();
  const coordinator = createCoordinator(fakes);

  await coordinator.onCanonicalUserMessageCommitted({
    sessionId: 's-callback-only',
    message: { id: 3 },
    aiConfig,
    correlationId: 'corr-callback-only',
    deliveryTiming: 'immediate',
    replyCallbacks: { notifyUI: () => {} },
  });

  assert.equal(
    fakes.calls.executionHostStart.length,
    1,
    '仅有 replyCallbacks 时仍必须委派 execution host（不得推断 inline host）',
  );
  assert.equal(
    fakes.calls.claimIfIdle.length,
    0,
    '仅有 replyCallbacks 时页面 runtime 不得 claimIfIdle',
  );
}

// ============================================================================
// 断言 3：executeTurnFromHost 必须等待 run 到达 terminal 才返回
// ============================================================================
{
  const fakes = createFakes();
  const coordinator = createCoordinator(fakes);

  let settled = false;
  let result = null;
  const pending = coordinator
    .executeTurnFromHost('s1', { correlationId: 'corr-host-1' })
    .then((r) => {
      settled = true;
      result = r;
    });

  await flush();
  await flush();
  assert.equal(settled, false, 'run 未到达 terminal 前 executeTurnFromHost 不得 settle');

  const exec = fakes.executions.get('run-1');
  assert.ok(exec, 'claim 成功后必须启动 executeRun');
  exec.gate.resolve('committed');
  await pending;
  assert.equal(settled, true, 'run terminal 后 executeTurnFromHost 必须 settle');
  assert.equal(result, 'executed', '正常执行完成必须返回 executed');
}

// ============================================================================
// 断言 4：无双 claim —— 已有活句柄时 executeTurnFromHost 返回 already_active
// ============================================================================
{
  const fakes = createFakes();
  const coordinator = createCoordinator(fakes);

  const launched = await coordinator.launchTurn('s1', 'send_flow', 'claimIfIdle', { aiConfig });
  assert.equal(launched, true, '首次 launch 必须成功');
  assert.equal(coordinator.hasActiveHandle('s1'), true);

  const result = await coordinator.executeTurnFromHost('s1', { correlationId: 'corr-host-2' });
  assert.equal(result, 'already_active', '本进程已有活句柄时必须返回 already_active');
  assert.equal(fakes.calls.claimIfIdle.length, 1, '重复投递不得再次 claimIfIdle');

  fakes.executions.get('run-1').gate.resolve('committed');
  await flush();
  await flush();
}

// ============================================================================
// 断言 5：重投不重复执行 —— 无待回复输入（highWatermark<=replyCursor）→ skipped
// ============================================================================
{
  const fakes = createFakes({
    claimResult: null,
    getSessionTurnSnapshot: async () => ({ replyCursor: 10, highWatermark: 10 }),
  });
  const coordinator = createCoordinator(fakes);

  const result = await coordinator.executeTurnFromHost('s1', {});
  assert.equal(result, 'skipped', '无待回复输入必须返回 skipped');
  assert.equal(fakes.calls.takeOverOrphan.length, 0, '无待回复输入不得 takeOverOrphan');
}

// ============================================================================
// 断言 6：孤儿接管 —— claimIfIdle 落空且无终态覆盖 → takeOverOrphan 并执行
// ============================================================================
{
  const fakes = createFakes({
    claimResult: null,
    getSessionTurnSnapshot: async () => ({ replyCursor: 5, highWatermark: 10 }),
    findTerminalRunCovering: async () => null,
  });
  const coordinator = createCoordinator(fakes);

  const pending = coordinator.executeTurnFromHost('s1', { correlationId: 'corr-host-3' });
  await flush();
  await flush();
  assert.equal(fakes.calls.takeOverOrphan.length, 1, '崩溃孤儿必须 takeOverOrphan 接管');

  const exec = fakes.executions.get('run-1');
  assert.ok(exec, '孤儿接管后必须启动 executeRun');
  exec.gate.resolve('committed');
  const result = await pending;
  assert.equal(result, 'executed', '孤儿接管执行完成必须返回 executed');
}

// ============================================================================
// 断言 7：终态覆盖防隐式 retry —— findTerminalRunCovering 命中 → skipped
// ============================================================================
{
  const fakes = createFakes({
    claimResult: null,
    getSessionTurnSnapshot: async () => ({ replyCursor: 5, highWatermark: 10 }),
    findTerminalRunCovering: async () => ({ runId: 'old-failed' }),
  });
  const coordinator = createCoordinator(fakes);

  const result = await coordinator.executeTurnFromHost('s1', {});
  assert.equal(result, 'skipped', 'failed/cancelled 终态覆盖的区间必须 skipped，防任务重投隐式 retry');
  assert.equal(fakes.calls.takeOverOrphan.length, 0, '终态覆盖区间不得 takeOverOrphan');
}

// ============================================================================
// 断言 8：recovery 委派 —— 只启动一次 execution host，页面不 claim / 不执行 / 不注册句柄
// ============================================================================
{
  const fakes = createFakes();
  fakes.turns.listSessionsWithUnrepliedInput = async (after, limit) =>
    [
      { sessionId: 's-r1', replyCursor: 5, highWatermark: 10 },
      { sessionId: 's-r2', replyCursor: 5, highWatermark: 10 },
    ]
      .filter((s) => s.sessionId > after)
      .slice(0, limit);
  const coordinator = createCoordinator(fakes);

  await coordinator.recoverConversationTurns();

  assert.equal(fakes.calls.executionHostStart.length, 1, 'recovery 必须一次性委派 execution host');
  assert.deepEqual(
    fakes.calls.executionHostStart[0].sessionIds,
    ['s-r1', 's-r2'],
    'recovery 必须以完整待恢复会话数组启动 execution host',
  );
  assert.equal(fakes.calls.claimIfIdle.length, 0, '页面 recovery 不得 claimIfIdle');
  assert.equal(fakes.calls.takeOverOrphan.length, 0, '页面 recovery 不得 takeOverOrphan');
  assert.equal(fakes.executions.size, 0, '页面 recovery 不得执行 run');
  assert.equal(coordinator.hasActiveHandle('s-r1'), false, 'recovery 委派不得注册 activeHandle');
  assert.equal(coordinator.hasActiveHandle('s-r2'), false, 'recovery 委派不得注册 activeHandle');
}

// ============================================================================
// 断言 9：交付策略 —— AIMessageDeliveryCoordinator 行为验证
// ============================================================================
{
  // 可控桩：AppState / 前台事实 / 通知发送 / 订阅 listener。
  const fakeAppState = { currentState: 'active' };
  const fakeForeground = { direct: () => false, group: () => false };
  const notificationCalls = [];
  const arrivalCalls = [];
  let aiMessageDeliveryHandler = null;

  const deliverySource = read('src/host/runtime/AIMessageDeliveryCoordinator.ts');
  const stubbedDeliverySource = deliverySource
    .replace(
      /import\s*\{\s*AppState\s*\}\s*from\s*['"]react-native['"];/,
      'const AppState = globalThis.__fakeAppState;',
    )
    .replace(
      /import\s*\{[\s\S]*?\}\s*from\s*['"]@features\/chat['"];/,
      `const conversationKeyOfDirect = (aiId) => 'ai:' + aiId;
const conversationKeyOfGroup = (groupId) => 'group:' + groupId;
const notifyAIMessageObservers = () => {};
`,
    )
    .replace(
      /import\s*\{[\s\S]*?\}\s*from\s*['"]@features\/chat\/composition['"];/,
      `const isChatConversationForeground = (...args) => globalThis.__fakeChatForeground.direct(...args);
const isGroupConversationForeground = (...args) => globalThis.__fakeChatForeground.group(...args);
const configureAssistantMessageArrivalRuntime = () => {};
const applyAssistantMessageArrivalSnapshot = () => {};
const configureAIMessageDeliveryHandler = (handler) => { globalThis.__aiMessageDeliveryHandler = handler; };`,
    )
    .replace(
      /import\s*\{[^}]*\}\s*from\s*['"]@platform\/device['"];/,
      `const sendAIMessageNotification = async (params) => {
  globalThis.__notificationCalls.push(params);
  return globalThis.__notificationsEnabled;
};
const addMessageArrivalListener = () => ({ remove() {} });
const getMessageArrivalSnapshot = async () => ({ revision: 0, pendingMessageIds: [], pendingSessionIds: [] });
const beginMessageArrival = async () => ({});
const finishMessageArrival = async () => ({});
const awaitMessageArrival = async (...args) => { globalThis.__arrivalCalls.push(args); return {}; };`,
    )
    .replace(
      /import\s*\{\s*logTurnTimeline\s*\}\s*from\s*['"]@shared\/diagnostics\/TurnTimelineLog['"];/,
      'const logTurnTimeline = () => {};',
    );
  assert.ok(
    !stubbedDeliverySource.includes("'react-native'")
      && !stubbedDeliverySource.includes("'@features/chat'")
      && !stubbedDeliverySource.includes("'@features/chat/composition'")
      && !stubbedDeliverySource.includes("'@platform/device'")
      && !stubbedDeliverySource.includes("'@shared/diagnostics/TurnTimelineLog'"),
    '交付协调器测试桩必须移除 react-native / 跨 Feature / platform / shared 值导入',
  );

  globalThis.__fakeAppState = fakeAppState;
  globalThis.__fakeChatForeground = fakeForeground;
  globalThis.__notificationCalls = notificationCalls;
  globalThis.__arrivalCalls = arrivalCalls;
  globalThis.__notificationsEnabled = true;
  Object.defineProperty(globalThis, '__aiMessageDeliveryHandler', {
    get: () => aiMessageDeliveryHandler,
    set: (handler) => {
      aiMessageDeliveryHandler = handler;
    },
    configurable: true,
  });

  const deliveryModuleUrl = transpileToModuleUrl(stubbedDeliverySource);
  const { configureAIMessageDeliveryCoordinator } = await import(deliveryModuleUrl);
  configureAIMessageDeliveryCoordinator();
  assert.ok(aiMessageDeliveryHandler, 'configure 后必须注册唯一交付处理器');

  const basePayload = {
    aiId: 'ai1',
    aiName: 'AI',
    message: '你好',
    sessionId: 's1',
    conversationKind: 'direct',
    logicalMessageId: 'lm-1',
    segmentIndex: 2,
    committedMessageId: 100,
  };

  // 前台会话：抑制系统通知。
  fakeAppState.currentState = 'active';
  fakeForeground.direct = () => true;
  assert.deepEqual(
    await aiMessageDeliveryHandler({ ...basePayload }),
    { status: 'suppressed_foreground', errorCategory: null },
  );
  assert.equal(notificationCalls.length, 0, '前台会话不得发送系统通知');

  const groupPayload = {
    ...basePayload,
    aiId: 'ai-group-member',
    aiName: '群成员',
    sessionId: 'group-current',
    conversationKind: 'group',
    groupId: 'group-current',
    groupName: '当前群聊',
    logicalMessageId: 'lm-group',
  };

  // 用户正在当前群聊：群回复抑制；同时到达的私聊回复仍应通知。
  fakeForeground.direct = () => false;
  fakeForeground.group = (groupId) => groupId === 'group-current';
  assert.deepEqual(
    await aiMessageDeliveryHandler(groupPayload),
    { status: 'suppressed_foreground', errorCategory: null },
  );
  assert.equal(notificationCalls.length, 0, '当前群聊回复不得触发系统通知');
  assert.deepEqual(
    await aiMessageDeliveryHandler({ ...basePayload, committedMessageId: 102 }),
    { status: 'shown', errorCategory: null },
  );
  assert.equal(notificationCalls.length, 1, '群聊前台时同时到达的私聊回复必须通知');
  assert.equal(notificationCalls[0].conversationKey, 'ai:ai1');

  // 用户正在私聊：私聊回复抑制；群回复按 groupId 聚合通知，不能串进成员单聊。
  fakeForeground.direct = (aiId, sessionId) => aiId === 'ai1' && sessionId === 's1';
  fakeForeground.group = () => false;
  assert.deepEqual(
    await aiMessageDeliveryHandler({
      ...groupPayload,
      groupId: 'group-other',
      sessionId: 'group-other',
      groupName: '另一个群聊',
      committedMessageId: 103,
    }),
    { status: 'shown', errorCategory: null },
  );
  assert.equal(notificationCalls.length, 2, '私聊前台时群聊回复必须通知');
  assert.equal(notificationCalls[1].conversationKey, 'group:group-other');
  assert.equal(notificationCalls[1].conversationTitle, '另一个群聊');
  assert.equal(notificationCalls[1].conversationKind, 'group');
  assert.equal(notificationCalls[1].groupId, 'group-other');

  // 后台：发送聚合通知，eventId = logicalMessageId:segmentIndex。
  fakeAppState.currentState = 'background';
  fakeForeground.direct = () => false;
  fakeForeground.group = () => false;
  assert.deepEqual(
    await aiMessageDeliveryHandler({ ...basePayload, committedMessageId: 101 }),
    { status: 'shown', errorCategory: null },
  );
  assert.equal(notificationCalls.length, 3, '后台必须发送系统通知');
  assert.equal(
    notificationCalls[2].eventId,
    'lm-1:2',
    '通知 eventId 必须是 logicalMessageId:segmentIndex（逐段幂等）',
  );

  // 缺少逻辑分段 ID 时仍以已提交数据库消息 ID 保证重投幂等。
  assert.deepEqual(
    await aiMessageDeliveryHandler({ ...basePayload, logicalMessageId: null }),
    { status: 'shown', errorCategory: null },
  );
  assert.equal(notificationCalls.length, 4);
  assert.equal(notificationCalls[3].eventId, 'message:100');

  // userNotificationHandled（如 RavenCat overlay preview 已承载展示）：不再发系统通知。
  assert.deepEqual(
    await aiMessageDeliveryHandler({ ...basePayload, userNotificationHandled: true }),
    { status: 'handled_by_consumer', errorCategory: null },
  );
  assert.equal(notificationCalls.length, 4, 'userNotificationHandled 时不得再发系统通知');

  const beforeDenied = arrivalCalls.length;
  globalThis.__notificationsEnabled = false;
  assert.deepEqual(await aiMessageDeliveryHandler(basePayload), {
    status: 'failed', errorCategory: 'native_notification_not_shown',
  });
  assert.equal(arrivalCalls.length, beforeDenied + 1, '关闭通知权限仍必须推进消息到达');
  assert.deepEqual(arrivalCalls[0], ['ai:ai1', 100], '前台抑制也消费同一原生到达节奏');
  assert.ok(arrivalCalls.some(([key]) => key === 'group:group-current'), '群聊到达按群隔离');

  delete globalThis.__fakeAppState;
  delete globalThis.__fakeChatForeground;
  delete globalThis.__notificationCalls;
  delete globalThis.__arrivalCalls;
  delete globalThis.__notificationsEnabled;
  delete globalThis.__aiMessageDeliveryHandler;
}

// ============================================================================
// 静态断言 10～13
// ============================================================================

// 10. 发送流程不再直接发起模型 run：执行生命周期由 execution host 承担。
const sendUserMessageSource = read('src/features/chat/messages/application/SendUserMessage.ts');
assert.doesNotMatch(
  sendUserMessageSource,
  /executeUserReplyTurn|launchTurn/,
  'SendUserMessage 不得再引用 executeUserReplyTurn / launchTurn（页面不独占执行生命周期）',
);

// 11. 协调器页面路径必须委派 execution host（会话数组首参）；recovery 路径只发现+委派；
// 入口、原生 service 的 TASK_KEY 与 Headless 任务的 sessionIds 契约一致。
assert.match(
  coordinatorSource,
  /deps\.executionHost\.start\(\[sessionId\], \{\s*correlationId: payload\.correlationId,\s*deliveryTiming: payload\.deliveryTiming,?\s*\}\)/,
  'onCanonicalUserMessageCommitted 页面路径必须以 [sessionId] 调 executionHost.start 并透传 correlationId / deliveryTiming',
);
const recoverBody = coordinatorSource.match(
  /async recoverConversationTurns\(\) \{[\s\S]*?\n    \},/,
)?.[0] ?? '';
assert.ok(recoverBody, '必须能提取 recoverConversationTurns 方法体');
assert.doesNotMatch(
  recoverBody,
  /claimIfIdle|takeOverOrphan|executeRun/,
  'recoverConversationTurns 不得在页面 runtime claim / 接管孤儿 / 执行 run（只发现并委派 execution host）',
);
assert.match(
  recoverBody,
  /deps\.executionHost\.start\(pendingSessionIds, \{\}\)/,
  'recoverConversationTurns 必须以完整待恢复会话数组一次性启动 execution host',
);
const appEntrySource = read('index.js');
assert.match(
  appEntrySource,
  /registerHeadlessTask\('ConversationTurnExecutionTask'/,
  'index.js 必须注册 ConversationTurnExecutionTask Headless 任务',
);
const nativeServiceSource = read(
  'modules/conversation-turn-runtime/android/src/main/java/expo/modules/conversationturnruntime/ConversationTurnHeadlessTaskService.kt',
);
assert.match(
  nativeServiceSource,
  /TASK_KEY = "ConversationTurnExecutionTask"/,
  '原生 Headless service 的 TASK_KEY 必须是 ConversationTurnExecutionTask',
);
const executionHostSource = read('src/platform/device/ConversationTurnExecutionHost.ts');
assert.match(
  executionHostSource,
  /startConversationTurnTask\(sessionIds, options\)/,
  'platform execution host 必须把 sessionIds 数组传入 Expo Module',
);
const runtimeModuleSource = read(
  'modules/conversation-turn-runtime/src/ConversationTurnRuntimeModule.ts',
);
assert.match(
  runtimeModuleSource,
  /nativeModule\.startConversationTurnTask\(\s*sessionIds,/,
  'Expo Module TS 入口必须把 sessionIds 数组传给原生模块',
);
const nativeModuleSource = read(
  'modules/conversation-turn-runtime/android/src/main/java/expo/modules/conversationturnruntime/ConversationTurnRuntimeModule.kt',
);
assert.match(
  nativeModuleSource,
  /sessionIds:\s*List<String>[\s\S]*?ConversationTurnHeadlessTaskService\.start\(reactContext, sessionIds,/,
  'Kotlin Module 必须以 List<String> 接收并透传 sessionIds',
);
assert.match(
  nativeServiceSource,
  /putStringArrayListExtra\("sessionIds", ArrayList\(sessionIds\)\)/,
  'Kotlin Service 必须以字符串数组 extra 传递 sessionIds',
);
const conversationTurnTaskSource = read('src/host/runtime/ConversationTurnHeadlessTask.ts');
assert.match(
  conversationTurnTaskSource,
  /sessionIds\?: string\[\]/,
  'ConversationTurnExecutionTask 任务数据必须携带 sessionIds 数组',
);
assert.match(
  conversationTurnTaskSource,
  /for \(const sessionId of sessionIds\)[\s\S]*?executeTurnFromHost\(sessionId/,
  'ConversationTurnExecutionTask 必须对 sessionIds 串行 executeTurnFromHost（模型请求并发有界为 1）',
);

// 12. 悬浮消息 Headless 宿主属于 Floating Layer，只负责转发到 Host 注入的
// 消息执行入口；消息执行用例仍由 RavenCat 持有，并通过窄 execution-host port
// 使用受控 execution host，后台一律 immediate 且等待回复完成。Feature 不应重新
// 取得 Chat internal 入口或让 Headless 宿主自行选择 mode。
const floatingMessageExecutorSource = read('src/features/companion/application/ExecuteFloatingMessage.ts');
assert.match(
  floatingMessageExecutorSource,
  /sendUserMessageFromExecutionHost/,
  'RavenCat 悬浮消息执行用例必须通过窄 execution-host port 发送消息',
);
assert.doesNotMatch(
  floatingMessageExecutorSource,
  new RegExp(String.raw`executionMode:\s*['"]inline_current_host['"]|deliveryTiming:\s*['"]immediate['"]`),
  'RavenCat 悬浮消息执行用例不得自行注入 Chat internal execution 选项',
);
const ravenCatRuntimeCompositionSource = read('src/host/composition/configureCompanionRuntime.ts');
assert.match(
  ravenCatRuntimeCompositionSource,
  new RegExp(String.raw`executionMode:\s*['"]inline_current_host['"]`),
  'Host RavenCat adapter 必须固定选择 inline_current_host',
);
assert.match(
  ravenCatRuntimeCompositionSource,
  new RegExp(String.raw`deliveryTiming:\s*['"]immediate['"]`),
  'Host RavenCat adapter 必须固定 deliveryTiming: immediate（后台 setTimeout 被冻结）',
);
assert.match(
  floatingMessageExecutorSource,
  /await replyCompletion/,
  'RavenCat 悬浮消息执行用例必须 await replyCompletion（任务活到回复完成）',
);

// 13. 交付判定已迁出 KimiPhoneHost；headless runtime 装配必须注册交付协调器。
const hostSource = read('src/host/KimiPhoneHost.tsx');
assert.doesNotMatch(
  hostSource,
  /sendAIMessageNotification/,
  'KimiPhoneHost 不得再直接发送 AI 消息通知（判定统一在 AIMessageDeliveryCoordinator）',
);
const headlessRuntimeSource = read('src/host/composition/configureCompanionHeadlessRuntime.ts');
assert.match(
  headlessRuntimeSource,
  /configureAIMessageDeliveryCoordinator\(\)/,
  'configureCompanionHeadlessRuntime 必须注册 configureAIMessageDeliveryCoordinator',
);
const aiMessageEventsSource = read('src/features/chat/reply/delivery/AIMessageEvents.ts');
assert.match(
  aiMessageEventsSource,
  /let aiMessageDeliveryHandler: AIMessageDeliveryHandler \| null = null/,
  '系统交付必须使用唯一 handler，不能混入普通 UI subscriber',
);
assert.match(
  aiMessageEventsSource,
  /committedMessageId: number/,
  'assistant commit 事件必须携带稳定数据库消息 ID',
);
const nativeNotificationPublisherSource = read(
  'modules/kimiphone-notifications/android/src/main/java/expo/modules/kimiphonenotifications/NotificationPublisher.kt',
);
assert.match(
  nativeNotificationPublisherSource,
  /conversationPostMutexes = ConcurrentHashMap<String, Mutex>\(\)/,
  '原生通知发布必须按 conversationKey 维护独立 Mutex',
);
assert.match(
  nativeNotificationPublisherSource,
  /conversationPostMutexes\.computeIfAbsent\(conversationKey\)/,
  '每次发布必须只进入所属 conversationKey 的 Mutex',
);
assert.doesNotMatch(
  nativeNotificationPublisherSource,
  /conversationPostMutex\s*=\s*Mutex\(\)/,
  '不同 conversationKey 不得共享全局发布 Mutex',
);
assert.match(
  nativeNotificationPublisherSource,
  /conversationOperationLocks = ConcurrentHashMap<String, Any>\(\)/,
  '原生通知发布与 dismiss 必须按 conversationKey 协调同步操作',
);
assert.match(
  nativeNotificationPublisherSource,
  /conversationOperationGate = ReentrantReadWriteLock\(true\)/,
  '全量 dismiss 必须在不串行不同会话发布的门闩下执行',
);
assert.doesNotMatch(
  nativeNotificationPublisherSource,
  /lastConversationAlertAtElapsedMs\s*=/,
  '原生通知不得保留跨会话共享的提醒时间戳',
);
assert.match(nativeNotificationPublisherSource, /synchronized\(conversationStateLock\)/);
assert.match(nativeNotificationPublisherSource, /setGroupAlertBehavior\(NotificationCompat\.GROUP_ALERT_ALL\)/);
assert.match(nativeNotificationPublisherSource, /setOnlyAlertOnce\(true\)/);

console.log('ConversationTurn execution host 契约验证通过：页面委派 / 就地执行 / host 等待 terminal / 孤儿接管 / recovery 委派 / 交付策略。');
console.log('真机后台链路（Headless service 启动与 XHR/SSE 消费）仍需 Android 验收。');
