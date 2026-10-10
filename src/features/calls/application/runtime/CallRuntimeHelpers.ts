/** 通话运行时使用的无状态格式化与标识工具。 */

import type {
  CallEndReason,
  CallSession,
  CallState,
} from '../../domain/CallSession';

const ACTIVE_CALL_STATES = new Set<CallState>([
  'requested',
  'ringing',
  'dialing',
  'connecting',
  'active',
  'ending',
]);

export function createCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function computeCallDurationSeconds(call: CallSession | null): number {
  if (!call) {
    return 0;
  }

  const startTime = new Date(call.acceptedAt || call.startedAt || call.createdAt).getTime();
  const endTime = new Date(call.endedAt || new Date().toISOString()).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return 0;
  }
  return Math.max(0, Math.floor((endTime - startTime) / 1000));
}

export function shouldPollCall(call: CallSession | null): boolean {
  return Boolean(call && ACTIVE_CALL_STATES.has(call.state));
}

export function isCallTerminalState(state: CallState): boolean {
  return !ACTIVE_CALL_STATES.has(state);
}

export function resolveUserHangUpReason(
  call: Pick<CallSession, 'direction' | 'state'>
): CallEndReason {
  return call.direction === 'incoming' && call.state === 'ringing'
    ? 'userRejected'
    : 'userEnded';
}
