export type CallParticipantRole =
  | 'user'
  | 'primaryAI'
  | 'sttModel'
  | 'ttsModel'
  | 'ocrModel'
  | 'hostRuntime';

export interface CallParticipant {
  id: string;
  callId: string;
  role: CallParticipantRole;
  aiAssistantId: string | null;
  agentId: string | null;
  displayName: string;
  joinedAt: string | null;
  leftAt: string | null;
}
