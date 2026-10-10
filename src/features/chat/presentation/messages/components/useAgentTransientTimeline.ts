/**
 * 把 Agent run 的 transient 投影合并到渲染输入。
 *
 * 这是 presentation-only merge：返回值不会回写 useMessageHistoryState，
 * 因而不会污染 sessionTimelineCache、分页 cursor 或 lastMessageId。T3
 * commit 返回的 persisted messages 暂存于 store，直到同一 identity 被 DB
 * reload 读回后再清理，保证 replacement 期间位置与内容连续。
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import { sortChatTimelineMessages } from '@features/chat/messages/domain/ChatTimelineOrdering';
import {
  acknowledgeAgentTransientTimelineCommitted,
  agentTransientTimeline,
  getAgentTransientTimelineRevision,
  getAgentTimelineRenderKey,
  getLiveAgentTimelineRunIds,
  isAgentTransientTimelineMessage,
  type AgentTransientTimelineMessage,
} from '@features/chat/messages/application/AgentTransientTimeline';

export interface UseAgentTransientTimelineResult {
  /** 仅供当前列表渲染的消息；调用方不得将其写入历史状态。 */
  messages: ChatMessage[];
  /**
   * 本 runtime 仍然活跃的 Agent run id。
   *
   * canonical assistant 分段组只有来自这些 run 时，才是「用户停留期间刚产生的
   * 回复」，paced reveal 才有资格接管它的展示节奏。
   */
  liveRunIds: ReadonlySet<string>;
}

export interface MergeTimelineRenderMessagesParams {
  persistedMessages: readonly ChatMessage[];
  transientMessages: readonly ChatMessage[];
  /**
   * 非流式多气泡主题下为 true：assistant 最终正文的展示权归 canonical
   * committed segments + paced reveal。等待正文提交时，同一 run 只展示它之前
   * 的时间线前缀，后续过程不能越过正文，否则 ActionGroup 会先合并再拆开。
   */
  suppressTransientAssistantText?: boolean;
}

export function mergeTimelineRenderMessages({
  persistedMessages,
  transientMessages,
  suppressTransientAssistantText = false,
}: MergeTimelineRenderMessagesParams): ChatMessage[] {
  if (transientMessages.length === 0) {
    return [...persistedMessages];
  }

  const merged = [...persistedMessages];
  for (const transientMessage of transientMessages) {
    const identity = getAgentTimelineRenderKey(transientMessage);
    const existingIndex = merged.findIndex(
      (message) => getAgentTimelineRenderKey(message) === identity
    );
    if (existingIndex >= 0) {
      // 同一 identity 的 committed replacement 覆盖 transient；不依赖正文匹配。
      merged[existingIndex] = transientMessage;
      continue;
    }
    // Agent run 只在当前会话尾部产生展示条目，按 store 的 run/sequence 顺序追加。
    merged.push(transientMessage);
  }
  const orderedMessages = sortChatTimelineMessages(merged);
  if (!suppressTransientAssistantText) {
    return orderedMessages;
  }

  // 先按完整事实排序，再限制每个 run 的可见前缀；用户消息和其他 run 独立展示。
  const blockedRunIds = new Set<string>();
  return orderedMessages.filter((message) => {
    if (
      isAgentTransientTimelineMessage(message)
      && message.transientTimelineKind === 'assistant'
    ) {
      blockedRunIds.add(message.transientTimelineRunId);
    }
    return !message.turnRunId || !blockedRunIds.has(message.turnRunId);
  });
}

export function useAgentTransientTimeline(
  sessionId: string | null | undefined,
  persistedMessages: ChatMessage[],
  options: { suppressTransientAssistantText?: boolean } = {},
): UseAgentTransientTimelineResult {
  const { suppressTransientAssistantText = false } = options;
  const subscribe = useCallback((listener: () => void) => (
    sessionId
      ? agentTransientTimeline.subscribe(sessionId, listener)
      : () => {}
  ), [sessionId]);
  const getRevision = useCallback(
    () => getAgentTransientTimelineRevision(sessionId),
    [sessionId],
  );
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    acknowledgeAgentTransientTimelineCommitted(sessionId, persistedMessages);
  }, [sessionId, persistedMessages, revision]);

  return useMemo(() => {
    // store 的所有变更都会推进 revision；无关的父组件刷新不应创建新 timeline，
    // 否则下游会重新投影全部历史消息。缓存只属于当前渲染，不进入历史 state。
    void revision;
    const transientMessages = agentTransientTimeline.snapshotWithReplacements(sessionId);
    return {
      messages: mergeTimelineRenderMessages({
        persistedMessages,
        transientMessages,
        suppressTransientAssistantText,
      }),
      liveRunIds: getLiveAgentTimelineRunIds(sessionId),
    };
  }, [sessionId, persistedMessages, revision, suppressTransientAssistantText]);
}

export function isAgentTimelineRenderMessage(message: ChatMessage): boolean {
  return isAgentTransientTimelineMessage(message);
}

export type { AgentTransientTimelineMessage };
