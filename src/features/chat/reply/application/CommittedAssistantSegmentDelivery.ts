/** 统一处理 assistant 分段提交后的投影回执与 AI 消息交付事件。 */
import {
  buildSessionPreviewTextFromMessage,
} from '../../messages/domain';
import {
  emitAIMessageReceived,
  resolveAIMessageDeliveryKind,
} from '../delivery/AIMessageEvents';
import type {
  AIMessageDeliveryKind,
  AIMessageReceivedPayload,
} from '../delivery/AIMessageEvents';
import type {
  AIReplyConfig,
  AIReplyProjectionReceipt,
  AIReplyRuntimeContext,
  ProcessAIReplyCallbacks,
} from './ChatReplyTypes';

interface DeliverCommittedAssistantSegmentParams {
  sessionId: string;
  text: string;
  metadataJson?: string | null;
  messageId: number;
  logicalMessageId: string | null;
  segmentIndex: number;
  segmentTotal: number;
  aiConfig?: AIReplyConfig;
  runtimeContext: AIReplyRuntimeContext;
  callbacks: ProcessAIReplyCallbacks;
}

export async function deliverCommittedAssistantSegment({
  sessionId,
  text,
  metadataJson,
  messageId,
  logicalMessageId,
  segmentIndex,
  segmentTotal,
  aiConfig,
  runtimeContext,
  callbacks,
}: DeliverCommittedAssistantSegmentParams): Promise<void> {
  const deliveryText = buildSessionPreviewTextFromMessage({
    text,
    metadataJson,
  });
  let projectionReceipt: AIReplyProjectionReceipt | void;
  try {
    projectionReceipt = await callbacks.onReplySegment?.({
      status: 'segment',
      sessionId,
      correlationId: runtimeContext.correlationId || runtimeContext.replyRunId,
      text: deliveryText,
      previewText: deliveryText,
      logicalMessageId,
      messageId,
      segmentIndex,
      segmentTotal,
    });
  } catch (error) {
    // 投影可能跨越原生边界；失败时仍由统一交付协调器处理系统通知。
    console.warn('[CommittedAssistantSegmentDelivery] 回复投影失败，保留系统通知：', error);
  }

  // 特殊消息正文由 renderer 从 metadata 读取；系统交付始终沿用 Chat 统一预览契约。
  if (
    !aiConfig?.id
    || !aiConfig.name
    || !deliveryText
    || runtimeContext.suppressAIMessageReceivedEvent
  ) {
    return;
  }

  const deliveryPayload: AIMessageReceivedPayload = {
    aiId: aiConfig.id,
    agentId: aiConfig.agentId || null,
    aiName: aiConfig.name,
    aiAvatar: aiConfig.avatar || null,
    sessionId,
    message: deliveryText,
    logicalMessageId,
    segmentIndex,
    segmentTotal,
    committedMessageId: messageId,
    deliveryKind: resolveDeliveryKind(runtimeContext),
    triggerSource: runtimeContext.deliveryTriggerSource
      ?? runtimeContext.triggerSource
      ?? 'chat',
    relatedEntityType: runtimeContext.relatedEntityType || null,
    relatedEntityId: runtimeContext.relatedEntityId || null,
    ...(runtimeContext.notificationScope
      ? { notificationScope: runtimeContext.notificationScope }
      : {}),
    conversationKind: runtimeContext.groupChat ? 'group' : 'direct',
    groupId: runtimeContext.groupChat?.groupId || null,
    groupName: runtimeContext.groupChat?.groupName || null,
    userNotificationHandled: projectionReceipt
      ? projectionReceipt.userNotificationHandled
      : false,
  };
  const deliveryReceipt = await emitAIMessageReceived(deliveryPayload);
  await callbacks.onAIMessageDelivered?.({
    message: deliveryPayload,
    receipt: deliveryReceipt,
  });
}

function resolveDeliveryKind(
  runtimeContext: AIReplyRuntimeContext,
): AIMessageDeliveryKind {
  return runtimeContext.deliveryKind
    || resolveAIMessageDeliveryKind(
      runtimeContext.deliveryTriggerSource ?? runtimeContext.triggerSource,
    );
}
