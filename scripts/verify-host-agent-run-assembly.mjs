import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadTypeScriptModule(relativePath, mocks) {
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
  new Function('exports', 'require', 'module', compiled.outputText)(
    module.exports,
    requireMock,
    module,
  );
  return module.exports;
}

function parse(relativePath) {
  return ts.createSourceFile(
    relativePath,
    read(relativePath),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

const assemblyPath = 'src/host/composition/agent/HostAgentRunAssembly.ts';
const assemblyAst = parse(assemblyPath);
const assemblyImports = assemblyAst.statements
  .filter(ts.isImportDeclaration)
  .map((statement) => statement.moduleSpecifier.text);
assert.equal(
  assemblyImports.some((specifier) => specifier.startsWith('@features/')),
  false,
  'Host Agent Run assembly 不得依赖任何 Feature',
);

const chatCompositionAst = parse('src/host/composition/configureChatRuntime.ts');
let agentRunInitializer = null;
let agentCancelInitializer = null;
function visit(node) {
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
    if (node.name.text === 'run') agentRunInitializer = node.initializer;
    if (node.name.text === 'cancel') agentCancelInitializer = node.initializer;
  }
  ts.forEachChild(node, visit);
}
visit(chatCompositionAst);
assert.ok(
  agentRunInitializer && ts.isIdentifier(agentRunInitializer)
    && agentRunInitializer.text === 'runHostAgent',
  'Chat composition 必须直接复用 runHostAgent',
);
assert.ok(
  agentCancelInitializer && ts.isIdentifier(agentCancelInitializer)
    && agentCancelInitializer.text === 'cancelHostAgentRun',
  'Chat composition 必须直接复用 cancelHostAgentRun',
);

let registryCreations = 0;
let registeredAllowedNames = null;
let registeredPackageAllowedNames = null;
let registeredDirectToolNames = null;
let disposeCount = 0;
const releasedToolRuns = [];
let capturedRuntimeRequest = null;
let capturedModelInstructions = null;
let pendingRuntime = null;

class TestAgentRuntime {
  constructor(dependencies) {
    this.dependencies = dependencies;
  }

  async run(request) {
    capturedRuntimeRequest = request;
    await this.dependencies.modelGateway.runTurn({});
    if (request.task.goal === 'fail') {
      throw new Error('synthetic failure');
    }
    if (request.task.goal === 'pending') {
      pendingRuntime = this;
      return await new Promise((resolve) => {
        this.resolvePending = resolve;
      });
    }
    return { terminalCode: 'COMPLETED', runId: request.runId };
  }

  async cancel(request) {
    const result = { terminalCode: 'CANCELLED_BY_USER', runId: request.runId };
    this.resolvePending(result);
    return result;
  }
}

const assembly = loadTypeScriptModule(assemblyPath, {
  '@platform/agentRuntime': { AgentRuntime: TestAgentRuntime },
  './createAgentToolRegistry': {
    readDirectToolNamesForHostRun: async (id) => {
      assert.equal(id, 'test-assistant');
      return ['package_child'];
    },
    releaseAgentToolRunScope: (runId) => { releasedToolRuns.push(runId); },
    prepareAgentToolRegistry: (createLegacyContext) => {
      registryCreations += 1;
      assert.equal(typeof createLegacyContext, 'function');
      return { registryId: registryCreations };
    },
    getToolPackageRuntimeBindings: (registry) => [{
      packageId: 'packageA',
      tool: { descriptor: { name: 'package_child' }, registryId: registry.registryId },
    }],
  },
  './ToolPackageExposure': {
    registerToolPackagesForHostRun: ({ registry, allowedToolNames, bindings, directToolNames }) => {
      registeredDirectToolNames = directToolNames;
      assert.equal(registry.registryId, registryCreations);
      assert.equal(bindings[0].tool.registryId, registry.registryId);
      registeredPackageAllowedNames = [...allowedToolNames];
      const selected = allowedToolNames.filter((name) => name === 'package_child');
      return {
        packageToolNames: selected,
        visibleToolNames: () => [],
        instructions: () => ({ catalog: '固定工具目录', state: '本轮展开状态' }),
        metaToolNames: selected.length > 0
          ? ['open_tool_package']
          : [],
      };
    },
  },
  './registerMcpToolsForHostRun': {
    registerMcpToolsForHostRun: async ({ registry, allowedToolNames, assistantId }) => {
      assert.equal(assistantId, 'test-assistant', 'Host 执行冻结必须传入 task 的 Assistant 实体 ID');
      assert.equal(registry.registryId, registryCreations, 'MCP 必须注册到本次唯一 Built-in Registry');
      registeredAllowedNames = [...allowedToolNames];
      return {
        allowlistMcpToolNames: allowedToolNames.filter((name) => name.startsWith('mcp.')),
        metaToolNames: allowedToolNames.some((name) => name.startsWith('mcp.'))
          ? ['mcp_list_tools', 'mcp_call_tool']
          : [],
        dispose: async () => { disposeCount += 1; },
      };
    },
  },
});

function createSyntheticRequest(runId, goal = 'success') {
  return {
    runId,
    task: {
      assistantId: 'test-assistant',
      id: `task-${runId}`,
      goal,
      allowedToolNames: ['built_in', 'package_child', 'mcp.server.lookup'],
    },
    initialHistory: [],
    modelGateway: { runTurn: async (request) => { capturedModelInstructions = request.toolInstructions; return {}; } },
    createLegacyContext: () => ({ synthetic: true }),
  };
}

await assembly.runHostAgent(createSyntheticRequest('success'));
assert.deepEqual(registeredDirectToolNames, ['package_child'], 'Host 必须读取本次 AI 的特批偏好');
assert.deepEqual(registeredAllowedNames, ['built_in', 'package_child', 'mcp.server.lookup']);
assert.deepEqual(registeredPackageAllowedNames, ['built_in', 'package_child', 'mcp.server.lookup']);
assert.deepEqual(
  capturedRuntimeRequest.task.allowedToolNames,
  [
    'built_in',
    'package_child',
    'open_tool_package',
    'mcp_list_tools',
    'mcp_call_tool',
  ],
  'Host 保留内置授权，工具包仅收窄暴露，MCP 仍走固定 meta-tools',
);
assert.deepEqual(capturedRuntimeRequest.resolveVisibleToolNames(), ['built_in', 'open_tool_package', 'mcp_list_tools', 'mcp_call_tool']);
assert.deepEqual(capturedModelInstructions, { catalog: '固定工具目录', state: '本轮展开状态' });
assert.equal(disposeCount, 1, '成功后必须释放 MCP lifecycle');
await assert.rejects(
  assembly.cancelHostAgentRun({ runId: 'success' }),
  /not active/,
  '成功后不得残留 active runtime',
);

await assert.rejects(
  assembly.runHostAgent(createSyntheticRequest('failure', 'fail')),
  /synthetic failure/,
);
assert.equal(disposeCount, 2, '失败后必须释放 MCP lifecycle');
await assert.rejects(
  assembly.cancelHostAgentRun({ runId: 'failure' }),
  /not active/,
  '失败后不得残留 active runtime',
);

const pendingExecution = assembly.runHostAgent(createSyntheticRequest('cancelled', 'pending'));
while (pendingRuntime === null) {
  await Promise.resolve();
}
const cancelled = await assembly.cancelHostAgentRun({ runId: 'cancelled' });
assert.equal(cancelled.terminalCode, 'CANCELLED_BY_USER');
assert.equal((await pendingExecution).terminalCode, 'CANCELLED_BY_USER');
assert.equal(disposeCount, 3, '取消后必须释放 MCP lifecycle');
assert.equal(releasedToolRuns.length, 3, '成功、失败、取消都必须释放 Tool 的临时查询队列');
await assert.rejects(
  assembly.cancelHostAgentRun({ runId: 'cancelled' }),
  /not active/,
  '取消后不得残留 active runtime',
);

assert.equal(registryCreations, 3, '每次 Host run 必须且只能创建一个 Built-in Registry');
console.log('Host Agent Run assembly 的 Feature 边界、Package/MCP 冻结及 lifecycle 已验证。');
