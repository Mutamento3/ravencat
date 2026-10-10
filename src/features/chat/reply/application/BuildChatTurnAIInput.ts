/**
 * @fileoverview 按游标区间的回合输入组装（Phase 5A 方案 §8 / 16.7）。
 *
 * 从 repository 按 run 行固定区间 (replyCursorAtClaim, inputHighWatermark]
 * 读取用户消息，保留真实 role 与顺序逐条进入模型上下文（turnInputMessages）。
 * 附件摘要 / 引用 / fallback 文本沿用单条消息组装；模型请求保持逐条
 * 真实 role 与时间顺序，不合并相邻同角色消息。
 */

import type { ChatMessage } from '../../messages/domain/ChatMessage';
import type { IMessageRepository } from '../../messages/domain/MessageRepository';
import { buildChatUserMessageModelInput } from './BuildChatBatchAIInput';
import type { ChatContextMessage } from './ChatReplyTypes';

export interface ChatTurnAIInput {
  /** 区间内的用户消息（id 升序）。 */
  userMessages: ChatMessage[];
  /** 逐条展示文本的联接，供 prompt 组装与审计字段使用。 */
  displayText: string;
  /** 逐条 { role: 'user', content } 序列，真实 role 与顺序。 */
  turnInputMessages: ChatContextMessage[];
}

export async function buildChatTurnAIInput(params: {
  repository: IMessageRepository;
  sessionId: string;
  replyCursorAtClaim: number;
  inputHighWatermark: number;
  assistantId: string;
  agentId?: string;
}): Promise<ChatTurnAIInput> {
  const userMessages = await params.repository.listUserMessagesInRange(
    params.sessionId,
    params.replyCursorAtClaim,
    params.inputHighWatermark,
  );

  const displayLines: string[] = [];
  const turnInputMessages: ChatContextMessage[] = [];
  for (const message of userMessages) {
    const input = await buildChatUserMessageModelInput(message, params.assistantId, params.agentId);
    if (input.displayText) {
      displayLines.push(input.displayText);
    }
    turnInputMessages.push({ role: 'user', content: input.modelInput });
  }

  return {
    userMessages,
    displayText: displayLines.join('\n').trim(),
    turnInputMessages,
  };
}
