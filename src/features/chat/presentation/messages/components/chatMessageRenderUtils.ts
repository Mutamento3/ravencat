/** 计算消息气泡展示状态、附件/Markdown 视图数据及渲染比较结果。 */

import type { ChatAttachment, ChatVoiceMessageMetadata } from '@features/chat/messages/domain';
import type { StickerMessageSnapshot } from '@features/chat/messages/domain/ChatSticker';
import type { ChatMessage, SenderType } from '@features/chat/messages/domain/ChatMessage';
import type { MessageProcessCardState } from '../MessageBubble/messageBubbleTypes';
import type { TogetherListeningActivityCardViewModel } from './togetherListeningCardViewModel';
import {
  areActionGroupsEquivalent,
  type ActionGroupPresentationItem,
} from './chatActionGrouping';

export interface ResolvedMessageAIIdentity {
  aiId?: string | null;
  agentId?: string | null;
  name?: string | null;
  avatar?: unknown;
}

export type BubbleVariant = 'me' | 'ai' | 'reasoning' | 'system';

export interface MessageBubbleRenderState {
  variant: BubbleVariant;
  hasTextContent: boolean;
  hasAttachments: boolean;
  hasSticker: boolean;
  hasVoice: boolean;
  shouldUseMarkdown: boolean;
  isStandaloneAttachmentMessage: boolean;
  isStandaloneStickerMessage: boolean;
  isReasoning: boolean;
  isSystem: boolean;
  isToolStatusMessage: boolean;
}

export interface MessageTranslationBlock {
  text: string;
  sourceLabel: string;
}

export interface RenderedMessageItem {
  msg: ChatMessage;
  /** 非空时，该列表项是 presentation-only 的行动步骤，而不是一条伪造消息。 */
  actionGroup: ActionGroupPresentationItem | null;
  showTimeSeparator: boolean;
  showSpeakerSeparator: boolean;
  timeText: string;
  displayTokensUsed: number;
  bubbleText: string;
  attachments: ChatAttachment[];
  sticker: StickerMessageSnapshot | null;
  voice: ChatVoiceMessageMetadata['voice'] | null;
  resolvedAIIdentity: ResolvedMessageAIIdentity;
  bubbleRenderState: MessageBubbleRenderState;
  translation?: MessageTranslationBlock | null;
  processCard?: MessageProcessCardState | null;
  togetherListeningCard?: TogetherListeningActivityCardViewModel | null;
  /**
   * 该 item 是否是其 run 中最后一个"用户可见 assistant 输出"。
   * Moon Kimi inline actions 与 token footer 都挂在这里。
   */
  isAssistantOutputTail: boolean;
  /**
   * 该 item 是否是其 run 展示投影中的最后一个 item（可能不是 assistant 输出）。
   */
  isRunTail: boolean;
  /** 该 item 所属 presentation run 键；无法确定时为 null。 */
  presentationRunKey: string | null;
  key: string;
}

/** 按实际子树划分回收池；不同消息身份不改变同类视图的复用资格。 */
export function getMessageListItemType(item: RenderedMessageItem): string {
  if (item.togetherListeningCard) return 'together-listening-card';
  const prefix = item.showTimeSeparator ? 'date-separator-' : '';
  if (item.actionGroup) return `${prefix}action-group`;
  if (item.processCard || item.msg.senderType === 'reasoning') return `${prefix}thinking-process`;
  if (item.msg.senderType === 'system') return `${prefix}system-message`;

  const sender = item.msg.isMe ? 'user' : 'assistant';
  const content = item.sticker ? 'sticker'
    : item.voice ? 'voice'
      : item.attachments.length > 0 ? 'attachments'
        : item.bubbleRenderState.shouldUseMarkdown ? 'markdown' : 'text';
  return `${prefix}${sender}-${content}`;
}

