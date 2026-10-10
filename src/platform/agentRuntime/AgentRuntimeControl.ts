/** 保存单个进程内的 Agent 执行所有权，并集中处理终态辅助逻辑。 */
import type { AgentRunEventSink } from './AgentRunEvent';
import {
  AgentRuntimeTerminalError,
  markStepCompleted,
  terminalCodeForAgentCancellation,
  type AgentRunResult,
  type AgentRunState,
} from './AgentRunState';

export interface ActiveAgentRun {
  controller: AbortController;
  result: Promise<AgentRunResult>;
}

export class AgentRuntimeControl {
  private readonly activeRuns = new Map<string, ActiveAgentRun>();
  private readonly transitionLocks = new Map<string, Promise<void>>();

  getActive(runId: string): ActiveAgentRun | undefined {
    return this.activeRuns.get(runId);
  }

  setActive(runId: string, active: ActiveAgentRun): void {
    if (this.activeRuns.has(runId)) {
      throw new Error(`Agent run ${runId} is already active`);
    }
    this.activeRuns.set(runId, active);
  }

  removeActive(runId: string, controller: AbortController): void {
    if (this.activeRuns.get(runId)?.controller === controller) {
      this.activeRuns.delete(runId);
    }
  }

  assertInactive(runId: string): void {
    if (this.activeRuns.has(runId)) {
      throw new Error(`Agent run ${runId} is already active`);
    }
  }

  async transition<T>(runId: string, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.transitionLocks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.transitionLocks.set(runId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.transitionLocks.get(runId) === tail) {
        this.transitionLocks.delete(runId);
      }
    }
  }
}

export async function closeOpenAgentStep(
  state: AgentRunState,
  eventSink: AgentRunEventSink | undefined,
  now: number
): Promise<void> {
  const step = state.steps[state.steps.length - 1];
  if (!step || step.completedAt !== null) {
    return;
  }
  markStepCompleted(step, now);
  if (eventSink) {
    await eventSink({
      type: 'step_completed',
      runId: state.runId,
      stepIndex: step.stepIndex,
      toolCallCount: step.toolCalls.length,
    });
  }
}

export function resolveAgentTerminalCode(
  error: unknown,
  signal: AbortSignal
): AgentRuntimeTerminalError['code'] {
  if (error instanceof AgentRuntimeTerminalError) {
    return error.code;
  }
  return signal.aborted ? terminalCodeForAgentCancellation(signal) : 'RUNTIME_UNAVAILABLE';
}
