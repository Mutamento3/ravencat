/**
 * 维护每通电话唯一的 AI 回复运行态与回合相位，使挂断能同步失效所有迟到结果。
 *
 * 回合相位（architecture.md 5.5）是 calls runtime 的所有权：
 * generating（模型回复在途）、using_tool（工具执行中）、speaking（TTS 合成或播放中），结束回到 idle。
 * presentation 只能通过订阅读取相位，禁止用局部布尔反推 AI 状态。
 */

export type CallTurnPhase = 'idle' | 'generating' | 'using_tool' | 'speaking';

interface ActiveCallReplyRun {
  runId: string;
  controller: AbortController;
  phase: CallTurnPhase;
}

const activeRuns = new Map<string, ActiveCallReplyRun>();
const phaseListenersByCallId = new Map<string, Set<(phase: CallTurnPhase) => void>>();

export class CallReplyRunCancelledError extends Error {
  constructor(readonly callId: string) {
    super(`Call reply run cancelled: ${callId}`);
    this.name = 'CallReplyRunCancelledError';
  }
}

export function isCallReplyCancellationError(error: unknown): boolean {
  if (error instanceof CallReplyRunCancelledError) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }

  const value = error as { name?: unknown; message?: unknown };
  return value.name === 'AbortError' || /aborted|aborterror/i.test(String(value.message || ''));
}

export function beginCallReplyRun(callId: string): {
  runId: string;
  signal: AbortSignal;
} {
  // 新回合直接取代旧回合：旧 run 只静默作废，不广播 idle，避免相位闪烁。
  const previousRun = activeRuns.get(callId);
  if (previousRun) {
    activeRuns.delete(callId);
    previousRun.controller.abort();
  }

  const controller = new AbortController();
  const runId = `call_reply_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  activeRuns.set(callId, { runId, controller, phase: 'generating' });
  notifyPhaseChange(callId, 'generating');
  return { runId, signal: controller.signal };
}

export function cancelCallReplyRun(callId: string): boolean {
  const activeRun = activeRuns.get(callId);
  if (!activeRun) {
    return false;
  }

  activeRuns.delete(callId);
  activeRun.controller.abort();
  notifyPhaseChange(callId, 'idle');
  return true;
}

export function assertCallReplyRunActive(callId: string, runId: string): void {
  const activeRun = activeRuns.get(callId);
  if (
    !activeRun
    || activeRun.runId !== runId
    || activeRun.controller.signal.aborted
  ) {
    throw new CallReplyRunCancelledError(callId);
  }
}

export function isActiveCallReplyRun(callId: string, runId: string): boolean {
  const activeRun = activeRuns.get(callId);
  return Boolean(
    activeRun
    && activeRun.runId === runId
    && !activeRun.controller.signal.aborted
  );
}

export function setCallReplyRunPhase(callId: string, runId: string, phase: CallTurnPhase): void {
  const activeRun = activeRuns.get(callId);
  // 只允许当前持有回合的 run 改写相位，迟到的旧回合不得覆盖新回合。
  if (!activeRun || activeRun.runId !== runId || activeRun.phase === phase) {
    return;
  }

  activeRun.phase = phase;
  notifyPhaseChange(callId, phase);
}

export function finishCallReplyRun(callId: string, runId: string): void {
  const activeRun = activeRuns.get(callId);
  if (activeRun?.runId === runId) {
    activeRuns.delete(callId);
    notifyPhaseChange(callId, 'idle');
  }
}

export function getCallReplyRunPhase(callId: string): CallTurnPhase {
  return activeRuns.get(callId)?.phase ?? 'idle';
}

export function subscribeCallReplyRunPhase(
  callId: string,
  listener: (phase: CallTurnPhase) => void
): () => void {
  let listeners = phaseListenersByCallId.get(callId);
  if (!listeners) {
    listeners = new Set();
    phaseListenersByCallId.set(callId, listeners);
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      phaseListenersByCallId.delete(callId);
    }
  };
}

function notifyPhaseChange(callId: string, phase: CallTurnPhase): void {
  const listeners = phaseListenersByCallId.get(callId);
  if (!listeners) {
    return;
  }

  for (const listener of [...listeners]) {
    listener(phase);
  }
}
