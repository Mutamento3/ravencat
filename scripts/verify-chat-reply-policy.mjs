import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadTypeScriptModule(relativePath, requireModule = () => {
  throw new Error(`${relativePath} 不应产生运行时依赖`);
}) {
  const sourcePath = path.join(repoRoot, relativePath);
  const compiled = ts.transpileModule(
    fs.readFileSync(sourcePath, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: sourcePath,
      reportDiagnostics: true,
    },
  );
  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(errors, [], `${relativePath} 无法编译`);

  const module = { exports: {} };
  const executeModule = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    compiled.outputText,
  );
  executeModule(
    module.exports,
    requireModule,
    module,
    sourcePath,
    path.dirname(sourcePath),
  );
  return module.exports;
}

const { resolveAIReplyPolicy } = loadTypeScriptModule(
  'src/features/chat/reply/application/ReplyPolicy.ts',
);

const baseConfig = {
  id: 'assistant-1',
  agentId: 'agent-1',
  name: 'Kimi',
  model: 'test-model',
  apiKey: 'test-key',
  apiBaseUrl: 'https://example.test',
};

function resolve({ enableTools, enableStreamingReply, allowMultipleBubbles, runtime = {} }) {
  return resolveAIReplyPolicy(
    {
      ...baseConfig,
      enableTools,
      enableStreamingReply,
      allowMultipleBubbles,
    },
    {
      triggerSource: 'chat',
      allowedToolNames: enableTools ? ['lookup'] : [],
      ...runtime,
    },
  );
}

// 两个正交维度的四种组合：transport 不再携带 tools 维度。
assert.deepEqual(resolve({ enableTools: false, enableStreamingReply: false }), {
  modelTransport: 'complete',
  enableTools: false,
  bubbleDeliveryMode: 'multi-bubble',
});
assert.deepEqual(resolve({ enableTools: false, enableStreamingReply: true }), {
  modelTransport: 'stream',
  enableTools: false,
  bubbleDeliveryMode: 'multi-bubble',
});
assert.deepEqual(resolve({ enableTools: true, enableStreamingReply: false }), {
  modelTransport: 'complete',
  enableTools: true,
  bubbleDeliveryMode: 'multi-bubble',
});
assert.deepEqual(resolve({ enableTools: true, enableStreamingReply: true }), {
  modelTransport: 'stream',
  enableTools: true,
  bubbleDeliveryMode: 'multi-bubble',
});

// 图片输入与工具授权是正交维度，图片不能关闭已经授权的工具。
assert.deepEqual(resolve({
  enableTools: true,
  enableStreamingReply: true,
  runtime: {
    batchModelInput: [{
      type: 'image_url',
      image_url: { url: 'file:///tmp/current-turn.png' },
    }],
  },
}), {
  modelTransport: 'stream',
  enableTools: true,
  bubbleDeliveryMode: 'multi-bubble',
});
assert.equal(resolve({ enableTools: true, runtime: {
  turnInputMessages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }] }],
} }).enableTools, true, '逐条多模态输入同样保留工具能力');
assert.equal(resolve({ enableTools: false, runtime: {
  batchModelInput: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }],
} }).enableTools, false, '图片不能授予已关闭的工具权限');

// bubbleDeliveryMode 只由 policy 解析，运行时下游无需再从 aiConfig 推导。
assert.equal(
  resolve({ enableTools: false, enableStreamingReply: false, allowMultipleBubbles: false })
    .bubbleDeliveryMode,
  'single-bubble',
);
assert.equal(
  resolve({
    enableTools: false,
    enableStreamingReply: false,
    allowMultipleBubbles: true,
    runtime: { supportsMultipleBubbles: false },
  }).bubbleDeliveryMode,
  'single-bubble',
);

// 通过真实 ChatAgentReplyFlow 创建 task，证明 policy 会在 Agent 边界封死工具列表。
const capturedTasks = [];
class StubProjector {
  async projectModelTurn() {}
  async handleEvent() {}
  async completeRun() {}
  async failRun() {}
}
const flowRuntimeModules = new Map([
  ['@platform/agentRuntime', {
    AgentRunEventQueue: class {
      constructor(projectEvent) {
        this.projectEvent = projectEvent;
      }
      enqueue(event) {
        return this.projectEvent(event);
      }
      async drain() {}
    },
  }],
  ['../application/ChatReplyRuntimeDependencies', {
    getChatReplyRuntimeDependencies: () => ({
      tools: {},
      agent: {
        run: async ({ task }) => {
          capturedTasks.push(task);
          return { terminalCode: 'CANCELLED_BY_USER', steps: [] };
        },
      },
    }),
  }],
  ['../application/ChatReplyAbort', { assertChatReplyNotAborted: () => {} }],
  ['../application/ChatReplyRuntime', { createRuntimeToolContext: () => ({}) }],
  ['../application/ChatReplyUtils', { buildLogicalMessageId: () => 'run-1' }],
  ['../../messages/application/AgentTransientTimeline', {
    createAgentTransientTimelineSink: () => ({}),
  }],
  ['./ChatAgentModelGateway', {
    ChatAgentModelGateway: class {
      hasObservedModelOutput() { return false; }
      requireModelRequestError() { return new Error('unexpected model failure'); }
      takeCompletedTurn() { throw new Error('unexpected completed model turn'); }
    },
  }],
  ['./ChatAgentRunProjector', { ChatAgentRunProjector: StubProjector }],
  ['./ChatAgentTask', { createChatAgentTask: (params) => params }],
]);
const { runChatAgentReplyFlow } = loadTypeScriptModule(
  'src/features/chat/reply/agent/ChatAgentReplyFlow.ts',
  (specifier) => {
    const runtimeModule = flowRuntimeModules.get(specifier);
    if (!runtimeModule) {
      throw new Error(`ChatAgentReplyFlow 出现未声明的运行时依赖：${specifier}`);
    }
    return runtimeModule;
  },
);

const disabledToolsPolicy = resolve({
  enableTools: false,
  enableStreamingReply: false,
  runtime: {
    batchModelInput: [{
      type: 'image_url',
      image_url: { url: 'file:///tmp/current-turn.png' },
    }],
  },
});
await runChatAgentReplyFlow({
  sessionId: 'conversation-1',
  originalUserText: 'hello',
  requestMessages: [{ role: 'user', content: 'hello' }],
  aiConfig: baseConfig,
  repository: {},
  runtimeContext: { allowedToolNames: ['lookup'] },
  policy: disabledToolsPolicy,
  client: {},
  persistence: {},
});
assert.deepEqual(
  capturedTasks.at(-1).allowedToolNames,
  [],
  'policy 禁用工具后，Agent task 必须收到空 allowedToolNames',
);

await runChatAgentReplyFlow({
  sessionId: 'conversation-1',
  originalUserText: 'hello',
  requestMessages: [{ role: 'user', content: 'hello' }],
  aiConfig: baseConfig,
  repository: {},
  runtimeContext: { allowedToolNames: ['lookup'] },
  policy: resolve({ enableTools: true, enableStreamingReply: false }),
  client: {},
  persistence: {},
});
assert.deepEqual(
  capturedTasks.at(-1).allowedToolNames,
  ['lookup'],
  'policy 允许工具时，Agent task 应原样消费上游已解析的 effective tool names',
);

console.log('Chat ReplyPolicy 行为验证通过：传输与工具正交、图片保留授权、泡泡策略与 Agent task 权限边界。');