const MARKDOWN_SYNTAX_PATTERN = /(^#{1,6}\s)|(^\s*[-*+]\s)|(^\s*\d+\.\s)|(```)|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(\[[^\]]+\]\([^\)]+\))|(^>\s)|(https?:\/\/\S+)/m;

export function getBubbleVariant(isMe: boolean, senderType: SenderType): BubbleVariant {
  if (isMe) {
    return 'me';
  }

  if (senderType === 'reasoning') {
    return 'reasoning';
  }

  if (senderType === 'system') {
    return 'system';
  }

  return 'ai';
}

export function shouldRenderMarkdownText(text: string | null | undefined): boolean {
  const rawText = String(text || '');
  if (!rawText.trim()) {
    return false;
  }

  return MARKDOWN_SYNTAX_PATTERN.test(rawText);
}

export function buildMessageBubbleRenderState(params: {
  text: string;
  isMe: boolean;
  senderType: SenderType;
  replyToText?: string | null;
  hasReplyQuote?: boolean;
  attachments: ChatAttachment[];
  sticker?: StickerMessageSnapshot | null;
  voice?: ChatVoiceMessageMetadata['voice'] | null;
  isToolStatusMessage: boolean;
  isSharedRecord?: boolean;
}): MessageBubbleRenderState {
  const variant = getBubbleVariant(params.isMe, params.senderType);
  const hasTextContent = Boolean(String(params.text || '').trim());
  const hasAttachments = Array.isArray(params.attachments) && params.attachments.length > 0;
  const sticker = params.sticker || null;
  const hasSticker = sticker !== null;
  const hasVoice = params.voice !== null && params.voice !== undefined;
  const isReasoning = params.senderType === 'reasoning';
  const isSystem = params.senderType === 'system';
  const shouldUseMarkdown = !params.isSharedRecord && hasTextContent && shouldRenderMarkdownText(params.text);
  const isStandaloneAttachmentMessage =
    !params.isSharedRecord &&
    !isReasoning &&
    !isSystem &&
    !hasTextContent &&
    params.attachments.length === 1 &&
    !params.hasReplyQuote && !params.replyToText;
  const isStandaloneStickerMessage =
    !isReasoning &&
    !isSystem &&
    !params.hasReplyQuote && !params.replyToText &&
    !hasTextContent &&
    hasSticker;

  return {
    variant,
    hasTextContent,
    hasAttachments,
    hasSticker,
    hasVoice,
    shouldUseMarkdown,
    isStandaloneAttachmentMessage,
    isStandaloneStickerMessage,
    isReasoning,
    isSystem,
    isToolStatusMessage: params.isToolStatusMessage,
  };
}

export function areChatMessagesEquivalent(prevMsg: ChatMessage, nextMsg: ChatMessage) {
  return (
    prevMsg.id === nextMsg.id &&
    prevMsg.sessionId === nextMsg.sessionId &&
    prevMsg.text === nextMsg.text &&
    prevMsg.isMe === nextMsg.isMe &&
    prevMsg.voicePlayedAt === nextMsg.voicePlayedAt &&
    prevMsg.senderType === nextMsg.senderType &&
    prevMsg.agentId === nextMsg.agentId &&
    prevMsg.apiMessageId === nextMsg.apiMessageId &&
    prevMsg.clientMessageId === nextMsg.clientMessageId &&
    prevMsg.time === nextMsg.time &&
    prevMsg.createdAt === nextMsg.createdAt &&
    prevMsg.showTimeSeparatorBefore === nextMsg.showTimeSeparatorBefore &&
    prevMsg.updatedAt === nextMsg.updatedAt &&
    prevMsg.replyToId === nextMsg.replyToId &&
    prevMsg.replyToText === nextMsg.replyToText &&
    prevMsg.logicalMessageId === nextMsg.logicalMessageId &&
    prevMsg.segmentIndex === nextMsg.segmentIndex &&
    prevMsg.segmentTotal === nextMsg.segmentTotal &&
    prevMsg.deliveryStatus === nextMsg.deliveryStatus &&
    prevMsg.status === nextMsg.status &&
    prevMsg.tokensUsed === nextMsg.tokensUsed &&
    prevMsg.promptTokens === nextMsg.promptTokens &&
    prevMsg.completionTokens === nextMsg.completionTokens &&
    prevMsg.metadataJson === nextMsg.metadataJson
  );
}

export function areResolvedAIIdentitiesEquivalent(
  previousIdentity: ResolvedMessageAIIdentity,
  nextIdentity: ResolvedMessageAIIdentity
) {
  return (
    previousIdentity.aiId === nextIdentity.aiId &&
    previousIdentity.agentId === nextIdentity.agentId &&
    previousIdentity.name === nextIdentity.name &&
    previousIdentity.avatar === nextIdentity.avatar
  );
}

export function areMessageBubbleRenderStatesEquivalent(
  previousState: MessageBubbleRenderState,
  nextState: MessageBubbleRenderState
) {
  return (
    previousState.variant === nextState.variant &&
    previousState.hasTextContent === nextState.hasTextContent &&
    previousState.hasAttachments === nextState.hasAttachments &&
    previousState.hasSticker === nextState.hasSticker &&
    previousState.hasVoice === nextState.hasVoice &&
    previousState.shouldUseMarkdown === nextState.shouldUseMarkdown &&
    previousState.isStandaloneAttachmentMessage === nextState.isStandaloneAttachmentMessage &&
    previousState.isStandaloneStickerMessage === nextState.isStandaloneStickerMessage &&
    previousState.isReasoning === nextState.isReasoning &&
    previousState.isSystem === nextState.isSystem &&
    previousState.isToolStatusMessage === nextState.isToolStatusMessage
  );
}

export function areRenderedMessageItemsEquivalent(
  previousItem: RenderedMessageItem,
  nextItem: RenderedMessageItem
) {
  const previousTogetherActions = previousItem.togetherListeningCard?.actions || [];
  const nextTogetherActions = nextItem.togetherListeningCard?.actions || [];
  return (
    areChatMessagesEquivalent(previousItem.msg, nextItem.msg) &&
    areActionGroupsEquivalent(
      previousItem.actionGroup,
      nextItem.actionGroup,
      areChatMessagesEquivalent
    ) &&
    previousItem.showTimeSeparator === nextItem.showTimeSeparator &&
    previousItem.showSpeakerSeparator === nextItem.showSpeakerSeparator &&
    previousItem.timeText === nextItem.timeText &&
    previousItem.displayTokensUsed === nextItem.displayTokensUsed &&
    previousItem.bubbleText === nextItem.bubbleText &&
    previousItem.attachments === nextItem.attachments &&
    previousItem.sticker === nextItem.sticker &&
    previousItem.voice === nextItem.voice &&
    areResolvedAIIdentitiesEquivalent(previousItem.resolvedAIIdentity, nextItem.resolvedAIIdentity) &&
    areMessageBubbleRenderStatesEquivalent(previousItem.bubbleRenderState, nextItem.bubbleRenderState) &&
    previousItem.translation?.text === nextItem.translation?.text &&
    previousItem.translation?.sourceLabel === nextItem.translation?.sourceLabel &&
    previousItem.processCard?.kind === nextItem.processCard?.kind &&
    previousItem.processCard?.title === nextItem.processCard?.title &&
    previousItem.processCard?.status === nextItem.processCard?.status &&
    previousItem.isAssistantOutputTail === nextItem.isAssistantOutputTail &&
    previousItem.isRunTail === nextItem.isRunTail &&
    previousItem.presentationRunKey === nextItem.presentationRunKey &&
    previousItem.togetherListeningCard?.activityId === nextItem.togetherListeningCard?.activityId &&
    previousItem.togetherListeningCard?.phase === nextItem.togetherListeningCard?.phase &&
    previousItem.togetherListeningCard?.body === nextItem.togetherListeningCard?.body &&
    previousItem.togetherListeningCard?.isMe === nextItem.togetherListeningCard?.isMe &&
    previousTogetherActions.length === nextTogetherActions.length &&
    previousTogetherActions.every((action, index) => action === nextTogetherActions[index])
  );
}
