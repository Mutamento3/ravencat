/** 执行唯一的模型 turn 与串行工具批次状态机，不拥有业务或持久化实现。 */
import type {
  AgentToolDescriptor,
  AgentTask,
  ModelTransportMode,
} from '@shared/aiTools';
import type {
  ModelEvent,
  ModelHistoryItem,
  ModelToolCall,
  ModelTurnResult,
} from '@platform/ai';
import type { PromptToolInstructions } from '@shared/prompt';
import {
  AgentBudgetGuard,
  type AgentClock,
  AGENT_TOOL_BATCH_TIMEOUT_MS,
  AgentToolExecutionTimeoutError,
  AgentOperationGuard,
} from './AgentRuntimeGuards';
import type { AgentRunEventSink } from './AgentRunEvent';
import {
  appendModelHistory,
  AgentRuntimeTerminalError,
  markStepCompleted,
  terminalCodeForAgentCancellation,
  appendToolResultHistory,
  type AgentToolOutcome,
  type AgentRunState,
  type AgentStepRecord,
} from './AgentRunState';
import { AgentToolExecutor } from './AgentToolExecutor';
import type { AgentToolRegistry } from './AgentToolRegistry';

export interface AgentModelTurnRequest {
  task: AgentTask;
  history: readonly ModelHistoryItem[];
  tools: readonly AgentToolDescriptor[];
  toolBudget: {
    remainingToolCalls: number;
    maxToolCallsPerStep: number;
    forceFinalResponse: boolean;
  };
  transport: ModelTransportMode;
  /** 正常完成前由调用方请求的受限补充指令；不改变原始 AgentTask。 */
  completionContinuationInstruction?: string;
  /** Host 固定的已授权用途目录与本次请求的展开状态。 */
  toolInstructions?: PromptToolInstructions;
  signal: AbortSignal;
}
export interface AgentRunModelGateway {
  runTurn(
    request: AgentModelTurnRequest,
    emitModelEvent?: (event: ModelEvent) => void | Promise<void>
  ): Promise<ModelTurnResult>;
}
export interface AgentRunLoopContext {
  signal: AbortSignal;
  eventSink?: AgentRunEventSink;
  beforeComplete?: AgentBeforeComplete;
  /** 每次请求的可见集合；只能从 task 已授权工具中收窄。 */
  resolveVisibleToolNames?: () => readonly string[];
}
export interface AgentBeforeCompleteContext {
  runId: string;
  task: AgentTask;
  history: readonly ModelHistoryItem[];
  finalText: string;
  completionContinuationUsed: boolean;
}
export type AgentBeforeCompleteDecision =
  | { action: 'complete' }
  | {
      action: 'continue';
      instruction: string;
      allowedToolNames: readonly string[];
    };
