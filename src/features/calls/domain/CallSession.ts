export type CallState =
  | 'requested'
  | 'ringing'
  | 'dialing'
  | 'connecting'
  | 'active'
  | 'ending'
  | 'ended'
  | 'missed'
  | 'rejected'
  | 'failed';

export type CallDirection = 'incoming' | 'outgoing';

export type CallMediaMode = 'voice' | 'video';

export type CallEndReason =
  | 'userEnded'
  | 'aiEnded'
  | 'aiRejected'
  | 'userRejected'
  | 'missedByUser'
  | 'missedByAI'
  | 'busy'
  | 'blocked'
  | 'permissionDenied'
  | 'preflightFailed'
  | 'runtimeError'
  | 'unknown';

export type CallSource = 'user' | 'aiTool' | 'backgroundWake' | 'system';

export interface CallSession {
  id: string;
  chatSessionId: string;
  aiAssistantId: string;
  agentId: string;
  direction: CallDirection;
  state: CallState;
  requestedMode: CallMediaMode;
  activeMode: CallMediaMode;
  source: CallSource;
  sourceToolCallId: string | null;
  openingLine: string | null;
  reason: string | null;
  aiRejectionReason: string | null;
  startedAt: string | null;
  acceptedAt: string | null;
  endedAt: string | null;
  endReason: CallEndReason | null;
  createdAt: string;
  updatedAt: string;
}
