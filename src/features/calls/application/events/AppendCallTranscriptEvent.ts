import type { CallEvent } from '../../domain/CallEvent';
import { getCallRuntimeDependencies } from '../runtime/CallRuntimeDependencies';
import { publishCallTranscriptFact } from './CallTranscriptFacts';

export async function appendUserSpeechText(params: {
  callId: string;
  text: string;
}): Promise<CallEvent> {
  const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(params.callId);
  if (!call) {
    throw new Error(`Call ${params.callId} not found`);
  }

  const event = await getCallRuntimeDependencies().repositories.calls.appendEvent({
    callId: call.id,
    chatSessionId: call.chatSessionId,
    kind: 'userSpeechText',
    actorType: 'user',
    text: params.text,
    visibleInChat: false,
    includeInAIContext: true,
  });
  publishCallTranscriptFact(event);
  return event;
}

export async function appendAISpeechText(params: {
  callId: string;
  text: string;
}): Promise<CallEvent> {
  const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(params.callId);
  if (!call) {
    throw new Error(`Call ${params.callId} not found`);
  }

  return getCallRuntimeDependencies().repositories.calls.appendEvent({
    callId: call.id,
    chatSessionId: call.chatSessionId,
    kind: 'aiSpeechText',
    actorType: 'ai',
    actorId: call.agentId,
    text: params.text,
    visibleInChat: false,
    includeInAIContext: true,
  });
}