export type AgentBeforeComplete = (
  context: AgentBeforeCompleteContext,
) => Promise<AgentBeforeCompleteDecision>;
export interface AgentRunLoopDependencies {
  modelGateway: AgentRunModelGateway;
  registry: AgentToolRegistry;
  budgetGuard: AgentBudgetGuard;
  operationGuard: AgentOperationGuard;
  toolExecutor: AgentToolExecutor;
  clock: AgentClock;
}
export class AgentRunLoop {
  constructor(private readonly dependencies: AgentRunLoopDependencies) {}
  async execute(
    state: AgentRunState,
    context: AgentRunLoopContext,
  ): Promise<void> {
    await emitAgentEvent(context, { type: 'run_started', runId: state.runId, taskId: state.task.id });
    let toolAccessClosed = false;
    let completionContinuation: {
      instruction: string;
      allowedToolNames: readonly string[];
      toolCallAvailable: boolean;
    } | null = null;
    let completionContinuationUsed = false;
    while (state.status === 'running') {
      this.dependencies.budgetGuard.assertNotCancelled(context.signal);
      const forceFinalResponse = completionContinuation
        ? !completionContinuation.toolCallAvailable
        : toolAccessClosed || this.dependencies.budgetGuard.shouldForceFinalResponse(state);
      const stepIndex = state.stepCount + 1;
      await emitAgentEvent(context, { type: 'model_turn_started', runId: state.runId, stepIndex });

      const visibleNames = context.resolveVisibleToolNames?.();
      const authorizedNames = completionContinuation?.allowedToolNames ?? state.task.allowedToolNames;
      const effectiveNames = visibleNames
        ? authorizedNames.filter((name) => visibleNames.includes(name))
        : authorizedNames;
      const effectiveTools = forceFinalResponse
        ? []
        : this.dependencies.registry.listAllowed(
            effectiveNames,
          );
      const turn = await this.runModelTurn(
        state,
        context,
        stepIndex,
        effectiveTools,
        forceFinalResponse,
        completionContinuation,
      );
      const exposedToolNames = new Set(effectiveTools.map((tool) => tool.name));
      if (
        (context.resolveVisibleToolNames || completionContinuation || effectiveTools.length === 0)
        && turn.toolCalls.some((toolCall) => !exposedToolNames.has(toolCall.name))
      ) {
        // 模型只能调用本 turn 实际看到的工具；completion continuation 可能比
        // 原始 task 更窄，不能让 task allowlist 重新放大这一边界。
        throw new AgentRuntimeTerminalError('MODEL_PROTOCOL_ERROR');
      }
      const step = this.recordModelTurn(state, turn, stepIndex);
      await emitAgentEvent(context, {
        type: 'model_turn_completed',
        runId: state.runId,
        stepIndex,
        hasToolCalls: turn.toolCalls.length > 0,
      });
      if (turn.toolCalls.length === 0) {
        markStepCompleted(step, this.dependencies.clock.now());
        await emitStepCompleted(state, step, context);
        if (turn.assistantText.length === 0 && !hasToolProducedUserVisibleOutput(state)) {
          throw new AgentRuntimeTerminalError('MODEL_PROTOCOL_ERROR');
        }
        state.finalText = turn.assistantText;
        const decision = await context.beforeComplete?.({
          runId: state.runId,
          task: state.task,
          history: state.history,
          finalText: state.finalText,
          completionContinuationUsed,
        });
        this.dependencies.budgetGuard.assertNotCancelled(context.signal);
        if (!completionContinuationUsed && decision?.action === 'continue') {
          completionContinuation = validateCompletionContinuation(decision, state.task);
          completionContinuationUsed = true;
          continue;
        }
        throw new AgentRuntimeTerminalError('COMPLETED');
      }

      const batchRejection = completionContinuation
        ? inspectCompletionContinuationBatch(turn.toolCalls)
        : this.dependencies.budgetGuard.inspectToolBatch(state, turn.toolCalls);
      if (batchRejection) {
        await rejectAgentToolBatch(
          this.dependencies,
          state,
          step,
          turn.toolCalls,
          batchRejection,
          context
        );
        if (completionContinuation) {
          completionContinuation.toolCallAvailable = false;
        }
        toolAccessClosed = toolAccessClosed || batchRejection.closeToolAccess;
        markStepCompleted(step, this.dependencies.clock.now());
        await emitStepCompleted(state, step, context);
        continue;
      }

      const batchResult = await executeAgentToolBatch(
        this.dependencies,
        state,
        step,
        turn.toolCalls,
        context
      );
      if (completionContinuation) {
        completionContinuation.toolCallAvailable = false;
      }
      toolAccessClosed = toolAccessClosed || batchResult.closeToolAccess;
      markStepCompleted(step, this.dependencies.clock.now());
      await emitAgentEvent(context, {
        type: 'step_completed',
        runId: state.runId,
        stepIndex: step.stepIndex,
        toolCallCount: step.toolCalls.length,
      });
    }
  }

  private async runModelTurn(
    state: AgentRunState,
    context: AgentRunLoopContext,
    stepIndex: number,
    effectiveTools: readonly AgentToolDescriptor[],
    forceFinalResponse: boolean,
    completionContinuation: {
      instruction: string;
      toolCallAvailable: boolean;
    } | null,
  ): Promise<ModelTurnResult> {
    try {
      const turn = await this.dependencies.operationGuard.runModelTurn(
        context.signal,
        (operationSignal) => this.dependencies.modelGateway.runTurn(
          {
            task: state.task,
            history: state.history,
            tools: effectiveTools,
            toolBudget: {
              remainingToolCalls: completionContinuation
                ? Number(completionContinuation.toolCallAvailable)
                : this.dependencies.budgetGuard.remainingToolCalls(state),
              maxToolCallsPerStep: completionContinuation
                ? 1
                : state.task.maxToolCallsPerStep,
              forceFinalResponse,
            },
            transport: state.task.modelTransport,
            completionContinuationInstruction: completionContinuation?.instruction,
            signal: operationSignal,
          },
          (event) => emitModelEvent(context, state.runId, stepIndex, event)
        )
      );
      if (context.signal.aborted || turn.finishReason === 'cancelled') {
        throw new AgentRuntimeTerminalError(terminalCodeForAgentCancellation(context.signal));
      }
      return turn;
    } catch (error) {
      if (error instanceof AgentRuntimeTerminalError) {
        throw error;
      }
      if (context.signal.aborted) {
        throw new AgentRuntimeTerminalError(terminalCodeForAgentCancellation(context.signal));
      }
      throw new AgentRuntimeTerminalError('MODEL_REQUEST_FAILED');
    }
  }
  private recordModelTurn(
    state: AgentRunState,
    turn: ModelTurnResult,
    stepIndex: number
  ): AgentStepRecord {
    const now = this.dependencies.clock.now();
    appendModelHistory(state, turn.historyItems, now);
    state.stepCount = stepIndex;
    const step: AgentStepRecord = {
      stepIndex,
      modelTurn: turn,
      toolCalls: [],
      startedAt: new Date(now).toISOString(),
      completedAt: null,
    };
    state.steps.push(step);
    return step;
  }
}

