/** 通话上下文事实由 Calls 提供，统一时间线与摘要进度由 Chat 拥有。 */
import type { CallDirection, CallMediaMode, CallState, CallEndReason } from './CallSession';

export interface CallSummaryTranscript {
  eventId: string;
  timestamp: string;
  speaker: 'user' | 'assistant' | 'application';
  content: string;
}

export interface CallSummarySource {
  info: CallContextInfo;
  historyStartsAfter: string | null;
  transcripts: CallSummaryTranscript[];
}

export interface CallContextInfo {
  callId: string;
  mediaMode: CallMediaMode;
  direction: CallDirection;
  state: CallState;
  startedAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
  endReason: CallEndReason | null;
  durationSeconds: number | null;
}
