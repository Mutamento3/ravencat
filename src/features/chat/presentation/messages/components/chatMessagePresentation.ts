/** 定义消息分段、思维链重复项的展示合并与去重规则。 */

import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import { parseMessageMetadata } from '@features/chat/messages/domain';
import type { ChatInteractionProfile } from '@shared/theme';

export function shouldCollapseAssistantSegment(
  message: ChatMessage,
  interactionProfile: ChatInteractionProfile
): boolean {
  return Boolean(
    !interactionProfile.enableAssistantMessageSegmentation &&
    !message.isMe &&
    message.senderType === 'assistant' &&
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

export function hidePersistedReasoningDuplicatesForPresentation(
  messages: ChatMessage[]
): ChatMessage[] {
  const reasoningTextByLogicalMessageId = new Map<string, string>();
  const assistantGroups = new Map<string, ChatMessage[]>();

  for (const message of messages) {
    const logicalMessageId = String(message.logicalMessageId || '').trim();
    if (!logicalMessageId) {
      continue;
    }

    if (message.senderType === 'reasoning') {
      reasoningTextByLogicalMessageId.set(
        logicalMessageId,
        normalizeComparisonText(message.text)
      );
      continue;
    }

    if (!message.isMe && message.senderType === 'assistant') {
      const group = assistantGroups.get(logicalMessageId);
      if (group) {
        group.push(message);
      } else {
        assistantGroups.set(logicalMessageId, [message]);
      }
    }
  }

  const duplicateAssistantMessageIds = new Set<number>();
  for (const [logicalMessageId, assistantMessages] of assistantGroups) {
    const reasoningText = reasoningTextByLogicalMessageId.get(logicalMessageId);
    if (!reasoningText) {
      continue;
    }

    const assistantText = assistantMessages
      .slice()
      .sort(compareMessageSegments)
      .map((message) => normalizeComparisonText(message.text))
      .filter(Boolean)
      .join('\n\n');

    if (assistantText === reasoningText) {
      for (const message of assistantMessages) {
        duplicateAssistantMessageIds.add(message.id);
      }
    }
  }

  if (duplicateAssistantMessageIds.size === 0) {
    return messages;
  }

  return messages.filter((message) => !duplicateAssistantMessageIds.has(message.id));
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

function normalizeComparisonText(text: string): string {
  return String(text || '').replace(/\r\n/g, '\n').trim();
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