/**
 * Runtime 只认工具结果的显式 contract，不解释业务 data。真正的可见输出仍由
 * 对应 owner 在 terminal commit 中投影；普通空回复继续保持协议错误。
 */
function hasToolProducedUserVisibleOutput(state: AgentRunState): boolean {
  return state.steps.some((step) => step.toolCalls.some(({ outcome }) => (
    outcome.status === 'success' && outcome.metadata?.fulfillsUserVisibleOutput === true
  )));
}

function validateCompletionContinuation(
  decision: Extract<AgentBeforeCompleteDecision, { action: 'continue' }>,
  task: AgentTask,
): {
  instruction: string;
  allowedToolNames: readonly string[];
  toolCallAvailable: boolean;
} {
  const instruction = decision.instruction.trim();
  if (!instruction) {
    throw new Error('Agent completion continuation instruction cannot be empty');
  }
  const allowedToolNames = [...new Set(decision.allowedToolNames)];
  if (allowedToolNames.length === 0) {
    throw new Error('Agent completion continuation must expose at least one tool');
  }
  if (allowedToolNames.some((name) => !task.allowedToolNames.includes(name))) {
    throw new Error('Agent completion continuation cannot expand the task tool allowlist');
  }
  return { instruction, allowedToolNames, toolCallAvailable: true };
}

function inspectCompletionContinuationBatch(
  toolCalls: readonly ModelToolCall[],
): import('./AgentRuntimeGuards').AgentToolBatchRejection | null {
  if (toolCalls.length <= 1) return null;
  return {
    code: 'TOOL_BATCH_LIMIT_EXCEEDED',
    modelContent: '完成前的补充阶段最多调用一个工具；本批次未执行。请根据已有上下文直接完成本次 Agent run。',
    closeToolAccess: true,
  };
}

async function emitAgentEvent(
  context: AgentRunLoopContext,
  event: import('./AgentRunEvent').AgentRunEvent
): Promise<void> {
  if (context.eventSink) {
    await context.eventSink(event);
  }
}

async function emitModelEvent(
  context: AgentRunLoopContext,
  runId: string,
  stepIndex: number,
  event: ModelEvent
): Promise<void> {
  if (event.type === 'reasoning_delta' || event.type === 'assistant_text_delta') {
    await emitAgentEvent(context, { ...event, runId, stepIndex });
  }
  if (event.type === 'tool_call_started') {
    await emitAgentEvent(context, { type: 'model_tool_request_started', runId, stepIndex,
      toolCallId: event.toolCallId, toolName: event.toolName });
  }
}

async function emitToolCompleted(
  state: AgentRunState,
  step: AgentStepRecord,
  toolCallId: string,
  toolName: string,
  outcome: AgentToolOutcome,
  context: AgentRunLoopContext
): Promise<void> {
  await emitAgentEvent(context, {
    type: 'tool_call_completed',
    runId: state.runId,
    stepIndex: step.stepIndex,
    toolCallId,
    toolName,
    outcome,
  });
}

async function emitStepCompleted(
  state: AgentRunState,
  step: AgentStepRecord,
  context: AgentRunLoopContext
): Promise<void> {
  await emitAgentEvent(context, {
    type: 'step_completed',
    runId: state.runId,
    stepIndex: step.stepIndex,
    toolCallCount: step.toolCalls.length,
  });
}

function modelContentForOutcome(outcome: AgentToolOutcome): string {
  return outcome.modelContent;
}

