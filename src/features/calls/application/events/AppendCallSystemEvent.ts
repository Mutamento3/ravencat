import { publishCallTranscriptFact } from './CallTranscriptFacts';
import type { CallEvent } from '../../domain/CallEvent';
import { getCallRuntimeDependencies } from '../runtime/CallRuntimeDependencies';

export async function appendCallErrorEvent(params: {
  callId: string;
  text: string;
  payload?: Record<string, unknown>;
}): Promise<CallEvent> {
  const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(params.callId);
  if (!call) {
    throw new Error(`Call ${params.callId} not found`);
  }

  const event = await getCallRuntimeDependencies().repositories.calls.appendEvent({
    callId: call.id,
    chatSessionId: call.chatSessionId,
    kind: 'error',
    actorType: 'system',
    text: params.text,
    visibleInChat: false,
    includeInAIContext: true,
    payloadJson: params.payload ? JSON.stringify(params.payload) : null,
  });
  publishCallTranscriptFact(event);
  return event;
}
