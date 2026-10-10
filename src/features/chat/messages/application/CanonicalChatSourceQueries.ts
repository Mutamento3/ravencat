/** Chat 对跨 Feature 提供的 canonical 可见原文解析边界。 */

import {
  isCallStatusMessageMetadata,
  isTogetherListeningMessageMetadata,
  parseMessageMetadata,
  sortChatTimelineMessages,
  type ChatMessage,
} from '../domain';
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';

export interface ResolveCanonicalChatSourceMessagesParams {
  conversationId: string;
  messageIds: string[];
}

export interface CanonicalChatSourceMessage {
  messageId: string;
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export type ResolveCanonicalChatSourceMessagesOutcome =
  | { status: 'resolved'; messages: CanonicalChatSourceMessage[] }
  | { status: 'invalid_source' };

const MAX_CANONICAL_SOURCE_MESSAGES = 12;

/**
 * Chat 一次性拥有会话范围、可见性与 canonical timeline 顺序；consumer 只能
 * 拿到净化后的稳定 DTO，不能自行解释完整消息实体或 metadata。
 */
export async function resolveCanonicalChatSourceMessages(
  params: ResolveCanonicalChatSourceMessagesParams,
): Promise<ResolveCanonicalChatSourceMessagesOutcome> {
  if (
    !params.conversationId.trim()
    || params.messageIds.length === 0
    || params.messageIds.length > MAX_CANONICAL_SOURCE_MESSAGES
    || new Set(params.messageIds).size !== params.messageIds.length
  ) {
    return { status: 'invalid_source' };
  }

  const numericIds = params.messageIds.map(parseCanonicalMessageId);
  if (numericIds.some((id) => id === null)) return { status: 'invalid_source' };
  const messages = await Promise.all(
    numericIds.map((id) => getChatMessageRuntimeDependencies().messages.getMessageById(id!)),
  );
  if (messages.some((message) => (
    !message || !isCanonicalVisibleSource(message, params.conversationId)
  ))) {
    return { status: 'invalid_source' };
  }

  return {
    status: 'resolved',
    messages: sortChatTimelineMessages(messages as ChatMessage[]).map((message) => ({
      messageId: String(message.id),
      conversationId: message.sessionId,
      role: message.senderType === 'user' ? 'user' : 'assistant',
      text: message.text,
      createdAt: message.createdAt,
    })),
  };
}

function parseCanonicalMessageId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isCanonicalVisibleSource(message: ChatMessage, conversationId: string): boolean {
  if (
    message.sessionId !== conversationId
    || (message.senderType !== 'user' && message.senderType !== 'assistant')
    || message.status !== 'sent'
    || message.deliveryStatus === 'cancelled'
    || !message.text.trim()
  ) {
    return false;
  }
  const metadata = parseMessageMetadata(message);
  return !isCallStatusMessageMetadata(metadata)
    && !isTogetherListeningMessageMetadata(metadata);
}
