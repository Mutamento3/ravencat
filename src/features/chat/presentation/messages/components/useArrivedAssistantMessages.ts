/** 聊天气泡消费共享到达进度，重新进入页面直接显示已经到达的事实。 */
import { useMemo, useSyncExternalStore } from 'react';
import type { ChatMessage } from '../../../messages/domain/ChatMessage';
import {
  getAssistantMessageArrivalSnapshot,
  subscribeAssistantMessageArrival,
  projectArrivedAssistantMessages,
} from '../../../reply/delivery/AssistantMessageArrival';

export function useArrivedAssistantMessages(messages: readonly ChatMessage[], enabled: boolean): ChatMessage[] {
  const snapshot = useSyncExternalStore(subscribeAssistantMessageArrival, getAssistantMessageArrivalSnapshot);
  return useMemo(
    () => enabled ? projectArrivedAssistantMessages(messages, snapshot.pendingMessageIds) : [...messages],
    [messages, enabled, snapshot.pendingMessageIds],
  );
}
