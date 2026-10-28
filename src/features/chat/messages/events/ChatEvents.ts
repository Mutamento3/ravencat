/** 提供聊天消息更新、删除、重载与输入状态事件总线契约及发布工具。 */
export type ChatEventName =
  | 'messagesUpdated'
  | 'messagesPatched'
  | 'messagesDeleted'
  | 'messagesReloadRequested'
  | 'typingStatusChanged'
  | 'regenerationChanged'
  | 'groupSpeechPlanChanged'
  | 'turnExecutionChanged';

export interface ChatEventBusPayload {
  sessionId: string;
  isTyping?: boolean;
  typingCorrelationId?: string;
  activeTypingCount?: number;
  updatedMessageIds?: number[];
  deletedMessageIds?: readonly number[];
  /** 清除全部历史后重建窗口；普通事实重读不改变分页生命周期。 */
  resetHistory?: boolean;
  regenerationError?: string;
}

export interface ChatMessagesPatchedPayload {
  sessionId: string;
  updatedMessageIds: number[];
}

export interface ChatEventBus {
  emit: (
    eventName: ChatEventName,
    payload: ChatEventBusPayload
  ) => void | Promise<void>;
}

const chatEventBuses = new Set<ChatEventBus>();
const activeTypingCorrelations = new Map<string, Set<string>>();

/** 只刷新运行事实，不触发整页消息重载或执行重试。 */
export function emitChatTurnExecutionChanged(sessionId: string): void {
  for (const bus of chatEventBuses) Promise.resolve(bus.emit('turnExecutionChanged', { sessionId }))
    .catch(error => console.error('[ChatEvents] 执行状态刷新失败', error));
}

export function emitChatRegenerationChanged(sessionId: string, regenerationError?: string): void {
  for (const eventBus of chatEventBuses) {
    Promise.resolve(eventBus.emit('regenerationChanged', { sessionId, regenerationError })).catch(
      (error) => console.error('[ChatEvents] 重写状态投影失败', error),
    );
  }
}

export function setChatEventBus(eventBus: ChatEventBus): () => void {
  chatEventBuses.add(eventBus);

  return () => {
    chatEventBuses.delete(eventBus);
  };
}

export function emitChatMessagesUpdated(sessionId: string): void {
  for (const eventBus of Array.from(chatEventBuses)) {
    Promise.resolve(eventBus.emit('messagesUpdated', { sessionId })).catch(
      (error) => {
        console.error('[ChatEvents] Failed to emit messagesUpdated:', error);
      }
    );
  }
}

export function emitChatMessagesPatched(payload: ChatMessagesPatchedPayload): void {
  const normalizedMessageIds = Array.from(
    new Set(
      (payload.updatedMessageIds || []).filter(
        (messageId) => Number.isInteger(messageId) && messageId > 0
      )
    )
  );

  if (!payload.sessionId || normalizedMessageIds.length === 0) {
    return;
  }

  for (const eventBus of Array.from(chatEventBuses)) {
    Promise.resolve(
      eventBus.emit('messagesPatched', {
        sessionId: payload.sessionId,
        updatedMessageIds: normalizedMessageIds,
      })
    ).catch(
      (error) => {
        console.error('[ChatEvents] Failed to emit messagesPatched:', error);
      }
    );
  }
}

export function emitChatMessagesReloadRequested(sessionId: string, resetHistory = false): void {
  if (!sessionId) {
    return;
  }

  for (const eventBus of Array.from(chatEventBuses)) {
    Promise.resolve(eventBus.emit('messagesReloadRequested', { sessionId, ...(resetHistory ? { resetHistory: true } : {}) })).catch(
      (error) => {
        console.error('[ChatEvents] Failed to emit messagesReloadRequested:', error);
      }
    );
  }
}

/** 删除事实来自已提交事务；消费者只移除这些身份，不重置已加载的历史窗口。 */
export function emitChatMessagesDeleted(sessionId: string, deletedMessageIds: readonly number[]): void {
  for (const eventBus of chatEventBuses) {
    Promise.resolve(eventBus.emit('messagesDeleted', { sessionId, deletedMessageIds })).catch(
      (error) => console.error('[ChatEvents] 发布消息删除失败', error),
    );
  }
}

export function emitChatTypingStatusChanged(
  sessionId: string,
  isTyping: boolean,
  correlationId = 'legacy',
): void {
  const normalizedCorrelationId = correlationId.trim() || 'legacy';
  const correlations = activeTypingCorrelations.get(sessionId) ?? new Set<string>();
  if (isTyping) {
    correlations.add(normalizedCorrelationId);
    activeTypingCorrelations.set(sessionId, correlations);
  } else {
    correlations.delete(normalizedCorrelationId);
    if (correlations.size === 0) {
      activeTypingCorrelations.delete(sessionId);
    }
  }
  const activeTypingCount = correlations.size;
  for (const eventBus of Array.from(chatEventBuses)) {
    Promise.resolve(eventBus.emit('typingStatusChanged', {
      sessionId,
      isTyping: activeTypingCount > 0,
      typingCorrelationId: normalizedCorrelationId,
      activeTypingCount,
    })).catch(
      (error) => {
        console.error('[ChatEvents] Failed to emit typingStatusChanged:', error);
      }
    );
  }
}

/**
 * 发布群发言 plan 持久事实发生变化。事件不携带 plan 快照，consumer 收到后
 * 从 Group query 重读，避免事件 payload 发展成第二份业务状态。
 */
export function emitChatGroupSpeechPlanChanged(groupId: string): void {
  if (!groupId) {
    return;
  }

  for (const eventBus of Array.from(chatEventBuses)) {
    Promise.resolve(eventBus.emit('groupSpeechPlanChanged', { sessionId: groupId })).catch(
      (error) => {
        console.error('[ChatEvents] Failed to emit groupSpeechPlanChanged:', error);
      }
    );
  }
}

export function getActiveChatTypingCount(sessionId: string): number {
  return activeTypingCorrelations.get(sessionId)?.size ?? 0;
}
