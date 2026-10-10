import type { CallSession } from '../../domain/CallSession';
import type { CallEvent } from '../../domain/CallEvent';
import { getCallRuntimeDependencies } from '../runtime/CallRuntimeDependencies';

export function getCallSession(callId: string): Promise<CallSession | null> {
  return getCallRuntimeDependencies().repositories.calls.getSessionById(callId);
}

export function getActiveCall(): Promise<CallSession | null> {
  return getCallRuntimeDependencies().repositories.calls.getActiveSession();
}

export function listCallEvents(params: {
  callId: string;
  limit?: number;
}): Promise<CallEvent[]> {
  return getCallRuntimeDependencies().repositories.calls.listEvents(params);
}
