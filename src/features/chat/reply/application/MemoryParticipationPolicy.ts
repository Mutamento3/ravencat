/** 单聊与群聊按稳定用户输入开放既有记忆工具；读写始终属于当前AI自己的记忆池。 */

import type { MemoryParticipationMode } from '@shared/prompt';
import type { AIReplyRuntimeContext } from './ChatReplyTypes';

export function resolveMemoryParticipationMode(
  runtimeContext: AIReplyRuntimeContext,
  userMessageId: number
): MemoryParticipationMode {
  const triggerSource = runtimeContext.triggerSource || 'chat';
  const triggerReason = runtimeContext.triggerReason || 'user_message';
  const isUserChatTrigger = triggerReason === 'user_message';
  if (triggerSource === 'group_chat' && runtimeContext.groupChat && Number.isInteger(userMessageId) && userMessageId > 0) return 'read_write';
  return triggerSource === 'chat'
    && isUserChatTrigger
    && !runtimeContext.groupChat
    && Number.isInteger(userMessageId)
    && userMessageId > 0
    ? 'read_write'
    : 'off';
}