async function executeAgentToolBatch(
  dependencies: AgentRunLoopDependencies,
  state: AgentRunState,
  step: AgentStepRecord,
  toolCalls: readonly ModelToolCall[],
  context: AgentRunLoopContext
): Promise<{ closeToolAccess: boolean }> {
  let closeToolAccess = false;
  const batchDeadlineAt = dependencies.clock.now() + AGENT_TOOL_BATCH_TIMEOUT_MS;
  for (const toolCall of toolCalls.slice(step.toolCalls.length)) {
    dependencies.budgetGuard.assertNotCancelled(context.signal);

    await emitAgentEvent(context, {
      type: 'tool_call_proposed',
      runId: state.runId,
      stepIndex: step.stepIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    });
    state.toolCallCount += 1;

    if (closeToolAccess) {
      const outcome: AgentToolOutcome = {
        status: 'error',
        code: 'TOOL_NOT_EXECUTED',
        retryable: false,
        modelContent: `工具阶段已结束，工具 ${toolCall.name} 未执行。`,
      };
      recordToolOutcome(state, step, toolCall, outcome, null, dependencies.clock);
      await emitToolCompleted(state, step, toolCall.id, toolCall.name, outcome, context);
      continue;
    }

    const preparation = dependencies.toolExecutor.prepare(toolCall, state.task);
    if (preparation.status === 'rejected') {
      recordToolOutcome(state, step, toolCall, preparation.outcome, null, dependencies.clock);
      await emitToolCompleted(
        state,
        step,
        toolCall.id,
        toolCall.name,
        preparation.outcome,
        context
      );
      closeToolAccess = closeToolAccess || preparation.closeToolAccess;
      continue;
    }
    await emitAgentEvent(context, {
      type: 'tool_call_started',
      runId: state.runId,
      stepIndex: step.stepIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    });
    const toolStartedAt = dependencies.clock.now();
    let outcome: AgentToolOutcome;
    try {
      outcome = await dependencies.operationGuard.runToolExecution(
        context.signal,
        batchDeadlineAt,
        (operationSignal) => dependencies.toolExecutor.execute(preparation, {
          runId: state.runId,
          task: state.task,
          toolCallId: toolCall.id,
          abortSignal: operationSignal,
        })
      );
    } catch (error) {
      if (!(error instanceof AgentToolExecutionTimeoutError)) {
        throw error;
      }
      outcome = {
        status: 'error',
        code: 'TOOL_EXECUTION_TIMEOUT',
        retryable: false,
        modelContent: `工具 ${toolCall.name} 运行超时，结果未知，请勿自动重试。`,
      };
      recordToolOutcome(state, step, toolCall, outcome, toolStartedAt, dependencies.clock);
      await emitToolCompleted(state, step, toolCall.id, toolCall.name, outcome, context);
      closeToolAccess = true;
      continue;
    }
    recordToolOutcome(state, step, toolCall, outcome, toolStartedAt, dependencies.clock);
    await emitToolCompleted(state, step, toolCall.id, toolCall.name, outcome, context);
    dependencies.budgetGuard.assertNotCancelled(context.signal);
  }
  return { closeToolAccess };
}

async function rejectAgentToolBatch(
  dependencies: AgentRunLoopDependencies,
  state: AgentRunState,
  step: AgentStepRecord,
  toolCalls: readonly ModelToolCall[],
  rejection: import('./AgentRuntimeGuards').AgentToolBatchRejection,
  context: AgentRunLoopContext
): Promise<void> {
  for (const toolCall of toolCalls) {
    await emitAgentEvent(context, {
      type: 'tool_call_proposed',
      runId: state.runId,
      stepIndex: step.stepIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    });
    const outcome: AgentToolOutcome = {
      status: 'error',
      code: rejection.code,
      retryable: !rejection.closeToolAccess,
      modelContent: rejection.modelContent,
    };
    recordToolOutcome(state, step, toolCall, outcome, null, dependencies.clock);
    await emitToolCompleted(state, step, toolCall.id, toolCall.name, outcome, context);
  }
}

function recordToolOutcome(
  state: AgentRunState,
  step: AgentStepRecord,
  toolCall: ModelToolCall,
  outcome: AgentToolOutcome,
  startedAt: number | null,
  clock: AgentClock
): void {
  appendToolResultHistory(state, toolCall, modelContentForOutcome(outcome), clock.now());
  const completedAt = clock.now();
  step.toolCalls.push({
    toolCall,
    outcome,
    startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
  });
}
