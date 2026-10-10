import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadModule(sourcePath, requireMock) {
  const source = fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, [], `${sourcePath} 无法编译`);

  const module = { exports: {} };
  const runner = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    compiled.outputText,
  );
  runner(
    module.exports,
    requireMock,
    module,
    path.join(repoRoot, sourcePath),
    path.dirname(path.join(repoRoot, sourcePath)),
  );
  return module.exports;
}

// ---------------------------------------------------------------------------
// 1. send_message Tool 执行行为
// ---------------------------------------------------------------------------

const abortSignalPath = 'src/shared/runtime/abortSignal.ts';
const abortSignalModule = loadModule(abortSignalPath, () => {
  throw new Error(`${abortSignalPath} 不应存在运行时依赖`);
});

const segmentationPath = 'src/features/chat/reply/application/AssistantReplySegmentation.ts';
const segmentationModule = loadModule(segmentationPath, () => {
  throw new Error(`${segmentationPath} 不应存在运行时依赖`);
});
const chatReplyUtilsPath = 'src/features/chat/reply/application/ChatReplyUtils.ts';
const chatReplyUtilsModule = loadModule(chatReplyUtilsPath, () => {
  throw new Error(`${chatReplyUtilsPath} 不应存在运行时依赖`);
});

const toolPath = 'src/features/chat/aiTools/SendMessageTool.ts';
let appendMode = 'shown';
const appendCalls = [];

async function appendExternalAssistantMessages(params) {
  appendCalls.push(params);
  if (appendMode === 'throw') {
    throw new Error('chat commit failed');
  }
  const baseId = 1000 + appendCalls.length;
  return {
    messages: params.segments.map((text, index) => ({
      id: baseId + index,
      sessionId: params.sessionId,
      text,
    })),
    committedMessageIds: params.segments.map((_, index) => baseId + index),
    deliveryReceipts: params.segments.map(() => ({
      status: appendMode,
      errorCategory: appendMode === 'failed' ? 'native_notification_not_shown' : null,
    })),
    logicalMessageId: params.logicalMessageId ?? null,
    segmentTotal: params.segments.length,
  };
}

const toolModule = loadModule(toolPath, (specifier) => {
  if (specifier === '../messages/application/AppendExternalAssistantMessages') {
    return { appendExternalAssistantMessages };
  }
  if (specifier === '../reply/application/AssistantReplySegmentation') {
    return segmentationModule;
  }
  if (specifier === '../reply/application/ChatReplyUtils') {
    return chatReplyUtilsModule;
  }
  if (specifier === '@shared/runtime/abortSignal') return abortSignalModule;
  throw new Error(`未声明的运行时依赖：${specifier}`);
});

const { definition, execute } = toolModule;

assert.equal(definition.name, 'send_message');
assert.deepEqual(Object.keys(definition.parameters.properties), ['text']);
assert.deepEqual(definition.parameters.required, ['text']);
assert.equal(definition.parameters.additionalProperties, false);
assert.match(definition.description, /提交进聊天记录/);
assert.match(definition.description, /不要.*重复发送/);

