export type TogetherListeningPhase =
  | 'pending_user_response'
  | 'pending_ai_response'
  | 'active'
  | 'declined_by_user'
  | 'declined_by_ai'
  | 'ended';

export type TogetherListeningInitiator = 'user' | 'ai';

export type TogetherListeningEndReason =
  | 'user_left'
  | 'ai_left'
  | 'media_unavailable'
  | 'host_authority_lost'
  | 'chat_unavailable'
  | 'runtime_reconciliation'
  | 'unknown';

export interface TogetherListeningActivity {
  id: string;
  hostAiId: string;
  chatSessionId: string;
  initiator: TogetherListeningInitiator;
  phase: TogetherListeningPhase;
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
  activatedAtEpochMs: number | null;
  endedAtEpochMs: number | null;
  endReason: TogetherListeningEndReason | null;
}

export const TOGETHER_LISTENING_NON_TERMINAL_PHASES = [
  'pending_user_response',
  'pending_ai_response',
  'active',
] as const satisfies readonly TogetherListeningPhase[];

const NON_TERMINAL_PHASES: ReadonlySet<TogetherListeningPhase> = new Set(
  TOGETHER_LISTENING_NON_TERMINAL_PHASES,
);

export function isTogetherListeningNonTerminalPhase(
  phase: TogetherListeningPhase,
): boolean {
  return NON_TERMINAL_PHASES.has(phase);
}

export function isTogetherListeningTerminalPhase(
  phase: TogetherListeningPhase,
): boolean {
  return !isTogetherListeningNonTerminalPhase(phase);
}

export function createTogetherListeningActivity(input: {
  id: string;
  hostAiId: string;
  chatSessionId: string;
  initiator: TogetherListeningInitiator;
  createdAtEpochMs: number;
}): TogetherListeningActivity {
  return {
    id: input.id,
    hostAiId: input.hostAiId,
    chatSessionId: input.chatSessionId,
    initiator: input.initiator,
    phase: input.initiator === 'user'
      ? 'pending_ai_response'
      : 'pending_user_response',
    createdAtEpochMs: input.createdAtEpochMs,
    updatedAtEpochMs: input.createdAtEpochMs,
    activatedAtEpochMs: null,
    endedAtEpochMs: null,
    endReason: null,
  };
}
