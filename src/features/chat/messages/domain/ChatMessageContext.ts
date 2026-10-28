import type { ChatMessageRecord } from './ChatMessageSearch';

/** 邻近条数按当前生效的可见消息气泡计算，不依赖消息 ID 连续性。 */
export interface ChatMessageContextInput {
  messageId: number;
  before?: number;
  after?: number;
}

export interface ChatMessageContext {
  anchorMessageId: number;
  conversationId: string;
  entries: ChatMessageRecord[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}
