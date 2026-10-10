import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadTypeScriptModule(relativePath, mocks = {}) {
  const absolutePath = path.join(repoRoot, relativePath);
  const compiled = ts.transpileModule(read(relativePath), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absolutePath,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, [], `${relativePath} 无法编译`);

  const module = { exports: {} };
  const requireMock = (specifier) => {
    assert.ok(Object.hasOwn(mocks, specifier), `${relativePath} 存在未声明的运行时依赖：${specifier}`);
    return mocks[specifier];
  };
  const executeModule = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    compiled.outputText,
  );
  executeModule(module.exports, requireMock, module, absolutePath, path.dirname(absolutePath));
  return module.exports;
}

const collectorModule = loadTypeScriptModule('src/platform/ai/agent/ModelTurnCollector.ts');
const completeAdapterModule = loadTypeScriptModule(
  'src/platform/ai/agent/CompleteModelTurnAdapter.ts',
  { './ModelTurnCollector': collectorModule },
);
const streamingAdapterModule = loadTypeScriptModule(
  'src/platform/ai/agent/StreamingModelTurnAdapter.ts',
  {
    './ModelTurnCollector': collectorModule,
    './CompleteModelTurnAdapter': completeAdapterModule,
  },
);
const agentGatewayModule = loadTypeScriptModule(
  'src/platform/ai/agent/AgentModelGateway.ts',
  {
    './CompleteModelTurnAdapter': completeAdapterModule,
    './StreamingModelTurnAdapter': streamingAdapterModule,
  },
);
const timelineEvents = [];
const baseAIClientGatewayModule = loadTypeScriptModule(
  'src/platform/agentRuntime/BaseAIClientAgentModelGateway.ts',
  {
    '@platform/ai': agentGatewayModule,
    '@shared/diagnostics/TurnTimelineLog': {
      logTurnTimeline: (event, context) => timelineEvents.push({ event, context }),
    },
  },
);
const chatGatewayModule = loadTypeScriptModule(
  'src/features/chat/reply/agent/ChatAgentModelGateway.ts',
  {
    '@platform/agentRuntime': baseAIClientGatewayModule,
  },
);

const { ChatAgentModelGateway } = chatGatewayModule;

const tokenEstimator = loadTypeScriptModule('src/shared/prompt/estimateTextTokens.ts');
const tokenBudget = loadTypeScriptModule('src/host/prompt/tokenBudget.ts', {
  '@shared/prompt': tokenEstimator,
});
const blockMetadata = loadTypeScriptModule('src/host/prompt/compiler/promptBlockMetadata.ts');
const { PromptPackCompiler } = loadTypeScriptModule('src/host/prompt/compiler/PromptPackCompiler.ts', {
  '../tokenBudget': tokenBudget,
  './promptBlockMetadata': blockMetadata,
});

function compilePrompt({ autonomous = false, toolsFirst = false, toolsEnabled = true,
  summary = '旧摘要段', time = '本轮时间上下文' } = {}) {
  const scenario = 'chat.private_reply';
  const blocks = [
    { key: 'persona', content: '角色设定' },
    { key: 'tools_description', content: '原工具使用规则' },
    { key: 'persona', definitionId: 'custom.tool_rules', slot: 'capabilities', protection: 'editable', content: '其他固定能力规则' },
    { key: 'conversation_summary', content: summary },
    { key: 'tool_context_explanation', content: '本轮触发原因' },
    { key: 'agent_registry_summary', content: '当前协作状态' },
    { key: 'moment_audience_candidates', content: '当前时刻候选' },
    { key: 'time_awareness', content: time },
  ].map((block) => ({ ...block, required: false, status: 'ready', placement: 'system' }));
  const preset = {
    id: 'test-tools-position', version: 1, name: '工具位置测试', scenarioId: scenario,
    items: [
      { definitionId: 'persona.assistant', slot: 'persona', sortOrder: 1 },
      { definitionId: 'context.tools_description', slot: 'capabilities', sortOrder: toolsFirst ? 1 : 100, enabled: toolsEnabled },
      { definitionId: 'custom.tool_rules', slot: 'capabilities', sortOrder: 50 },
      { definitionId: 'context.conversation_summary', slot: 'dynamic_context', sortOrder: 160 },
      { definitionId: 'context.tool_explanation', slot: 'capabilities', sortOrder: 70 },
      { definitionId: 'context.agent_registry', slot: 'user_rules', sortOrder: 80 },
      { definitionId: 'context.moment_audience_candidates', slot: 'capabilities', sortOrder: 85 },
      { definitionId: 'context.time_awareness', slot: 'dynamic_context', sortOrder: 1 },
    ].map((item) => ({ enabled: true, required: false, protection: 'locked', ...item })),
  };
  const params = {
    scenario, blocks, preset,
    recentMessages: [{ role: 'assistant', content: '之前的聊天' }],
    currentInput: { role: 'user', content: '测试请求' },
  };
  const compiler = new PromptPackCompiler();
  return compiler.compile(params);
}

