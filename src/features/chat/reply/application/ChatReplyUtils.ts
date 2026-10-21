/** 提供 Chat 回复的时间与逻辑消息标识工具，并将运行时输入适配为模型请求消息。 */
import type { ChatContextMessage } from './ChatReplyTypes';
import { renderPromptMessageWithTimestamp } from '@shared/prompt';

export function formatMessageTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function buildLogicalMessageId(): string {
  return `lm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function applyRuntimeModelInput(
  modelMessages: ChatContextMessage[],
  batchModelInput?: ChatContextMessage['content'],
  turnInputMessages?: ChatContextMessage[],
  messageTimestampsEnabled = false,
): ChatContextMessage[] {
  const requestMessages: ChatContextMessage[] = modelMessages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  // 逐条输入序列：替换 prompt pack 末尾的触发用户消息，保留真实 role 与顺序。
  if (turnInputMessages && turnInputMessages.length > 0) {
    const lastIndex = requestMessages.length - 1;
    if (lastIndex >= 0 && requestMessages[lastIndex].role === 'user') {
      requestMessages.splice(lastIndex, 1);
    }
    requestMessages.push(...turnInputMessages.flatMap((message) => renderPromptMessageWithTimestamp(message, messageTimestampsEnabled)));
    return requestMessages;
  }

  if (!batchModelInput || requestMessages.length === 0) {
    return requestMessages;
  }

  const lastIndex = requestMessages.length - 1;
  if (requestMessages[lastIndex].role === 'user') {
    requestMessages[lastIndex] = {
      ...requestMessages[lastIndex],
      content: batchModelInput,
    };
  }

  return requestMessages;
}
