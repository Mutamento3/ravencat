/** 定义不支持多气泡的主题如何合并普通文字分段。 */

import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import { parseMessageMetadata } from '@features/chat/messages/domain';
import type { ChatInteractionProfile } from '@shared/theme';

/** logicalMessageId 归属模型轮次；语音、表情等独立输出不属于文字分段。 */
function isAssistantTextMessage(message: ChatMessage): boolean {
  const metadata = parseMessageMetadata(message);
  return !message.isMe && message.senderType === 'assistant'
    && !metadata?.type && (!metadata?.kind || metadata.kind === 'reply');
}

export function shouldCollapseAssistantSegment(
  message: ChatMessage,
  interactionProfile: ChatInteractionProfile
): boolean {
  return Boolean(
    !interactionProfile.enableAssistantMessageSegmentation &&
    isAssistantTextMessage(message) &&
    message.logicalMessageId
  );
}

export function collapseAssistantSegmentsForPresentation(
  messages: ChatMessage[],
  interactionProfile: ChatInteractionProfile
): ChatMessage[] {
  if (interactionProfile.enableAssistantMessageSegmentation) {
    return messages;
  }

  const segmentGroups = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    if (!shouldCollapseAssistantSegment(message, interactionProfile)) {
      continue;
    }

    const groupKey = getAssistantPresentationGroupKey(message);
    const group = segmentGroups.get(groupKey);
    if (group) {
      group.push(message);
    } else {
      segmentGroups.set(groupKey, [message]);
    }
  }

  if (segmentGroups.size === 0) {
    return messages;
  }

  const renderedGroupKeys = new Set<string>();
  const collapsedMessages: ChatMessage[] = [];

  for (const message of messages) {
    if (!shouldCollapseAssistantSegment(message, interactionProfile)) {
      collapsedMessages.push(message);
      continue;
    }

    const groupKey = getAssistantPresentationGroupKey(message);
    if (renderedGroupKeys.has(groupKey)) {
      continue;
    }

    renderedGroupKeys.add(groupKey);
    const group = segmentGroups.get(groupKey) || [message];
    collapsedMessages.push(mergeAssistantSegmentsForPresentation(group));
  }

  return collapsedMessages;
}

/**
 * 非流式多气泡主题（daylight / night / Liquid 等 default profile）下，assistant
 * 最终正文的展示权归 canonical committed segments + paced reveal：
 *
 * - canonical T3 仍然一次性落库完整事实（不为了 UI 动画退回逐泡独立事务）；
 * - transient assistant 不得先展示完整正文，否则正文会被展示两次；
 * - 真流式主题与 Moon Kimi / Paper Note 不进入这条路径。
 */
export function ownsCanonicalSegmentedAssistantPresentation(
  interactionProfile: ChatInteractionProfile
): boolean {
  return interactionProfile.enableAssistantMessageSegmentation
    && !interactionProfile.preferStreamingReply;
}

export function getAssistantPresentationGroupKey(message: ChatMessage): string {
  const metadata = parseMessageMetadata(message);
  const logicalMessageId = message.logicalMessageId as string;
  const replyStepId = String(metadata?.replyStepId || '').trim();

  return replyStepId
    ? `${replyStepId}:${logicalMessageId}`
    : logicalMessageId;
}

function compareMessageSegments(left: ChatMessage, right: ChatMessage): number {
  const leftSegmentIndex = left.segmentIndex ?? 0;
  const rightSegmentIndex = right.segmentIndex ?? 0;
  if (leftSegmentIndex !== rightSegmentIndex) {
    return leftSegmentIndex - rightSegmentIndex;
  }

  return left.id - right.id;
}

function resolveAggregateStatus(segments: ChatMessage[]): ChatMessage['status'] {
  if (segments.some((segment) => segment.status === 'streaming')) {
    return 'streaming';
  }

  if (segments.some((segment) => segment.status === 'pending')) {
    return 'pending';
  }

  if (segments.some((segment) => segment.status === 'failed')) {
    return 'failed';
  }

  return 'sent';
}

function mergeAssistantSegmentsForPresentation(segments: ChatMessage[]): ChatMessage {
  const orderedSegments = segments.slice().sort(compareMessageSegments);
  const firstSegment = orderedSegments[0];
  const lastSegment = orderedSegments[orderedSegments.length - 1];
  const joinedText = orderedSegments
    .map((segment) => String(segment.text || '').trim())
    .filter(Boolean)
    .join('\n\n');

  return {
    ...firstSegment,
    text: joinedText || firstSegment.text,
    updatedAt: lastSegment.updatedAt || firstSegment.updatedAt,
    status: resolveAggregateStatus(orderedSegments),
    segmentIndex: 0,
    segmentTotal: 1,
    tokensUsed: orderedSegments.reduce((sum, segment) => sum + (segment.tokensUsed || 0), 0),
    promptTokens: orderedSegments.reduce((sum, segment) => sum + (segment.promptTokens || 0), 0),
    completionTokens: orderedSegments.reduce((sum, segment) => sum + (segment.completionTokens || 0), 0),
  };
}