function toolContext(overrides = {}) {
  return {
    sessionId: 'session-a',
    aiConfig: { id: 'host-a', agentId: 'agent-a', name: '主理', avatar: 'avatar-a' },
    getAIId: () => 'host-a',
    getAIName: () => '主理',
    getAgentId: () => 'agent-a',
    getTriggerSource: () => 'internal_feature',
    getRelatedEntityType: () => 'internal_task',
    getRelatedEntityId: () => 'task-a',
    sharedState: {},
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

// 5/6/7. 成功提交：Chat command 收到完整 trusted runtime metadata。
appendMode = 'shown';
const sent = await execute({ text: '测试消息' }, toolContext());
assert.equal(sent.success, true);
assert.deepEqual(appendCalls[0], {
  sessionId: 'session-a',
  segments: ['测试消息'],
  aiId: 'host-a',
  agentId: 'agent-a',
  aiName: '主理',
  aiAvatar: 'avatar-a',
  delivery: 'default',
  triggerSource: 'internal_feature',
  relatedEntityType: 'internal_task',
  relatedEntityId: 'task-a',
  logicalMessageId: null,
});
assert.equal(sent.data.committedMessageId, 1001);
assert.equal(sent.data.sessionId, 'session-a');
assert.equal(sent.data.deliveryStatus, 'shown');
assert.equal(sent.data.deliveryErrorCategory, null);
assert.match(sent.message, /已发送并提交到 Chat/);
assert.match(sent.message, /不要重复发送/);

// 8. 前台抑制：消息事实仍然成立，不能理解成“没发送”。
appendMode = 'suppressed_foreground';
const suppressed = await execute({ text: '前台消息' }, toolContext());
assert.equal(suppressed.success, true);
assert.equal(suppressed.data.deliveryStatus, 'suppressed_foreground');
assert.match(suppressed.message, /目标会话正在前台/);

// 9. 消费方已展示。
appendMode = 'handled_by_consumer';
const handled = await execute({ text: '悬浮层消息' }, toolContext());
assert.equal(handled.success, true);
assert.equal(handled.data.deliveryStatus, 'handled_by_consumer');

// 10. 通知失败：Chat 已 commit，Tool 仍是业务成功，且明确禁止重试。
appendMode = 'failed';
const failed = await execute({ text: '通知失败消息' }, toolContext());
assert.equal(failed.success, true);
assert.equal(failed.data.committedMessageId, 1004);
assert.equal(failed.data.deliveryStatus, 'failed');
assert.equal(failed.data.deliveryErrorCategory, 'native_notification_not_shown');
assert.match(failed.message, /已经成功写入 Chat/);
assert.match(failed.message, /不要因为通知失败重复发送/);

// 11. 缺少 session：不写 Chat、不创建会话。
let callsBeforeMissingSession = appendCalls.length;
const missingSession = await execute(
  { text: '没有会话' },
  toolContext({ sessionId: null }),
);
assert.equal(missingSession.success, false);
assert.equal(missingSession.errorCode, 'CHAT_SESSION_UNAVAILABLE');
assert.match(missingSession.error, /没有发送消息/);
assert.equal(appendCalls.length, callsBeforeMissingSession);

// 12. 空正文：不写 Chat。
for (const text of ['', '   ']) {
  callsBeforeMissingSession = appendCalls.length;
  const empty = await execute({ text }, toolContext());
  assert.equal(empty.success, false);
  assert.equal(empty.errorCode, 'EMPTY_MESSAGE_CONTENT');
  assert.equal(appendCalls.length, callsBeforeMissingSession, '空正文不得进入 Chat write');
}

// 13. 多次调用产生多条独立消息，不自动合并。
appendMode = 'shown';
const first = await execute({ text: '第一条' }, toolContext());
const second = await execute({ text: '第二条' }, toolContext());
assert.equal(first.success, true);
assert.equal(second.success, true);
assert.notEqual(first.data.committedMessageId, second.data.committedMessageId);
assert.deepEqual(appendCalls[appendCalls.length - 2].segments, ['第一条']);
assert.deepEqual(appendCalls[appendCalls.length - 1].segments, ['第二条']);

// 13b. 正文里的空行必须走与正常回复相同的确定性分段，多段共用同一 logicalMessageId。
const segmented = await execute(
  { text: '第一段。\n\n第二段。\n\n第三段。' },
  toolContext(),
);
assert.equal(segmented.success, true);
assert.deepEqual(
  appendCalls.at(-1).segments,
  ['第一段。', '第二段。', '第三段。'],
  'send_message 必须按空行把正文切成多条气泡',
);
assert.match(
  String(appendCalls.at(-1).logicalMessageId ?? ''),
  /^lm_/u,
  '多段必须带 logicalMessageId，否则 UI 会把它们当成多条独立消息',
);
assert.equal(
  segmented.data.committedMessageId,
  1000 + appendCalls.length,
  '多段提交返回首段消息 ID',
);

// 13c. 单气泡 AI 正文不分段。
const singleBubble = await execute(
  { text: '第一段。\n\n第二段。' },
  toolContext({
    aiConfig: {
      id: 'host-a',
      agentId: 'agent-a',
      name: '主理',
      avatar: 'avatar-a',
      allowMultipleBubbles: false,
    },
  }),
);
assert.equal(singleBubble.success, true);
assert.deepEqual(appendCalls.at(-1).segments, ['第一段。\n\n第二段。']);
assert.equal(appendCalls.at(-1).logicalMessageId, null, '单气泡不生成 logicalMessageId');

// 13d. 没有句末标点可切的超长正文整段保留，不硬切。
await execute({ text: '无标点长句'.repeat(100) }, toolContext());
assert.equal(
  appendCalls.at(-1).segments.length,
  1,
  '无句末标点可切的正文不得被硬切成多条气泡',
);

// Agent run 内显式发送的消息关联同一 timeline run，但仍只提交这一条真实消息。
const callsBeforeRunAssociatedSend = appendCalls.length;
const runAssociated = await execute(
  { text: '自主消息' },
  toolContext({ sharedState: { replyRunId: 'wake-run-1' } }),
);
assert.equal(runAssociated.success, true);
assert.equal(appendCalls.length, callsBeforeRunAssociatedSend + 1);
assert.equal(appendCalls.at(-1).timelineRunId, 'wake-run-1');

// 取消的 Tool 不得提交消息。
const callsBeforeCancellation = appendCalls.length;
await assert.rejects(
  () => execute(
    { text: '已取消' },
    toolContext({ abortSignal: { aborted: true, reason: new Error('cancelled') } }),
  ),
);
assert.equal(appendCalls.length, callsBeforeCancellation);

// Chat commit 真正抛错时不得伪装成已发送。
appendMode = 'throw';
await assert.rejects(() => execute({ text: '提交失败' }, toolContext()));
appendMode = 'shown';

// ---------------------------------------------------------------------------
// 2. Registry 注册与暴露策略
// ---------------------------------------------------------------------------

const registryPath = 'src/host/composition/agent/createAgentToolRegistry.ts';
const registrySource = fs.readFileSync(path.join(repoRoot, registryPath), 'utf8');
const registryAst = ts.createSourceFile(
  registryPath,
  registrySource,
  ts.ScriptTarget.ES2022,
  true,
);

function collectBuiltInRegistrations(ast) {
  const registrations = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'BUILT_IN_TOOL_REGISTRATIONS'
      && node.initializer
      && ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (!ts.isCallExpression(element)) continue;
        const [toolArg, ownerArg, policyArg, optionsArg] = element.arguments;
        registrations.push({
          factory: element.expression.getText(),
          tool: toolArg?.getText() ?? null,
          owner: ownerArg?.getText() ?? null,
          policy: policyArg?.getText() ?? null,
          options: optionsArg && ts.isObjectLiteralExpression(optionsArg)
            ? Object.fromEntries(optionsArg.properties.map((property) => [
                property.name?.getText() ?? '',
                property.initializer?.getText() ?? '',
              ]))
            : {},
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return registrations;
}

const registrations = collectBuiltInRegistrations(registryAst);
const sendMessageRegistrations = registrations.filter(
  (registration) => registration.tool === 'SendMessageTool',
);
assert.equal(sendMessageRegistrations.length, 1, 'send_message 只能有一个 Built-in 注册');
assert.deepEqual(
  {
    owner: sendMessageRegistrations[0].owner,
    policy: sendMessageRegistrations[0].policy,
    hostOnly: sendMessageRegistrations[0].options.hostOnly,
    outOfBandOnly: sendMessageRegistrations[0].options.outOfBandOnly,
  },
  {
    owner: "'chat'",
    policy: 'EXTERNAL_SIDE_EFFECT',
    hostOnly: 'true',
    outOfBandOnly: 'true',
  },
);

// 用符号名代替真实工具名加载 Registry，避免拉起整个 Host 依赖图。
const fakeToolModule = new Proxy({}, {
  get: (_target, property) => {
    if (typeof property !== 'string') return undefined;
    return {
      name: property,
      definition: { name: property, description: '', parameters: {} },
    };
  },
});

const registryModule = loadModule(registryPath, (specifier) => {
  if (specifier === '@platform/agentRuntime') return { AgentToolRegistry: class {} };
  if (specifier === './LegacyAgentToolAdapter') return { LegacyAgentToolAdapter: class {} };
  if (specifier === '@features/phoneTools/neteaseComposition') {
    return { productionNetEaseChildTools: [] };
  }
  return fakeToolModule;
});

const availableNames = (aiConfig) => registryModule
  .getAuthorizedToolDefinitionsForAI(aiConfig)
  .map((tool) => tool.function.name);

const enabledHostConfig = {
  enableTools: true,
  isHostAI: true,
  allowedToolNames: ['SendMessageTool', 'LookAtUserTool', 'GetProtocolsTool'],
};

// 2. out-of-band Host 运行可以看到 send_message。
assert.ok(
  availableNames({ ...enabledHostConfig, triggerSource: 'internal_feature' })
    .includes('SendMessageTool'),
  'out-of-band Host 运行必须暴露 send_message',
);

// 3. normal Chat 不暴露它，避免 send_message + finalText 双消息。
// raven_cat_contact 链路已随 legacy contact route engine 删除，不再是 Chat 可见回复链路。
for (const triggerSource of ['chat', 'group_chat', 'ledger']) {
  assert.ok(
    !availableNames({ ...enabledHostConfig, triggerSource }).includes('SendMessageTool'),
    `triggerSource=${triggerSource} 的 Chat 可见回复链路不得暴露 send_message`,
  );
}
assert.ok(
  !availableNames({ ...enabledHostConfig }).includes('SendMessageTool'),
  '未声明 triggerSource 时不得暴露 send_message',
);

// 16. host authority。
assert.ok(
  !availableNames({
    ...enabledHostConfig,
    isHostAI: false,
    triggerSource: 'internal_feature',
  }).includes('SendMessageTool'),
  'send_message 只能授予当前主理 AI',
);

// 既有 availability 规则不受影响。
assert.ok(
  availableNames({ ...enabledHostConfig, triggerSource: 'call' }).includes('LookAtUserTool'),
  'callOnly 工具仍应在通话链路暴露',
);
assert.ok(
  !availableNames({ ...enabledHostConfig, triggerSource: 'chat' }).includes('LookAtUserTool'),
  'callOnly 工具仍应在普通聊天隐藏',
);
assert.ok(
  availableNames({ ...enabledHostConfig, triggerSource: 'internal_feature' })
    .includes('GetProtocolsTool'),
  '普通 Host 工具不受 outOfBandOnly 影响',
);
assert.ok(
  registryModule.getToolPermissionDescriptors()
    .some((descriptor) => descriptor.name === 'SendMessageTool' && descriptor.hostOnly),
  '主理工具进入带身份属性的权限目录，真实暴露仍受身份和场景限制',
);

// ---------------------------------------------------------------------------
// 3. 旧 proactive route 隔离
// ---------------------------------------------------------------------------

const FORBIDDEN_IMPORTS = [
  'ExecuteProactiveContact',
  'ProactiveAgentRunner',
  'ContactPolicy',
  'ContactRouteTypes',
  'planProactiveContactRoute',
];
const AUTONOMOUS_MESSAGE_PATHS = [
  'src/host/composition/agent/createAgentToolRegistry.ts',
  'src/features/chat/aiTools/SendMessageTool.ts',
  'src/features/companion/application/RunAIScheduleAutonomousAgent.ts',
  'src/features/companion/application/CompanionPromptBlocks.ts',
];

for (const sourcePath of AUTONOMOUS_MESSAGE_PATHS) {
  const source = fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8');
  const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ES2022, true);
  const importedNames = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) importedNames.push(clause.name.text);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          importedNames.push(element.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  for (const forbidden of FORBIDDEN_IMPORTS) {
    assert.ok(
      !importedNames.includes(forbidden),
      `${sourcePath} 不得引用旧 proactive route：${forbidden}`,
    );
  }
}

console.log('send_message Tool 注册、暴露策略与消息交付语义检查通过。');
