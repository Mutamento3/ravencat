/** 构建 Chat 回复运行能力与消息元数据，保持触发、记忆、工具和群聊上下文一致。 */
import type { AIReplyConfig, AIReplyRuntimeContext } from './ChatReplyTypes';
import type {
  ToolStatusMessageMetadata,
  ToolStatusMessageStatus,
} from '@features/chat/messages/domain';
import { canUseToolsInRuntimeContext } from './ReplyPolicy';

export function deriveRuntimeCapabilities(
  aiConfig: AIReplyConfig,
  runtimeContext: AIReplyRuntimeContext
): string[] {
  const capabilities = ['chat.reply'];
  // 主题树召回已是唯一运行模式：read_write 会话同时具备记忆读写与召回能力。
  if (runtimeContext.memoryParticipation === 'read_write') {
    capabilities.push('memory.read_write', 'memory.recall');
  }
  if (canUseToolsInRuntimeContext(aiConfig, runtimeContext)) capabilities.push('tool.call');
  if (shouldExposeStreamingCapability(aiConfig, runtimeContext)) capabilities.push('chat.streaming');
  if (
    canUseToolsInRuntimeContext(aiConfig, runtimeContext)
    && shouldExposeStreamingCapability(aiConfig, runtimeContext)
  ) {
    capabilities.push('chat.streaming_tools');
  }
  if (aiConfig.isHostAI) capabilities.push('host.manage');
  return capabilities;
}

export function buildMessageMetadata(
  aiConfig: AIReplyConfig | undefined,
  runtimeContext: AIReplyRuntimeContext,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    actorAgentId: aiConfig?.agentId || null,
    actorAIId: aiConfig?.id || null,
    actorName: aiConfig?.name || null,
    correlationId: runtimeContext.correlationId || runtimeContext.replyRunId || null,
    replyRunId: runtimeContext.replyRunId || null,
    triggerSource: runtimeContext.triggerSource || 'chat',
    triggerReason: runtimeContext.triggerReason || 'user_message',
    relatedEntityType: runtimeContext.relatedEntityType || null,
    relatedEntityId: runtimeContext.relatedEntityId || null,
    batchSeq: runtimeContext.batchSeq || null,
    batchedUserMessageIds: runtimeContext.batchedUserMessageIds || null,
    batchedUserMessageCount: runtimeContext.batchedUserMessageCount || null,
    memoryParticipation: runtimeContext.memoryParticipation || 'off',
    capabilities: runtimeContext.capabilities || (aiConfig ? deriveRuntimeCapabilities(aiConfig, runtimeContext) : ['chat.reply']),
    ...(runtimeContext.groupChat ? {
      groupChat: {
        groupId: runtimeContext.groupChat.groupId,
        groupName: runtimeContext.groupChat.groupName,
        planId: runtimeContext.groupChat.planId || null,
        taskId: runtimeContext.groupChat.taskId || null,
        taskSource: runtimeContext.groupChat.taskSource || null,
        sequenceOrder: runtimeContext.groupChat.sequenceOrder ?? null,
        mentions: runtimeContext.groupChat.mentions || [],
      },
    } : {}),
    ...extra,
  };
}

export function buildChatToolStatusMessageMetadata(params: {
  aiConfig: AIReplyConfig;
  runtimeContext: AIReplyRuntimeContext;
  status: ToolStatusMessageStatus;
  toolNames: string[];
  toolDisplayNames: string[];
  displayText: string;
}): Record<string, unknown> & ToolStatusMessageMetadata {
  return buildMessageMetadata(params.aiConfig, params.runtimeContext, {
    kind: 'tool_status',
    type: 'toolStatus',
    status: params.status,
    toolNames: params.toolNames,
    displayNames: params.toolDisplayNames,
    displayText: params.displayText,
    source: 'chatToolFlow',
  }) as Record<string, unknown> & ToolStatusMessageMetadata;
}

function shouldExposeStreamingCapability(
  aiConfig: AIReplyConfig,
  runtimeContext: AIReplyRuntimeContext
): boolean {
  return Boolean(
    (aiConfig.enableStreamingReply || runtimeContext.capabilities?.includes('chat.streaming')) &&
    (runtimeContext.triggerSource || 'chat') === 'chat' &&
    !runtimeContext.groupChat
  );
}