function response(messageId, text = '模型回复') {
  return {
    text,
    reasoningText: '',
    finishReason: 'stop',
    messageId,
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    success: true,
    error: null,
    toolCalls: null,
    isToolCall: false,
  };
}

function toolDescriptor() {
  return {
    name: 'lookup',
    description: '查询测试工具',
    inputSchema: { type: 'object' },
  };
}

function createClient() {
  const calls = [];
  const client = {
    calls,
    chat: async (messages, options) => {
      calls.push({ method: 'chat', messages, options });
      return response('chat-message');
    },
    chatStream: async (messages, options) => {
      calls.push({ method: 'chatStream', messages, options });
      await options?.onDelta?.({ type: 'answer_delta', text: '模型回复' });
      return response('chat-stream-message');
    },
    chatWithTools: async (messages, tools, options) => {
      calls.push({ method: 'chatWithTools', messages, tools, options });
      return response('tools-message');
    },
    chatStreamWithTools: async (messages, tools, options) => {
      calls.push({ method: 'chatStreamWithTools', messages, tools, options });
      await options?.onDelta?.({ type: 'answer_delta', text: '模型回复' });
      return response('tools-stream-message');
    },
  };
  return client;
}

async function runCase(transport, tools, promptPack = compilePrompt()) {
  timelineEvents.length = 0;
  const client = createClient();
  const gateway = new ChatAgentModelGateway({
    client,
    initialMessages: promptPack.modelMessages,
    toolInstructionsSlot: promptPack.toolInstructionsSlot,
    diagnosticContext: {
      sessionId: 'session-test',
      runId: 'run-test',
      correlationId: 'correlation-test',
    },
  });
  const controller = new AbortController();
  await gateway.runTurn({
    task: {},
    toolInstructions: { catalog: '固定工具包目录', state: '本轮工具包状态' },
    history: [],
    tools,
    transport,
    signal: controller.signal,
  });
  return {
    client,
    completed: gateway.takeCompletedTurn(1),
    signal: controller.signal,
    timelineEvents: [...timelineEvents],
    gateway,
  };
}

const cases = [
  { transport: 'complete', tools: [], method: 'chat', messageId: 'chat-message' },
  { transport: 'stream', tools: [], method: 'chatStream', messageId: 'chat-stream-message' },
  { transport: 'complete', tools: [toolDescriptor()], method: 'chatWithTools', messageId: 'tools-message' },
  { transport: 'stream', tools: [toolDescriptor()], method: 'chatStreamWithTools', messageId: 'tools-stream-message' },
];

