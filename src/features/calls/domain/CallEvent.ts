export type CallEventKind =
  | 'stateChanged'
  | 'userSpeechText'
  | 'aiSpeechText'
  | 'snapshotAttached'
  | 'ocrText'
  | 'lookAtUserRequested'
  | 'screenContextCaptured'
  | 'ttsStarted'
  | 'ttsInterrupted'
  | 'ttsEnded'
  | 'systemNotice'
  | 'error';

export type CallEventActorType = 'user' | 'ai' | 'system' | 'model';

export interface CallEvent {
  id: string;
  callId: string;
  chatSessionId: string;
  kind: CallEventKind;
  actorType: CallEventActorType;
  actorId: string | null;
  text: string | null;
  attachmentId: string | null;
  visibleInChat: boolean;
  includeInAIContext: boolean;
  payloadJson: string | null;
  createdAt: string;
}

export type CallAttachmentKind = 'snapshot' | 'sttTextSource';

export interface CallAttachment {
  id: string;
  callId: string;
  eventId: string | null;
  kind: CallAttachmentKind;
  localUri: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  createdAt: string;
}
