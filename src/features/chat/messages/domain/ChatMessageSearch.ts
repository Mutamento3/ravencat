/** 原文搜索独立于摘要进度；只返回仍可见的聊天发言。 */
export interface ChatMessageSearchInput {
  conversationId: string;
  keywords: string[];
  from?: string;
  to?: string;
  offset?: number;
}

export interface ChatMessageRecord {
  messageId: number;
  conversationId: string;
  author: { role: 'user' | 'assistant'; name: string; assistantId: string | null };
  text: string;
  createdAt: string;
}

export interface ChatMessageSearchPage {
  entries: ChatMessageRecord[];
  nextOffset: number | null;
}

export class ChatMessageSearchInputError extends Error {}
