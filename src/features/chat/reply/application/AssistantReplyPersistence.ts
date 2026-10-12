/** 负责规范化并持久化已完成的 AI 回复，协调推理文本、分段交付及最终回调。 */
import type { IMessageRepository } from '../../messages/domain/MessageRepository';
import { persistChatMessage } from '../../messages/application/MessagePersistence';
import { deliverAssistantMessage } from './AssistantMessageDelivery';
import {
  assertChatReplyNotAborted,
  isChatReplyActive,
} from './ChatReplyAbort';
import { buildMessageMetadata } from './ChatReplyMetadata';
import { buildLogicalMessageId, formatMessageTime } from './ChatReplyUtils';
import type {
  AIReplyConfig,
  AIReplyRuntimeContext,
  AIResponse,
  ProcessAIReplyCallbacks,
} from './ChatReplyTypes';
import type { AIReplyPolicy } from './ReplyPolicy';
import { segmentAssistantReplyText } from './AssistantReplySegmentation';
import { deliverCommittedAssistantSegment } from './CommittedAssistantSegmentDelivery';

export interface NormalizedAssistantResponse {
  text: string;
  segments: string[];
}

export interface PersistCompletedAssistantReplyParams {
  sessionId: string;
  response: AIResponse;
  /** 本次成功运行中新拆开的包，由正式回复提交 owner 接管。 */
  openedToolPackageIds?: readonly string[];
  repository: IMessageRepository;
  callbacks?: ProcessAIReplyCallbacks;
  aiConfig?: AIReplyConfig;
  runtimeContext?: AIReplyRuntimeContext;
  policy: Pick<AIReplyPolicy, 'bubbleDeliveryMode'>;
}

export async function persistCompletedAssistantReply({
  sessionId,
  response,
  repository,
  callbacks = {},
  aiConfig,
  runtimeContext = {},
  policy,
}: PersistCompletedAssistantReplyParams): Promise<void> {
  assertChatReplyNotAborted(runtimeContext);

  const now = new Date();
  const timeStr = formatMessageTime(now);
  const createdAt = now.toISOString();
  const normalizedResponse = normalizeAssistantResponseText(
    response.text,
    policy,
  );
  const normalizedText = normalizedResponse.text;
  const hasReasoning = Boolean(response.reasoningText?.trim());
  const willSegment = normalizedResponse.segments.length > 1;
  const logicalMessageId = hasReasoning || willSegment
    ? buildLogicalMessageId()
    : null;

  const reasoningText = response.reasoningText?.trim();
  if (reasoningText) {
    await persistChatMessage({
      repository,
      message: {
        sessionId,
        text: reasoningText,
        isMe: false,
        senderType: 'reasoning',
        agentId: aiConfig?.agentId || null,
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
        metadataJson: JSON.stringify(buildMessageMetadata(aiConfig, runtimeContext, { kind: 'reasoning' })),
        logicalMessageId,
      },
      previewText: null,
      notifyUI: callbacks.notifyUI,
    });

    assertChatReplyNotAborted(runtimeContext);
  }

  if (!normalizedText) {
    callbacks.onReplyCommitted?.();
    return;
  }

  const deliveryResult = await deliverAssistantMessage({
    repository,
    message: {
      sessionId,
      text: normalizedText,
      isMe: false,
      senderType: 'assistant',
      agentId: aiConfig?.agentId || null,
      apiMessageId: response.messageId || null,
      time: timeStr,
      createdAt,
      updatedAt: createdAt,
      replyToId: null,
      replyToText: null,
      status: 'sent',
      tokensUsed: response.totalTokens || 0,
      promptTokens: response.promptTokens || 0,
      completionTokens: response.completionTokens || 0,
      metadataJson: JSON.stringify(buildMessageMetadata(aiConfig, runtimeContext, {
        kind: 'reply',
        cachedTokens: response.cachedTokens,
      })),
    },
    segments: normalizedResponse.segments,
    notifyUI: callbacks.notifyUI,
    shouldContinue: () => isChatReplyActive(runtimeContext),
    logicalMessageId,
    deliveryTiming: runtimeContext.deliveryTiming,
    onSegmentDelivered: async ({ logicalMessageId: deliveredLogicalMessageId, segmentIndex, segmentTotal, text, message }) => {
      await deliverCommittedAssistantSegment({
        sessionId,
        text,
        metadataJson: message.metadataJson,
        messageId: message.id,
        logicalMessageId: deliveredLogicalMessageId,
        segmentIndex,
        segmentTotal,
        aiConfig,
        runtimeContext,
        callbacks,
      });

      if (segmentIndex === segmentTotal - 1 && (runtimeContext.triggerSource || 'chat') === 'chat') {
        callbacks.onReplyCommitted?.();
      }
    },
  });

  const deliveryCompletion = await deliveryResult.completion;
  assertChatReplyNotAborted(runtimeContext);

  if (!deliveryCompletion.completed || !deliveryResult.firstMessage) {
    return;
  }

  const joinedText = deliveryCompletion.joinedText || normalizedText.trim();
  const firstSegmentMessageId = deliveryCompletion.firstSegmentMessageId ?? deliveryResult.firstMessage.id;
  const lastSegmentMessageId = deliveryCompletion.lastSegmentMessageId
    ?? deliveryCompletion.lastDeliveredMessageId
    ?? deliveryResult.firstMessage.id;

  callbacks.onFinalReply?.({
    status: 'completed',
    sessionId,
    correlationId: runtimeContext.correlationId || runtimeContext.replyRunId,
    text: normalizedText,
    previewText: joinedText,
    joinedText,
    logicalMessageId: deliveryResult.logicalMessageId,
    firstSegmentMessageId,
    lastSegmentMessageId,
    segmentTotal: deliveryResult.segmentTotal,
    segments: deliveryCompletion.segments,
  });
}

/**
 * 回复归一化：模型输出即纯文本正文，分段完全由代码决定。
 * 不做任何格式校验——没有格式，就不存在格式错误。
 */
export function normalizeAssistantResponseText(
  text: string,
  policy: Pick<AIReplyPolicy, 'bubbleDeliveryMode'>,
): NormalizedAssistantResponse {
  const normalizedText = text.trim();
  return {
    text: normalizedText,
    segments: segmentAssistantReplyText(normalizedText, policy.bubbleDeliveryMode),
  };
}
