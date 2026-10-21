import type { ChatMessage } from '../../messages/domain/ChatMessage';

/** 版本是整轮回复候选，不拥有独立后续对话或工具执行状态。 */
export interface ChatReplyVersion {
  id: string;
  createdAt: string;
  messages: ChatMessage[];
}

export interface ChatReplyVersionHistory {
  currentRunId: string;
  selectedVersionId: string;
  canAdopt: boolean;
  versions: ChatReplyVersion[];
}
