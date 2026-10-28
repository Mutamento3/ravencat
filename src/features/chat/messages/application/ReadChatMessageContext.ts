/** 应用拥有默认读取范围；内部仓储信任工具边界已校验的条数。 */
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import type { ChatMessageContextInput } from '../domain/ChatMessageContext';

export function readConversationMessageContext(conversationId: string, input: ChatMessageContextInput) {
  return getChatMessageRuntimeDependencies().messages.readMessageContextForUser(conversationId, {
    messageId: input.messageId,
    before: input.before ?? 10,
    after: input.after ?? 10,
  });
}

export function readChatMessageContext(assistantId: string, input: ChatMessageContextInput) {
  return getChatMessageRuntimeDependencies().messages.readMessageContextForAssistant(assistantId, {
    messageId: input.messageId,
    before: input.before ?? 3,
    after: input.after ?? 3,
  });
}
