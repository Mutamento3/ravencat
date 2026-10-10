/** 选择单位属于消息语义：用户逐条，AI 按整轮运行；工具步骤不另计条数。 */
import type { ChatMessage } from './ChatMessage';
import { parseMessageMetadata } from './chatMessageMetadata';

export const MAX_CHAT_SELECTION_UNITS = 20;

export interface ChatSelectionUnit {
  key: string;
  anchorMessageId: number;
}

export function getChatSelectionKey(message: ChatMessage): string {
  if (message.senderType === 'user') return `message:${message.id}`;
  const metadata = parseMessageMetadata(message);
  const runId = message.turnRunId || metadata?.replyRunId;
  if (runId) return `run:${runId}`;
  // 无 run 的既有历史分段仍按已保存的逻辑消息身份归并，不按相邻位置猜测。
  if (message.logicalMessageId) return `logical:${message.logicalMessageId}`;
  return `message:${message.id}`;
}

export function canSelectChatMessage(message: ChatMessage): boolean {
  return message.id > 0
    && message.status === 'sent'
    && message.deliveryStatus !== 'cancelled'
    && (message.senderType === 'user' || message.senderType === 'assistant')
    && !parseMessageMetadata(message)?.type;
}

export function toggleChatSelection(
  units: readonly ChatSelectionUnit[],
  unit: ChatSelectionUnit,
): readonly ChatSelectionUnit[] {
  if (units.some((selected) => selected.key === unit.key)) {
    return units.filter((selected) => selected.key !== unit.key);
  }
  return units.length === MAX_CHAT_SELECTION_UNITS ? units : [...units, unit];
}
