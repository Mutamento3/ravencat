/** 同步会话时间线，并消费按 correlation 引用计数后的 typing 事实。 */

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { messageTimeline } from '../../../messages/application/MessageTimeline';
import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import { setChatEventBus } from '../../../messages/events/ChatEvents';

type MessageStateSetter = Dispatch<SetStateAction<ChatMessage[]>>;
type BooleanStateSetter = Dispatch<SetStateAction<boolean>>;
type ValueRef<T> = { current: T };

interface UseChatTimelineSyncParams {
  sessionId?: string | null;
  isTyping: boolean;
  setIsTyping: BooleanStateSetter;
  setMessages: MessageStateSetter;
  lastMessageIdRef: ValueRef<number | null>;
}

export function useChatTimelineSync({
  sessionId,
  isTyping,
  setIsTyping,
  setMessages,
  lastMessageIdRef,
}: UseChatTimelineSyncParams) {
  const isTypingRef = useRef(isTyping);

  useEffect(() => {
    isTypingRef.current = isTyping;
  }, [isTyping]);

  useEffect(() => {
    if (!sessionId) {
      setIsTyping(false);
      return undefined;
    }

    const unsubscribe = messageTimeline.subscribe({
      sessionId,
      getAfterId: () => lastMessageIdRef.current,
      onReplace: (messages) => {
        setMessages(messages);
        lastMessageIdRef.current = messageTimeline.getLastMessageId(messages);
      },
      onAppend: (incomingMessages) => {
        setMessages((previous) => {
          const merged = messageTimeline.mergeMessages(previous, incomingMessages, 'append');
          lastMessageIdRef.current = merged.lastMessageId;
          return merged.changed ? merged.messages : previous;
        });
      },
      onRemove: (messageIds) => {
        const deleted = new Set(messageIds);
        setMessages((previous) => {
          const messages = previous.filter((message) => !deleted.has(message.id));
          lastMessageIdRef.current = messageTimeline.getLastMessageId(messages);
          return messages.length === previous.length ? previous : messages;
        });
      },
      onError: (error) => {
        console.error('[useChatTimelineSync] Failed to sync messages:', error);
      },
      pollIntervalMs: 1000,
      shouldPoll: () => isTypingRef.current,
    });

    return () => {
      setIsTyping(false);
      unsubscribe();
    };
  }, [sessionId, setMessages, lastMessageIdRef, setIsTyping]);

  useEffect(() => {
    if (!sessionId) {
      return undefined;
    }

    return setChatEventBus({
      emit: async (eventName, payload) => {
        if (eventName !== 'typingStatusChanged' || payload.sessionId !== sessionId) {
          return;
        }
        setIsTyping(payload.isTyping === true);
      },
    });
  }, [sessionId, setIsTyping]);
}
