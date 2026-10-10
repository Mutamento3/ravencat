/** 为 Agent Runtime 统一提供工具预算与取消边界。 */
import type { AgentTask } from '@shared/aiTools';
import type { ModelToolCall } from '@platform/ai';
import {
  AgentRuntimeTerminalError,
  terminalCodeForAgentCancellation,
  type AgentRunState,
} from './AgentRunState';

export const AGENT_RUNTIME_HARD_LIMITS = {
  maxSteps: 10,
  maxToolCalls: 30,
  maxToolCallsPerStep: 3,
} as const;

export const AGENT_TOOL_BATCH_TIMEOUT_MS = 10 * 60 * 1000;

export interface AgentClock {
  now(): number;
}

export class AgentToolExecutionTimeoutError extends Error {
  constructor() {
    super('Agent tool execution timed out');
    this.name = 'AgentToolExecutionTimeoutError';
  }
}

interface AgentBudgetSnapshot {
  maxSteps: number;
  maxToolCalls: number;
  maxToolCallsPerStep: number;
}

export interface AgentToolBatchRejection {
  code: 'TOOL_BATCH_LIMIT_EXCEEDED' | 'TOOL_BUDGET_EXHAUSTED';
  modelContent: string;
  closeToolAccess: boolean;
}

export function validateAgentTaskBudget(task: AgentTask): void {
  assertPositiveIntegerWithinLimit('maxSteps', task.maxSteps, AGENT_RUNTIME_HARD_LIMITS.maxSteps);
  assertPositiveIntegerWithinLimit(
    'maxToolCalls',
    task.maxToolCalls,
    AGENT_RUNTIME_HARD_LIMITS.maxToolCalls
  );
  assertPositiveIntegerWithinLimit(
    'maxToolCallsPerStep',
    task.maxToolCallsPerStep,
    AGENT_RUNTIME_HARD_LIMITS.maxToolCallsPerStep
  );
  const createdAt = Date.parse(task.createdAt);
  if (!Number.isFinite(createdAt)) {
    throw new Error('Agent task createdAt must be a valid timestamp');
  }
}

export class AgentBudgetGuard {
  shouldForceFinalResponse(state: AgentRunState): boolean {
    return state.stepCount >= state.task.maxSteps
      || state.toolCallCount >= state.task.maxToolCalls;
  }

  remainingToolCalls(state: AgentRunState): number {
    return state.task.maxToolCalls - state.toolCallCount;
  }

  inspectToolBatch(
    state: AgentRunState,
    toolCalls: readonly ModelToolCall[]
  ): AgentToolBatchRejection | null {
    if (toolCalls.length > state.task.maxToolCallsPerStep) {
      return {
        code: 'TOOL_BATCH_LIMIT_EXCEEDED',
        modelContent: `本轮最多调用 ${state.task.maxToolCallsPerStep} 个工具；本批次未执行。请减少调用数量后重试。`,
        closeToolAccess: false,
      };
    }
    const remainingToolCalls = this.remainingToolCalls(state);
    if (toolCalls.length > remainingToolCalls) {
      return {
        code: 'TOOL_BUDGET_EXHAUSTED',
        modelContent: `本次运行只剩 ${remainingToolCalls} 次工具调用额度，无法执行包含 ${toolCalls.length} 个调用的批次。工具调用阶段已经结束，请根据已有结果直接回答。`,
        closeToolAccess: true,
      };
    }
    return null;
  }

  assertNotCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new AgentRuntimeTerminalError(terminalCodeForAgentCancellation(signal));
    }
  }
}

export class AgentOperationGuard {
  constructor(
    private readonly budgetGuard: AgentBudgetGuard,
    private readonly clock: AgentClock,
  ) {}

  runModelTurn<T>(
    signal: AbortSignal,
    operation: (operationSignal: AbortSignal) => Promise<T>
  ): Promise<T> {
    return this.run(signal, null, operation);
  }

  runToolExecution<T>(
    signal: AbortSignal,
    deadlineAt: number,
    operation: (operationSignal: AbortSignal) => Promise<T>
  ): Promise<T> {
    return this.run(signal, deadlineAt, operation);
  }

  private run<T>(
    signal: AbortSignal,
    deadlineAt: number | null,
    operation: (operationSignal: AbortSignal) => Promise<T>
  ): Promise<T> {
    this.budgetGuard.assertNotCancelled(signal);
    const operationController = new AbortController();
    const remainingMs = deadlineAt === null ? null : deadlineAt - this.clock.now();
    if (remainingMs !== null && remainingMs <= 0) {
      operationController.abort('AGENT_TOOL_EXECUTION_TIMEOUT');
      return Promise.reject(new AgentToolExecutionTimeoutError());
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const settle = (complete: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener('abort', cancel);
        if (timeout !== null) {
          clearTimeout(timeout);
        }
        complete();
      };
      const cancel = (): void => {
        operationController.abort();
        settle(() => reject(new AgentRuntimeTerminalError(
          terminalCodeForAgentCancellation(signal)
        )));
      };
      const expire = (): void => {
        operationController.abort('AGENT_TOOL_EXECUTION_TIMEOUT');
        settle(() => reject(new AgentToolExecutionTimeoutError()));
      };
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      if (remainingMs !== null) {
        timeout = setTimeout(expire, remainingMs);
      }
      void Promise.resolve()
        .then(() => operation(operationController.signal))
        .then(
          (value) => settle(() => resolve(value)),
          (error: unknown) => settle(() => reject(error))
        );
    });
  }
}

function assertPositiveIntegerWithinLimit(
  fieldName: keyof AgentBudgetSnapshot,
  value: number,
  hardLimit: number
): void {
  if (!Number.isInteger(value) || value <= 0 || value > hardLimit) {
    throw new Error(`Agent task ${fieldName} exceeds its allowed budget`);
  }
}
