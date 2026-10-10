import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import {
  isCallOriginatedMessage,
  isCallStatusMessageMetadata,
  parseMessageMetadata,
} from '@features/chat/messages/domain';

const TIME_SEPARATOR_GAP_MS = 10 * 60 * 1000;

export interface MessageListSnapshot {
  keys: readonly string[];
}

export type TailMutation =
  | { type: 'initial' | 'unchanged' | 'replacement-or-reorder'; appendedMessages: readonly ChatMessage[] }
  | { type: 'append'; appendedMessages: readonly ChatMessage[] };

export function resolveBottomFollowState(params: {
  followingBottom: boolean;
  isUserInteracting: boolean;
  isNearBottom: boolean;
}): boolean {
  if (params.isNearBottom) {
    return true;
  }
  return params.isUserInteracting ? false : params.followingBottom;
}

export function shouldShowTimeSeparator(
  message: ChatMessage,
  previousMessage: ChatMessage | null
): boolean {
  if (message.showTimeSeparatorBefore === true) {
    return true;
  }

  if (!previousMessage?.createdAt) {
    return true;
  }

  const previousTimestamp = new Date(previousMessage.createdAt).getTime();
  const currentTimestamp = new Date(message.createdAt).getTime();

  return Boolean(
    Number.isFinite(previousTimestamp)
    && Number.isFinite(currentTimestamp)
    && currentTimestamp - previousTimestamp >= TIME_SEPARATOR_GAP_MS
  );
}

/**
 * 只有旧时间线完整保留为新时间线前缀时才是尾部 append。
 * 等长 identity 替换、transient reconciliation、历史分页和重排都不属于 append。
 */
export function classifyTailMutation(params: {
  previous: MessageListSnapshot;
  messages: readonly ChatMessage[];
  keys: readonly string[];
}): TailMutation {
  const { previous, messages, keys } = params;
  if (previous.keys.length === 0) {
    return { type: 'initial', appendedMessages: [] };
  }
  if (
    keys.length === previous.keys.length
    && keys.every((key, index) => key === previous.keys[index])
  ) {
    return { type: 'unchanged', appendedMessages: [] };
  }
  if (
    keys.length > previous.keys.length
    && previous.keys.every((key, index) => key === keys[index])
  ) {
    return {
      type: 'append',
      appendedMessages: messages.slice(previous.keys.length),
    };
  }
  return { type: 'replacement-or-reorder', appendedMessages: [] };
}

/** Chat 页“新消息”只表达尚未被用户查看的可见 assistant 事件。 */
export function isNewMessagePromptEligible(message: ChatMessage): boolean {
  if (message.isMe || message.senderType === 'user') {
    return false;
  }

  const metadata = parseMessageMetadata(message);
  if (isCallStatusMessageMetadata(metadata)) {
    return metadata.initiator === 'ai'
      && metadata.direction === 'incoming'
      && metadata.callStatus === 'callMissed'
      && metadata.endReason === 'missedByUser';
  }

  if (isCallOriginatedMessage(message)) {
    return false;
  }

  return message.senderType === 'assistant';
}
