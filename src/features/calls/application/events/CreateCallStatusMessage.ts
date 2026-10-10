/** Calls 状态消息写入：通过 Chat 窄 command 原子 upsert，不持有消息仓储。 */

import type { ChatMessage, CallStatusMessageKind } from '@features/chat';
import type { CallDirection, CallEndReason } from '../../domain/CallSession';
import type { CallChatWritePort } from '../runtime/CallRuntimeDependencies';

export interface SaveCallStatusMessageParams {
  sessionId: string;
  callId: string;
  direction: CallDirection;
  callStatus: CallStatusMessageKind;
  actor?: 'user' | 'ai' | 'system';
  agentId?: string | null;
  endReason?: CallEndReason | null;
  durationSeconds?: number | null;
  displayText?: string | null;
  aiContextText?: string | null;
  createdAt?: string | Date;
  /** 用户是否真实参与/看到该通话状态；由 Calls 调用点显式决定。 */
  isRead: boolean;
}

export async function saveCallStatusMessage(
  chat: CallChatWritePort,
  params: SaveCallStatusMessageParams,
): Promise<ChatMessage> {
  const result = await chat.upsertCallTimelineEntry({
    sessionId: params.sessionId,
    callId: params.callId,
    direction: params.direction,
    callStatus: params.callStatus,
    actor: params.actor,
    agentId: params.agentId ?? null,
    endReason: params.endReason ?? null,
    durationSeconds: params.durationSeconds ?? null,
    displayText: params.displayText ?? null,
    aiContextText: params.aiContextText ?? null,
    createdAt: params.createdAt,
    isRead: params.isRead,
  });

  return result.message;
}
