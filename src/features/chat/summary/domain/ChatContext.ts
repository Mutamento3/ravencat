/** 同一投影决定摘要与尚未总结原文；对话计数，应用事件随所属范围交接。 */
import type { ChatMessage } from '../../messages/domain/ChatMessage';
import { buildChatSystemEventModelText, buildSessionPreviewTextFromMessage, buildVoiceMessageModelText, getMessageSticker, getMessageSharedRecord, isCallStatusMessageMetadata, isTogetherListeningMessageMetadata, parseMessageMetadata } from '../../messages/domain/chatMessageMetadata';
import { buildStickerModelText } from '../../messages/domain/ChatSticker';
import { buildSharedChatRecordText, type SharedChatRecord } from '../../messages/domain/SharedChatRecord';

export type ChatCanonicalCursor = readonly [string, number, number, number];
export interface ChatContextItem {
  cursor: ChatCanonicalCursor;
  messageId: number;
  kind: 'dialogue' | 'app_event';
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  logicalMessageId: string | null;
  /** 流式原文可进入当轮上下文，但摘要游标不能越过仍会更新的条目。 */
  pending?: true;
  sharedRecord?: SharedChatRecord;
  sharedComment?: string;
}
export function projectChatContextMessage(message: ChatMessage, cursor: ChatCanonicalCursor): ChatContextItem | null {
  const eventText = buildChatSystemEventModelText(message);
  if (eventText) return { cursor, messageId: message.id, kind: 'app_event', role: 'user',
    content: eventText, timestamp: message.createdAt, logicalMessageId: null,
    ...(message.status === 'streaming' ? { pending: true } : {}) };
  if (message.status !== 'sent' || message.deliveryStatus === 'cancelled'
    || (message.senderType !== 'user' && message.senderType !== 'assistant')) return null;
  const metadata = parseMessageMetadata(message);
  if (isCallStatusMessageMetadata(metadata)) return null;
  if (isTogetherListeningMessageMetadata(metadata)
    && !(message.isMe && metadata.phase === 'pending_ai_response')) return null;
  const sticker = getMessageSticker(message);
  const voice = buildVoiceMessageModelText(message);
  const sharedRecord = getMessageSharedRecord(message);
  const text = sharedRecord ? buildSharedChatRecordText(sharedRecord, message.text) : voice || (sticker ? buildStickerModelText(sticker)
    : message.isMe ? buildSessionPreviewTextFromMessage(message) : message.text);
  if (!text.trim()) return null;
  return { cursor, messageId: message.id, kind: 'dialogue', role: message.isMe ? 'user' : 'assistant',
    content: message.replyToText ? '[引用：' + message.replyToText + ']\n' + text.trim() : text.trim(),
    timestamp: message.createdAt, logicalMessageId: message.logicalMessageId ?? null,
    ...(sharedRecord ? { sharedRecord, sharedComment: message.text } : {}) };
}
export function compareChatContextCursor(left: ChatCanonicalCursor, right: ChatCanonicalCursor): number {
  for (let index = 0; index < 4; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}
export function parseChatContextCursor(value: string | null): ChatCanonicalCursor | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length !== 4 || typeof parsed[0] !== 'string'
    || !parsed.slice(1).every((item) => typeof item === 'number' && Number.isFinite(item))) throw new Error('摘要处理游标损坏');
  return parsed as unknown as ChatCanonicalCursor;
}
