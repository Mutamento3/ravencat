/** 装配并管理一次正常 Host Agent Run，登记范围覆盖准备、执行与连接释放。 */
import {
  AgentRuntime,
  type AgentRunModelGateway,
  type AgentRunResult,
  type AgentRunTerminalResult,
  type AgentRuntimeCancelRequest,
  type AgentRuntimeRequest,
} from '@platform/agentRuntime';
import {
  prepareAgentToolRegistry,
  releaseAgentToolRunScope,
  getToolPackageRuntimeBindings,
  readDirectToolNamesForHostRun,
} from './createAgentToolRegistry';
import type { LegacyToolContextFactory } from './LegacyAgentToolAdapter';
import { registerMcpToolsForHostRun } from './registerMcpToolsForHostRun';
import { registerToolPackagesForHostRun } from './ToolPackageExposure';

export interface HostAgentRunRequest extends AgentRuntimeRequest {
  modelGateway: AgentRunModelGateway;
  createLegacyContext: LegacyToolContextFactory;
  /** Chat 提交 owner 提供的会话有效拆包状态；其他运行只在当前 run 展开。 */
  openToolPackageIds?: readonly string[];
}

interface ActiveHostAgentRun {
  controller: AbortController;
  completion: Promise<AgentRunResult>;
}

const activeHostAgentRuns = new Map<string, ActiveHostAgentRun>();
let acceptingRuns = true;

function cancelledBeforeExecution(request: HostAgentRunRequest, signal: AbortSignal): AgentRunResult {
  return {
    runId: request.runId,
    taskId: request.task.id,
    status: 'cancelled',
    terminalCode: signal.reason === 'SUPERSEDED' ? 'SUPERSEDED' : 'CANCELLED_BY_USER',
    finalText: '',
    history: request.initialHistory,
    steps: [],
    stepCount: 0,
    toolCallCount: 0,
  };
}

/** 同步登记后才开始准备；reset 与重复 runId 在第一个 await 之前取得裁决。 */
export async function runHostAgent(request: HostAgentRunRequest): Promise<AgentRunResult> {
  const controller = new AbortController();
  if (!acceptingRuns) {
    controller.abort('CANCELLED_BY_USER');
    return cancelledBeforeExecution(request, controller.signal);
  }
  if (activeHostAgentRuns.has(request.runId)) {
    throw new Error(`Host Agent run ${request.runId} is already registered`);
  }
  const forwardAbort = () => controller.abort(request.signal!.reason);
  request.signal?.addEventListener('abort', forwardAbort, { once: true });
  if (request.signal?.aborted) forwardAbort();

  const completion = Promise.resolve().then(() => executeHostRun(request, controller.signal)).finally(() => {
    request.signal?.removeEventListener('abort', forwardAbort);
    releaseAgentToolRunScope(request.runId);
    activeHostAgentRuns.delete(request.runId);
  });
  activeHostAgentRuns.set(request.runId, { controller, completion });
  return completion;
}

async function executeHostRun(request: HostAgentRunRequest, signal: AbortSignal): Promise<AgentRunResult> {
  const { modelGateway, createLegacyContext, openToolPackageIds = [], ...runtimeRequest } = request;
  if (signal.aborted) return cancelledBeforeExecution(request, signal);
  const registry = await prepareAgentToolRegistry(createLegacyContext, runtimeRequest.task);
  if (signal.aborted) return cancelledBeforeExecution(request, signal);
  const directToolNames = await readDirectToolNamesForHostRun(runtimeRequest.task.assistantId);
  if (signal.aborted) return cancelledBeforeExecution(request, signal);
  const toolPackages = registerToolPackagesForHostRun({
    registry,
    allowedToolNames: runtimeRequest.task.allowedToolNames,
    bindings: getToolPackageRuntimeBindings(registry),
    openPackageIds: openToolPackageIds,
    directToolNames,
  });
  const mcpTools = await registerMcpToolsForHostRun({
    assistantId: runtimeRequest.task.assistantId,
    registry,
    allowedToolNames: runtimeRequest.task.allowedToolNames,
  });

  try {
    if (signal.aborted) return cancelledBeforeExecution(request, signal);
    const consumedNames = new Set(mcpTools.allowlistMcpToolNames);
    const baseNames = runtimeRequest.task.allowedToolNames.filter((name) => !consumedNames.has(name));
    const metaToolNames = [...toolPackages.metaToolNames, ...mcpTools.metaToolNames];
    const task = consumedNames.size > 0 || metaToolNames.length > 0
      ? { ...runtimeRequest.task, allowedToolNames: [...baseNames, ...metaToolNames] }
      : runtimeRequest.task;
    const runtime = new AgentRuntime({
      registry,
      modelGateway: {
        runTurn: (turn, emit) => modelGateway.runTurn({
          ...turn,
          toolInstructions: toolPackages.instructions(),
        }, emit),
      },
    });
    const packagedNames = new Set(toolPackages.packageToolNames);
    const alwaysVisibleNames = task.allowedToolNames.filter((name) => !packagedNames.has(name));
    return await runtime.run({
      ...runtimeRequest,
      task,
      signal,
      resolveVisibleToolNames: () => [...alwaysVisibleNames, ...toolPackages.visibleToolNames()],
    });
  } finally {
    // 连接释放仍在登记范围内，reset 不能在 dispose 尚未结束时开放清库。
    await mcpTools.dispose();
  }
}

export async function cancelHostAgentRun(request: AgentRuntimeCancelRequest): Promise<AgentRunTerminalResult> {
  const active = activeHostAgentRuns.get(request.runId);
  if (!active) throw new Error(`Host Agent run ${request.runId} is not active in this host`);
  active.controller.abort('CANCELLED_BY_USER');
  return active.completion;
}

/** 新 Host 完成数据库启动后开放新请求，清库期间不接纳旧调用方迟到的 run。 */
export function resumeHostAgentRunsAfterReset(): void {
  acceptingRuns = true;
}

export async function cancelActiveHostAgentRunsForReset(): Promise<void> {
  acceptingRuns = false;
  const entries = [...activeHostAgentRuns.entries()];
  for (const [, active] of entries) active.controller.abort('CANCELLED_BY_USER');
  const results = await Promise.allSettled(entries.map(([, active]) => active.completion));
  const errors = results.flatMap((result, index) => result.status === 'rejected'
    ? [new Error(`Host Agent run ${entries[index][0]} 取消或释放失败`, { cause: result.reason })]
    : []);
  if (errors.length > 0) throw new AggregateError(errors, '恢复出厂取消 Host Agent Runtime 失败');
}