for (const testCase of cases) {
  const { client, completed, signal, timelineEvents: events } = await runCase(testCase.transport, testCase.tools);
  assert.equal(client.calls.length, 1, `${testCase.transport} + ${testCase.tools.length} tools 只能调用一次 Provider`);
  const call = client.calls[0];
  assert.deepEqual(call.messages, [
    { role: 'system', content: '角色设定\n\n其他固定能力规则\n\n原工具使用规则\n\n固定工具包目录\n\n旧摘要段' },
    { role: 'assistant', content: '之前的聊天' },
    { role: 'system', content: '当前协作状态\n\n本轮触发原因\n\n当前时刻候选\n\n本轮时间上下文\n\n本轮工具包状态' },
    { role: 'user', content: '测试请求' },
  ], '固定说明、摘要、历史、本轮上下文和当前输入必须按持久性组装');
  assert.equal(call.options.includeSystemPrompt, false, '不得再注入 Client 配置中的旧 system');
  assert.equal(call.method, testCase.method, `${testCase.transport} + ${testCase.tools.length} tools 必须选择 ${testCase.method}`);
  assert.equal(completed.messageId, testCase.messageId);

  if (testCase.tools.length === 0) {
    assert.equal('tools' in call, false, '无工具请求不得携带 tools 参数');
    assert.equal('toolChoice' in call.options, false, '无工具请求不得携带 toolChoice');
  } else {
    assert.equal(call.tools.length, 1, '有工具请求必须透传有效工具定义');
    assert.equal(call.options.toolChoice, 'auto');
  }

  assert.equal(call.options.signal, signal, '请求必须透传同一个 abort signal');
  if (testCase.transport === 'complete') {
    assert.equal(call.options.allowReasoningLengthRetry, true, 'complete 请求必须保留 reasoning-length retry');
  } else {
    assert.equal(typeof call.options.onDelta, 'function', 'stream 请求必须透传增量回调');
  }
  const expectedEvents = testCase.transport === 'complete'
    ? ['model_request_started']
    : ['model_request_started', 'first_delta_received', 'model_stream_completed'];
  assert.deepEqual(
    events.map(({ event }) => event),
    expectedEvents,
    `${testCase.transport} diagnostics 里程碑必须保持统一顺序`,
  );
  for (const { context } of events) {
    assert.deepEqual(context, {
      sessionId: 'session-test',
      runId: 'run-test',
      correlationId: 'correlation-test',
    }, 'TurnTimeline diagnostics 必须保留窄 context IDs');
  }
}

for (const transport of ['complete', 'stream']) {
  for (const autonomous of [false, true]) {
    const promptPack = compilePrompt({ autonomous, toolsFirst: true });
    const { client, gateway } = await runCase(transport, [toolDescriptor()], promptPack);
    const expectedSuffix = '';
    const fixedPrefix = '角色设定\n\n原工具使用规则\n\n固定工具包目录\n\n其他固定能力规则\n\n旧摘要段';
    assert.equal(client.calls[0].messages[0].content,
      `${fixedPrefix}${expectedSuffix}`,
      '目录必须跟随预设中的工具说明排序，自主任务保留完整 system 上下文');
    await gateway.runTurn({
      task: {}, history: [], tools: [toolDescriptor()], transport,
      toolInstructions: { catalog: '固定工具包目录', state: '拆包后的最新状态' },
    });
    assert.equal(client.calls[1].messages[0].content,
      `${fixedPrefix}${expectedSuffix.replace('本轮工具包状态', '拆包后的最新状态')}`,
      '拆包只更新历史之后的状态，固定目录和摘要不变');
    {
      assert.deepEqual(client.calls[1].messages.slice(0, 2), client.calls[0].messages.slice(0, 2),
        '拆包不得改变前置 system 和原始历史');
      assert.match(client.calls[1].messages[2].content, /拆包后的最新状态/u);
    }
    assert.equal(client.calls[1].options.includeSystemPrompt, false);
  }
}

const disabledPrompt = compilePrompt({ toolsEnabled: false });
const { client: disabledClient } = await runCase('complete', [], disabledPrompt);
assert.deepEqual(disabledClient.calls[0].messages, disabledPrompt.modelMessages,
  '未启用工具说明时不能绕过预设追加目录');
