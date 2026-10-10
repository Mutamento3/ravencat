/** 定义 Agent run 状态、step 记录和运行终止结果。 */
import type {
  AgentTask,
  AgentToolExecutionResult,
} from '@shared/aiTools';
import type {
  ModelHistoryItem,
  ModelToolCall,
  ModelTurnResult,
} from '@platform/ai';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentTerminalCode =
  | 'COMPLETED'
  | 'CANCELLED_BY_USER'
  | 'SUPERSEDED'
  | 'MODEL_PROTOCOL_ERROR'
  | 'MODEL_REQUEST_FAILED'
  | 'RUNTIME_UNAVAILABLE';

export type AgentToolOutcome = AgentToolExecutionResult<unknown>;

export interface AgentToolCallRecord {
  toolCall: ModelToolCall;
  outcome: AgentToolOutcome;
  startedAt: string | null;
  completedAt: string;
}

export interface AgentStepRecord {
  stepIndex: number;
  modelTurn: ModelTurnResult;
  toolCalls: AgentToolCallRecord[];
  startedAt: string;
  completedAt: string | null;
}

export interface AgentRunState {
  runId: string;
  task: AgentTask;
  status: AgentRunStatus;
  history: ModelHistoryItem[];
  steps: AgentStepRecord[];
  stepCount: number;
  toolCallCount: number;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  terminalCode: AgentTerminalCode | null;
  finalText: string;
}

interface AgentRunResultBase {
  runId: string;
  taskId: string;
  finalText: string;
  history: readonly ModelHistoryItem[];
  steps: readonly AgentStepRecord[];
  stepCount: number;
  toolCallCount: number;
}

export interface AgentRunTerminalResult extends AgentRunResultBase {
  status: Extract<AgentRunStatus, 'completed' | 'failed' | 'cancelled'>;
  terminalCode: AgentTerminalCode;
}

export type AgentRunResult = AgentRunTerminalResult;

export class AgentRuntimeTerminalError extends Error {
  readonly code: AgentTerminalCode;

  constructor(code: AgentTerminalCode) {
    super(code);
    this.name = 'AgentRuntimeTerminalError';
    this.code = code;
  }
}

export function terminalCodeForAgentCancellation(
  signal: AbortSignal
): Extract<AgentTerminalCode, 'CANCELLED_BY_USER' | 'SUPERSEDED'> {
  return signal.reason === 'SUPERSEDED' ? 'SUPERSEDED' : 'CANCELLED_BY_USER';
}

export function createInitialAgentRunState(
  runId: string,
  task: AgentTask,
  initialHistory: readonly ModelHistoryItem[],
  now: number
): AgentRunState {
  return {
    runId,
    task: {
      ...task,
      allowedToolNames: [...task.allowedToolNames],
    },
    status: 'queued',
    history: [...initialHistory],
    steps: [],
    stepCount: 0,
    toolCallCount: 0,
    startedAt: null,
    updatedAt: toIsoString(now),
    completedAt: null,
    terminalCode: null,
    finalText: '',
  };
}

export function markRunRunning(state: AgentRunState, now: number): void {
  if (state.status !== 'queued') {
    throw new Error(`Cannot start Agent run from status ${state.status}`);
  }
  const timestamp = toIsoString(now);
  state.status = 'running';
  state.startedAt = timestamp;
  state.updatedAt = timestamp;
}

export function appendModelHistory(
  state: AgentRunState,
  historyItems: readonly ModelHistoryItem[],
  now: number
): void {
  state.history.push(...historyItems);
  state.updatedAt = toIsoString(now);
}

export function appendToolResultHistory(
  state: AgentRunState,
  toolCall: ModelToolCall,
  content: string,
  now: number
): void {
  state.history.push({
    role: 'tool',
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
  });
  state.updatedAt = toIsoString(now);
}

export function markRunTerminal(
  state: AgentRunState,
  code: AgentTerminalCode,
  finalText: string,
  now: number
): void {
  if (
    state.status !== 'queued'
    && state.status !== 'running'
  ) {
    throw new Error(`Cannot complete Agent run from status ${state.status}`);
  }
  const timestamp = toIsoString(now);
  state.status = statusForTerminalCode(code);
  state.terminalCode = code;
  state.finalText = finalText;
  state.completedAt = timestamp;
  state.updatedAt = timestamp;
}

export function markStepCompleted(step: AgentStepRecord, now: number): void {
  if (step.completedAt !== null) {
    throw new Error(`Agent step ${step.stepIndex} completed more than once`);
  }
  step.completedAt = toIsoString(now);
}

export function toAgentRunResult(state: AgentRunState): AgentRunResult {
  const common: AgentRunResultBase = {
    runId: state.runId,
    taskId: state.task.id,
    finalText: state.finalText,
    history: [...state.history],
    steps: [...state.steps],
    stepCount: state.stepCount,
    toolCallCount: state.toolCallCount,
  };
  if (state.terminalCode === null || !isTerminalStatus(state.status)) {
    throw new Error(`Agent run ${state.runId} returned before reaching a terminal state`);
  }
  return {
    ...common,
    status: state.status,
    terminalCode: state.terminalCode,
  };
}

function isTerminalStatus(
  status: AgentRunStatus
): status is AgentRunTerminalResult['status'] {
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled';
}

function statusForTerminalCode(code: AgentTerminalCode): AgentRunStatus {
  if (code === 'COMPLETED') {
    return 'completed';
  }
  if (code === 'CANCELLED_BY_USER' || code === 'SUPERSEDED') {
    return 'cancelled';
  }
  return 'failed';
}

function toIsoString(timestamp: number): string {
  return new Date(timestamp).toISOString();
}
