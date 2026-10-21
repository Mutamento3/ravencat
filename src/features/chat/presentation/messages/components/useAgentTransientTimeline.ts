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
  getAssistantMessageArrivalSnapshot,
  projectArrivedAssistantMessages,
  subscribeAssistantMessageArrival,
} from '../../../reply/delivery/AssistantMessageArrival';
import {
  acknowledgeAgentTransientTimelineCommitted,
  agentTransientTimeline,
  getAgentTransientTimelineRevision,
  getAgentTimelineRenderKey,
  getLiveAgentTimelineRunIds,
  getAgentTimelineSourceOrder,
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
}

export function mergeTimelineRenderMessages({
  persistedMessages,
  transientMessages,
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
  // 后续过程独立可见；正文尚未到达时由稳定占位保留分组边界。
  // canonical itemIndex 计入拆分后的全部分段，transient sequence 则按原始事件分配。
  // 只给本次排序建立统一序号，返回原消息，不改写数据库游标或历史 cache。
  const sourceGroups = new Map<string, { message: ChatMessage; sequence: number; segmentIndex: number }[]>();
  for (const message of merged) {
    const source = getAgentTimelineSourceOrder(message);
    if (!source) continue;
    const group = sourceGroups.get(source.runId) ?? [];
    group.push({ message, sequence: source.sequence, segmentIndex: source.segmentIndex });
    sourceGroups.set(source.runId, group);
  }
  const ranks = new Map<ChatMessage, number>();
  for (const group of sourceGroups.values()) group
    .sort((a, b) => a.sequence - b.sequence || a.segmentIndex - b.segmentIndex)
    .forEach((entry, index) => ranks.set(entry.message, index + 1));
  const originals = new Map<ChatMessage, ChatMessage>();
  const orderingInput = merged.map(message => {
    const rank = ranks.get(message);
    if (!rank) return message;
    const ordered = { ...message, turnItemIndex: rank };
    originals.set(ordered, message);
    return ordered;
  });
  return sortChatTimelineMessages(orderingInput).map(message => originals.get(message) ?? message);
}

export function useAgentTransientTimeline(
  sessionId: string | null | undefined,
  persistedMessages: ChatMessage[],
): UseAgentTransientTimelineResult {
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
  const arrival = useSyncExternalStore(subscribeAssistantMessageArrival, getAssistantMessageArrivalSnapshot);
  const timeline = useMemo(() => {
    // store 的所有变更都会推进 revision；无关的父组件刷新不应创建新 timeline，
    // 否则下游会重新投影全部历史消息。缓存只属于当前渲染，不进入历史 state。
    void revision;
    const transientMessages = agentTransientTimeline.snapshotWithReplacements(sessionId);
    // 到达资格与主题无关；切换气泡布局不能提前确认 canonical 并撤掉已交付的运行片段。
    // 两个来源都先投影到达资格。尚被隐藏的 canonical 行不能确认并清掉已展示的运行片段，
    // committed replacement 也不能提前放行尚未到达的后续分段。
    const arrivedPersistedMessages = projectArrivedAssistantMessages(persistedMessages, arrival.pendingMessageIds);
    const arrivedTransientMessages = projectArrivedAssistantMessages(transientMessages, arrival.pendingMessageIds);
    return {
      arrivedPersistedMessages,
      messages: mergeTimelineRenderMessages({
        persistedMessages: arrivedPersistedMessages,
        transientMessages: arrivedTransientMessages,
      }),
      liveRunIds: getLiveAgentTimelineRunIds(sessionId),
    };
  }, [sessionId, persistedMessages, revision, arrival.pendingMessageIds]);

  useEffect(() => {
    if (sessionId) acknowledgeAgentTransientTimelineCommitted(sessionId, timeline.arrivedPersistedMessages);
  }, [sessionId, timeline.arrivedPersistedMessages]);

  return timeline;
}

export function isAgentTimelineRenderMessage(message: ChatMessage): boolean {
  return isAgentTransientTimelineMessage(message);
}

export type { AgentTransientTimelineMessage };
