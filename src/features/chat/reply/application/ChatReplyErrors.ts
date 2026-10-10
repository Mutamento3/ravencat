/** 统一处理 Chat 回复失败通知，并将可见错误消息持久化到会话时间线。 */
import type { ChatMessage } from '../../messages/domain/ChatMessage';
import type { IMessageRepository } from '../../messages/domain/MessageRepository';
import { persistChatMessage } from '../../messages/application/MessagePersistence';
import { formatMessageTime } from './ChatReplyUtils';
import type {
  AIReplyRuntimeContext,
  ProcessAIReplyCallbacks,
} from './ChatReplyTypes';

export function notifyReplyFailed(
  callbacks: ProcessAIReplyCallbacks,
  sessionId: string,
  error: string,
  message: ChatMessage,
  correlationId?: string,
): void {
  callbacks.onReplyFailed?.({
    status: 'failed',
    sessionId,
    correlationId,
    text: message.text,
    previewText: message.text.trim(),
    messageId: message.id,
    error,
  });
}

export async function saveErrorMessage(
  sessionId: string,
  errorMessage: string,
  repo: IMessageRepository,
  notifyUI?: (sessionId: string) => void,
  actor: {
    agentId?: string | null;
    displayName?: string | null;
    runtimeContext?: AIReplyRuntimeContext;
  } = {}
): Promise<ChatMessage> {
  if (actor.runtimeContext?.isRegeneration) throw new Error(errorMessage);
  const now = new Date();
  const timeStr = formatMessageTime(now);
  const createdAt = now.toISOString();
  const agentId = actor.agentId || null;
  const displayName = String(actor.displayName || '').trim();
  const visibleErrorMessage = displayName
    ? `${displayName} 回复失败：${errorMessage}`
    : `${errorMessage}`;

  return persistChatMessage({
    repository: repo,
    message: {
      sessionId,
      text: visibleErrorMessage,
      isMe: false,
      senderType: 'system',
      agentId,
      apiMessageId: null,
      time: timeStr,
      createdAt,
      updatedAt: createdAt,
      replyToId: null,
      replyToText: null,
      status: 'sent',
      tokensUsed: 0,
      promptTokens: 0,
      completionTokens: 0,
      metadataJson: JSON.stringify({
        actorAgentId: agentId,
        actorName: displayName || null,
        kind: 'error',
        triggerSource: actor.runtimeContext?.triggerSource || 'chat',
        triggerReason: actor.runtimeContext?.triggerReason || null,
        relatedEntityType: actor.runtimeContext?.relatedEntityType || null,
        relatedEntityId: actor.runtimeContext?.relatedEntityId || null,
        correlationId:
          actor.runtimeContext?.correlationId
          || actor.runtimeContext?.replyRunId
          || null,
        ...(actor.runtimeContext?.groupChat ? {
          groupChat: {
            groupId: actor.runtimeContext.groupChat.groupId,
            groupName: actor.runtimeContext.groupChat.groupName,
            planId: actor.runtimeContext.groupChat.planId || null,
            taskId: actor.runtimeContext.groupChat.taskId || null,
            taskSource: actor.runtimeContext.groupChat.taskSource || null,
            sequenceOrder: actor.runtimeContext.groupChat.sequenceOrder ?? null,
          },
        } : {}),
      }),
    },
    previewText: displayName ? `${displayName} 回复失败` : '发生错误',
    notifyUI,
  });
}
