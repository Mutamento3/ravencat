/** 将记忆能力收敛到有稳定用户消息来源的一对一普通聊天。 */

import type { MemoryParticipationMode } from '@shared/prompt';
import type { AIReplyRuntimeContext } from './ChatReplyTypes';

export function resolveMemoryParticipationMode(
  runtimeContext: AIReplyRuntimeContext,
  userMessageId: number
): MemoryParticipationMode {
  const triggerSource = runtimeContext.triggerSource || 'chat';
  const triggerReason = runtimeContext.triggerReason || 'user_message';
  const isUserChatTrigger = triggerReason === 'user_message';
  return triggerSource === 'chat'
    && isUserChatTrigger
    && !runtimeContext.groupChat
    && Number.isInteger(userMessageId)
    && userMessageId > 0
    ? 'read_write'
    : 'off';
}
