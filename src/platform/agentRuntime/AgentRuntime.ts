/** 创建并运行无业务依赖的 Agent 状态机，执行生命周期仅存在于当前宿主进程。 */
import type { AgentTask } from '@shared/aiTools';
import type { ModelHistoryItem } from '@platform/ai';
import {
  AgentBudgetGuard,
  type AgentClock,
  validateAgentTaskBudget,
  AgentOperationGuard,
} from './AgentRuntimeGuards';
import type { AgentRunEventSink } from './AgentRunEvent';
import {
  AgentRuntimeTerminalError,
  createInitialAgentRunState,
  markRunRunning,
  markRunTerminal,
  terminalCodeForAgentCancellation,
  toAgentRunResult,
  type AgentRunResult,
  type AgentRunState,
  type AgentRunTerminalResult,
} from './AgentRunState';
import {
  AgentRuntimeControl,
  closeOpenAgentStep,
  resolveAgentTerminalCode,
  type ActiveAgentRun,
} from './AgentRuntimeControl';
import {
  AgentRunLoop,
  type AgentBeforeComplete,
  type AgentRunLoopContext,
  type AgentRunModelGateway,
} from './AgentRunLoop';
import { AgentToolExecutor } from './AgentToolExecutor';
import type { AgentToolRegistry } from './AgentToolRegistry';

export interface AgentRuntimeDependencies {
  modelGateway: AgentRunModelGateway;
  registry: AgentToolRegistry;
  clock?: AgentClock;
}

export interface AgentRuntimeRequest {
  runId: string;
  task: AgentTask;
  initialHistory: readonly ModelHistoryItem[];
  signal?: AbortSignal;
  eventSink?: AgentRunEventSink;
  /** 仅在模型自然给出最终输出时调用；异常终态不会进入该接缝。 */
  beforeComplete?: AgentBeforeComplete;
  resolveVisibleToolNames?: () => readonly string[];
}

export interface AgentRuntimeCancelRequest {
  runId: string;
  eventSink?: AgentRunEventSink;
}

export class AgentRuntime {
  private readonly clock: AgentClock;
  private readonly runLoop: AgentRunLoop;
  private readonly control = new AgentRuntimeControl();

  constructor(dependencies: AgentRuntimeDependencies) {
    this.clock = dependencies.clock ?? { now: () => Date.now() };
    const budgetGuard = new AgentBudgetGuard();
    this.runLoop = new AgentRunLoop({
      modelGateway: dependencies.modelGateway,
      registry: dependencies.registry,
      budgetGuard,
      operationGuard: new AgentOperationGuard(budgetGuard, this.clock),
      toolExecutor: new AgentToolExecutor(dependencies.registry),
      clock: this.clock,
    });
  }

  async run(request: AgentRuntimeRequest): Promise<AgentRunResult> {
    validateAgentTaskBudget(request.task);
    const started = await this.control.transition(request.runId, async () => {
      this.control.assertInactive(request.runId);
      const state = createInitialAgentRunState(
        request.runId,
        request.task,
        request.initialHistory,
        this.clock.now()
      );
      markRunRunning(state, this.clock.now());
      return {
        execution: this.startExecution(state, request),
      };
    });
    return await started.execution;
  }

  async cancel(request: AgentRuntimeCancelRequest): Promise<AgentRunTerminalResult> {
    const active = this.control.getActive(request.runId);
    if (active) {
      active.controller.abort('CANCELLED_BY_USER');
      return await active.result;
    }

    return await this.control.transition(request.runId, async () => {
      const transitionedActive = this.control.getActive(request.runId);
      if (transitionedActive) {
        transitionedActive.controller.abort('CANCELLED_BY_USER');
        return await transitionedActive.result;
      }
      throw new Error(`Agent run ${request.runId} is not active`);
    });
  }

  private startExecution(
    state: AgentRunState,
    request: {
      signal?: AbortSignal;
      eventSink?: AgentRunEventSink;
      beforeComplete?: AgentBeforeComplete;
      resolveVisibleToolNames?: () => readonly string[];
    },
  ): Promise<AgentRunResult> {
    const controller = new AbortController();
    const sourceSignal = request.signal;
    const forwardAbort = (): void => controller.abort(sourceSignal?.reason);
    if (sourceSignal) {
      if (sourceSignal.aborted) {
        forwardAbort();
      } else {
        sourceSignal.addEventListener('abort', forwardAbort, { once: true });
      }
    }
    const context: AgentRunLoopContext = {
      signal: controller.signal,
      eventSink: request.eventSink,
      beforeComplete: request.beforeComplete,
      resolveVisibleToolNames: request.resolveVisibleToolNames,
    };
    const execution = Promise.resolve()
      .then(() => this.executeState(state, context))
      .finally(() => {
        if (sourceSignal) {
          sourceSignal.removeEventListener('abort', forwardAbort);
        }
        this.control.removeActive(state.runId, controller);
      });
    const active: ActiveAgentRun = { controller, result: execution };
    this.control.setActive(state.runId, active);
    return execution;
  }

  private async executeState(
    state: AgentRunState,
    context: AgentRunLoopContext,
  ): Promise<AgentRunResult> {
    let executionError: Error | undefined;
    try {
      await this.runLoop.execute(state, context);
      if (context.signal.aborted) {
        throw new AgentRuntimeTerminalError(terminalCodeForAgentCancellation(context.signal));
      }
    } catch (error) {
      const terminalCode = resolveAgentTerminalCode(error, context.signal);
      if (!(error instanceof AgentRuntimeTerminalError) && !context.signal.aborted) {
        executionError = error instanceof Error ? error : new Error(String(error));
      }
      await closeOpenAgentStep(state, context.eventSink, this.clock.now());
      markRunTerminal(state, terminalCode, state.finalText, this.clock.now());
    }

    const result = toAgentRunResult(state);
    if (executionError) result.error = executionError;
    if (context.eventSink) {
      await context.eventSink({ type: 'run_completed', runId: state.runId, result });
    }
    return result;
  }
}