assert.equal(disabledClient.calls[0].options.includeSystemPrompt, true);

// 本轮事实变化不能改动长摘要前缀；摘要追加只延长原有正文。
const oldSummaryPrompt = compilePrompt();
const changedContextPrompt = compilePrompt({ time: '更新后的本轮时间' });
assert.equal(changedContextPrompt.systemPrompt, oldSummaryPrompt.systemPrompt,
  '每轮上下文变化不得改变常驻内容与聊天摘要');
const appendedSummaryPrompt = compilePrompt({ summary: '旧摘要段\n新摘要段' });
assert.ok(appendedSummaryPrompt.systemPrompt.startsWith(oldSummaryPrompt.systemPrompt),
  '追加摘要必须保留旧段的完整文本前缀');
assert.deepEqual(appendedSummaryPrompt.recentMessages, oldSummaryPrompt.recentMessages);

// 输入适配只替换末尾输入，编译器固定的本轮状态位置不依赖输入条数或多模态形式。
const { applyRuntimeModelInput } = loadTypeScriptModule('src/features/chat/reply/application/ChatReplyUtils.ts');
for (const inputOptions of [
  { batch: [{ type: 'text', text: '图片问题' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,test' } }] },
  { inputs: [{ role: 'user', content: '第一条输入' }, { role: 'user', content: '第二条输入' }] },
]) {
  const requestMessages = applyRuntimeModelInput(oldSummaryPrompt.modelMessages, inputOptions.batch, inputOptions.inputs);
  const { client } = await runCase('complete', [], { ...oldSummaryPrompt, modelMessages: requestMessages });
  const expectedInputs = inputOptions.inputs ?? [{ role: 'user', content: inputOptions.batch }];
  assert.deepEqual(client.calls[0].messages.slice(3), expectedInputs, '当前输入必须完整保留在本轮上下文之后');
  assert.match(client.calls[0].messages[2].content, /本轮工具包状态/u);
}

for (const transport of ['complete', 'stream']) {
  const { client, gateway } = await runCase(transport, [toolDescriptor()]);
  const instructions = { catalog: '固定工具包目录', state: '本轮工具包状态' };
  const history = [
    { role: 'assistant', content: '', reasoningText: '本轮原始推理',
      toolCalls: [{ id: 'tool-call-1', name: 'lookup', arguments: '{"query":"第一步"}' }] },
    { role: 'tool', toolCallId: 'tool-call-1', name: 'lookup', content: '第一步真实结果' },
  ];
  await gateway.runTurn({
    task: {}, history, tools: [toolDescriptor()], transport, toolInstructions: instructions,
    toolBudget: { remainingToolCalls: 2, maxToolCallsPerStep: 1, forceFinalResponse: false },
  });
  assert.deepEqual(client.calls[1].messages.slice(0, 4), client.calls[0].messages,
    '追加本轮调用记录时不得改写已有输入');
  assert.equal(client.calls[1].messages[4].reasoning_content, '本轮原始推理');
  assert.equal(client.calls[1].messages[5].tool_call_id, 'tool-call-1');
  assert.match(client.calls[1].messages.at(-1).content, /还可调用 2 次工具/u);
  await gateway.runTurn({
    task: {}, history: [...history, { role: 'assistant', content: '继续查询', reasoningText: '', toolCalls: [] }],
    tools: [toolDescriptor()], transport, toolInstructions: instructions,
    toolBudget: { remainingToolCalls: 1, maxToolCallsPerStep: 1, forceFinalResponse: false },
    completionContinuationInstruction: '完成前的补充指令',
  });
  assert.deepEqual(client.calls[2].messages.slice(0, 6), client.calls[1].messages.slice(0, 6),
    '每步变化的预算不得截断已经完成的真实工具记录前缀');
  assert.equal(client.calls[2].messages[6].content, '继续查询');
  assert.equal(client.calls[2].messages[7].content, '完成前的补充指令');
  assert.match(client.calls[2].messages.at(-1).content, /还可调用 1 次工具/u);
}

// 验证真实 Client 发出的请求，避免只验证网关向 Client 传参而漏掉重复 system。
const { BaseAIClient } = loadTypeScriptModule('src/platform/ai/BaseAIClient.ts', {
  './errorMapping': loadTypeScriptModule('src/platform/ai/errorMapping.ts'),
  './baseUrl': loadTypeScriptModule('src/platform/ai/baseUrl.ts'),
});
const originalFetch = globalThis.fetch;
const requestBodies = [];
const queuedResponses = [];
globalThis.fetch = async (_url, options) => {
  requestBodies.push(JSON.parse(options.body));
  const next = queuedResponses.shift() ?? {
    ok: true,
    data: { id: 'provider-message', choices: [{ finish_reason: 'stop', message: { content: '真实回复' } }] },
  };
  return { ok: next.ok, status: next.ok ? 200 : 400, json: async () => next.data };
};
try {
  const promptPack = compilePrompt();
  const client = new BaseAIClient({
    baseURL: 'https://example.invalid/v1', apiKey: 'test-key', model: 'test-model',
    systemPrompt: promptPack.systemPrompt,
  });
  const gateway = new ChatAgentModelGateway({
    client, initialMessages: promptPack.modelMessages, toolInstructionsSlot: promptPack.toolInstructionsSlot,
    diagnosticContext: { sessionId: 'session-test', runId: 'run-test' },
  });
  await gateway.runTurn({
    task: {}, history: [], tools: [toolDescriptor()], transport: 'complete',
    toolInstructions: { catalog: '真实目录', state: '真实展开状态' },
  });
  assert.deepEqual(requestBodies[0].messages, [
    { role: 'system', content: '角色设定\n\n其他固定能力规则\n\n原工具使用规则\n\n真实目录\n\n旧摘要段' },
    { role: 'assistant', content: '之前的聊天' },
    { role: 'system', content: '当前协作状态\n\n本轮触发原因\n\n当前时刻候选\n\n本轮时间上下文\n\n真实展开状态' },
    { role: 'user', content: '测试请求' },
  ], '真实非流式带工具请求必须只含一份前置 system');

  const tools = requestBodies[0].tools;
  const explicitMessages = [{ role: 'system', content: '显式 system' }, { role: 'user', content: '测试' }];
  for (const retryResponse of [
    { ok: true, data: { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '尚未完成' } }] } },
    { ok: false, data: { error: { message: 'reasoning_content missing' } } },
  ]) {
    const start = requestBodies.length;
    queuedResponses.push(retryResponse);
    const result = await client.chatWithTools(explicitMessages, tools, { includeSystemPrompt: false });
    assert.equal(result.success, true);
    assert.equal(requestBodies.length, start + 2, '失败请求应通过既有重试完成');
    for (const body of requestBodies.slice(start)) {
      assert.deepEqual(body.messages, explicitMessages, '重试不得重新注入旧 system');
    }
  }
  await client.chatWithTools(explicitMessages.slice(1), tools);
  assert.deepEqual(requestBodies.at(-1).messages, [
    { role: 'system', content: promptPack.systemPrompt }, ...explicitMessages.slice(1),
  ], '省略选项时保持原有默认 system 注入契约');
  for (const field of ['reasoning_content', 'reasoning']) {
    queuedResponses.push({ ok: true, data: { choices: [{ finish_reason: 'stop', message: { content: '群成员回复', [field]: '群成员的思考' } }] } });
    const response = await client.chat([{ role: 'user', content: '群聊输入' }]);
    assert.equal(response.reasoningText, '群成员的思考', '非流式群聊保留 SSE 同样支持的推理字段');
    assert.equal(response.text, '群成员回复');
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Chat model gateway 验证通过：摘要前缀、用途目录与展开状态分离、真实调用记录追加及 Client 单份 system。');
