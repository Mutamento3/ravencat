/** 装配并管理一次正常 Host Agent Run，不拥有任何 Feature 业务生命周期。 */
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
  runtime: AgentRuntime;
  completion: Promise<AgentRunResult>;
}

const activeHostAgentRuns = new Map<string, ActiveHostAgentRun>();

/** 使用唯一 Built-in Registry、run-scoped MCP 能力和 AgentRuntime 执行一次 Host run。 */
export async function runHostAgent(
  request: HostAgentRunRequest,
): Promise<AgentRunResult> {
  if (activeHostAgentRuns.has(request.runId)) {
    throw new Error(`Host Agent run ${request.runId} is already registered`);
  }

  const { modelGateway, createLegacyContext, openToolPackageIds = [], ...runtimeRequest } = request;
  const registry = await prepareAgentToolRegistry(createLegacyContext, runtimeRequest.task);
  const toolPackages = registerToolPackagesForHostRun({
    registry,
    allowedToolNames: runtimeRequest.task.allowedToolNames,
    bindings: getToolPackageRuntimeBindings(registry),
    openPackageIds: openToolPackageIds,
    directToolNames: await readDirectToolNamesForHostRun(runtimeRequest.task.assistantId),
  });
  const mcpTools = await registerMcpToolsForHostRun({
    assistantId: runtimeRequest.task.assistantId,
    registry,
    allowedToolNames: runtimeRequest.task.allowedToolNames,
  });

  let tracked = false;
  try {
    // 内置工具保留原始授权，仅动态收窄可见集合；MCP 仍使用自己的 meta-tools。
    // 未被任一 run-scoped owner 消费的未知名称继续交给 Runtime 暴露错误。
    const consumedNames = new Set([
      ...mcpTools.allowlistMcpToolNames,
    ]);
    const baseNames = runtimeRequest.task.allowedToolNames.filter(
      (name) => !consumedNames.has(name),
    );
    const metaToolNames = [
      ...toolPackages.metaToolNames,
      ...mcpTools.metaToolNames,
    ];
    const task = consumedNames.size > 0 || metaToolNames.length > 0
      ? {
          ...runtimeRequest.task,
          allowedToolNames: [...baseNames, ...metaToolNames],
        }
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
    const completion = trackHostAgentRun(
      runtimeRequest.runId,
      runtime.run({
        ...runtimeRequest, task,
        resolveVisibleToolNames: () => [...alwaysVisibleNames, ...toolPackages.visibleToolNames()],
      }),
      mcpTools.dispose,
    );
    activeHostAgentRuns.set(runtimeRequest.runId, { runtime, completion });
    tracked = true;
    return await completion;
  } catch (error) {
    if (!tracked) {
      await mcpTools.dispose();
    }
    throw error;
  }
}

/** 取消当前宿主进程中由 runId 标识的正常 Agent run。 */
export async function cancelHostAgentRun(
  request: AgentRuntimeCancelRequest,
): Promise<AgentRunTerminalResult> {
  const active = requireActiveHostAgentRun(request.runId);
  const result = await active.runtime.cancel(request);
  await active.completion;
  return result;
}

function requireActiveHostAgentRun(runId: string): ActiveHostAgentRun {
  const active = activeHostAgentRuns.get(runId);
  if (!active) {
    throw new Error(`Host Agent run ${runId} is not active in this host`);
  }
  return active;
}

async function trackHostAgentRun(
  runId: string,
  execution: Promise<AgentRunResult>,
  dispose: () => Promise<void>,
): Promise<AgentRunResult> {
  try {
    return await execution;
  } finally {
    releaseAgentToolRunScope(runId);
    activeHostAgentRuns.delete(runId);
    await dispose();
  }
}

/** 恢复出厂前终止当前宿主进程中的全部正常 Agent run。 */
export async function cancelActiveHostAgentRunsForReset(): Promise<void> {
  const entries = [...activeHostAgentRuns.entries()];
  if (entries.length === 0) {
    return;
  }

  const rejected: { runId: string; error: unknown }[] = [];
  await Promise.all(
    entries.map(async ([runId, active]) => {
      try {
        await active.runtime.cancel({ runId });
        await active.completion;
      } catch (error) {
        // 取消失败的运行继续留在 Map，避免清库后失去诊断与再次终止的句柄。
        rejected.push({ runId, error });
      }
    }),
  );

  if (rejected.length === 0) {
    return;
  }

  const detail = rejected
    .map((item) => `${item.runId}: ${item.error instanceof Error ? item.error.message : String(item.error)}`)
    .join('; ');
  throw new AggregateError(
    rejected.map((item) => new Error(
      `Host Agent run ${item.runId} cancel failed for factory reset`,
      { cause: item.error },
    )),
    `恢复出厂取消 Host Agent Runtime 失败: ${detail}`,
  );
}
