/** Chat 对 Calls 暴露的窄命令：构造通话状态消息并复用 stateful timeline 基础能力。 */

import { upsertStatefulTimelineEntry } from './UpsertStatefulTimelineEntry';
import { notifyAIMessageObservers } from '../../reply/delivery/AIMessageEvents';
import {
  buildCallStatusMessageMetadata,
  getCallStatusMessageSender,
  type CallStatusMessageKind,
  type ChatCallDirection,
  type ChatCallEndReason,
  type CallStatusMessageMetadata,
} from '../domain/chatMessageMetadata';
import type { ChatMessage, CreateMessageInput } from '../domain/ChatMessage';

export interface UpsertCallTimelineEntryParams {
  sessionId: string;
  callId: string;
  direction: ChatCallDirection;
  callStatus: CallStatusMessageKind;
  actor?: 'user' | 'ai' | 'system';
  agentId?: string | null;
  endReason?: ChatCallEndReason | null;
  durationSeconds?: number | null;
  displayText?: string | null;
  aiContextText?: string | null;
  createdAt?: string | Date;
  /** 通话状态的已读语义必须由 Calls 按用户是否真实参与显式给出。 */
  isRead: boolean;
}

export interface UpsertCallTimelineEntryResult {
  message: ChatMessage;
  inserted: boolean;
}

function formatMessageTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function buildMessage(
  params: UpsertCallTimelineEntryParams,
  metadata: CallStatusMessageMetadata,
  createdDate: Date,
): CreateMessageInput {
  const sender = getCallStatusMessageSender({ direction: params.direction });
  return {
    sessionId: params.sessionId,
    text: metadata.displayText,
    isMe: sender.isMe,
    senderType: sender.senderType,
    agentId: sender.senderType === 'assistant' ? params.agentId || null : null,
    apiMessageId: null,
    clientMessageId: `call-status:${params.callId}`,
    time: formatMessageTime(createdDate),
    createdAt: createdDate.toISOString(),
    updatedAt: createdDate.toISOString(),
    replyToId: null,
    replyToText: null,
    status: 'sent',
    deliveryStatus: 'delivered',
    tokensUsed: 0,
    promptTokens: 0,
    completionTokens: 0,
    metadataJson: JSON.stringify(metadata),
    isRead: params.isRead,
  };
}

export async function upsertCallTimelineEntry(
  params: UpsertCallTimelineEntryParams,
): Promise<UpsertCallTimelineEntryResult> {
  const createdDate = params.createdAt ? new Date(params.createdAt) : new Date();
  const metadata = buildCallStatusMessageMetadata({
    callId: params.callId,
    callStatus: params.callStatus,
    direction: params.direction,
    actor: params.actor,
    endReason: params.endReason,
    durationSeconds: params.durationSeconds,
    displayText: params.displayText,
    aiContextText: params.aiContextText,
  });
  const message = buildMessage(params, metadata, createdDate);
  const committed = await upsertStatefulTimelineEntry({
    message,
    previewText: message.text,
  });

  // 通话状态不触发系统交付，但会更新 session preview：通知 UI 观察者
  // 刷新 AI 会话列表（通话状态条目无 AI 身份，仅携带 session 事实）。
  notifyAIMessageObservers({
    sessionId: params.sessionId,
    agentId: params.agentId ?? null,
    committedMessageId: committed.message.id,
    triggerSource: 'call',
  });

  return committed;
}
