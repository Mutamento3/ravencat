/** 管理聊天消息历史的首屏加载、游标分页、缓存复用与时间线合并。 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { messageTimeline } from '../../../messages/application/MessageTimeline';
import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import {
  getSessionTimelineCache,
  setSessionTimelineCache,
  clearSessionTimelineCache,
} from './sessionTimelineCache';
import {
  CHAT_INITIAL_MESSAGE_WINDOW_SIZE,
} from './chatBottomAnchorExperiment';
import {
  CHAT_HISTORY_PAGE_SIZE,
  IDLE_HISTORY_LOAD_OWNERSHIP,
  beginHistoryLoadRequest,
  beginHistorySession,
  finishHistoryLoadRequest,
  isHistoryLoadRequestCurrent,
  resolveNextHistoryHasMore,
  type HistoryLoadOwnership,
  type HistoryLoadRequestOwner,
} from './chatHistoryPagination';

function getInitialSessionHistorySnapshot(sessionId?: string | null) {
  
  const cachedEntry = getSessionTimelineCache(sessionId);

  return {
    cachedEntry,
    messages: cachedEntry?.messages || [],
    hasMore: cachedEntry?.hasMore ?? true,
    nextCursor: cachedEntry?.nextCursor ?? null,
    lastMessageId: cachedEntry?.lastMessageId ?? null,
    isLoading: Boolean(sessionId && !cachedEntry),
  };
}

export function useMessageHistoryState(sessionId?: string | null) {
  const initialSnapshotRef = useRef(getInitialSessionHistorySnapshot(sessionId));
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialSnapshotRef.current.messages);
  const [isLoading, setIsLoading] = useState(initialSnapshotRef.current.isLoading);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialSnapshotRef.current.hasMore);
  const [error, setError] = useState<string | null>(null);
  const [historySessionId, setHistorySessionId] = useState<string | null>(
    sessionId || null
  );

  const cursorRef = useRef<number | null>(initialSnapshotRef.current.nextCursor);
  const lastMessageIdRef = useRef<number | null>(initialSnapshotRef.current.lastMessageId);
  /**
   * loadMore 的请求所有权。
   *
   * 不能用布尔锁：布尔量无法表达「这把锁属于谁」。A 在飞时切到 B，B 会重新持锁，
   * 而 A 的 finally 若无条件 `lock = false`，就会在 B 仍然在飞时把 B 解锁，
   * 让 B 并发启动第二个分页。改成 generation + sessionId + requestId 之后，
   * 旧请求的 finally 只能释放自己那一把锁。
   */
  const loadOwnershipRef = useRef<HistoryLoadOwnership>(IDLE_HISTORY_LOAD_OWNERSHIP);
  const hasInitializedSessionRef = useRef(false);
  const latestMessageCountRef = useRef(initialSnapshotRef.current.messages.length);
  const latestHasMoreRef = useRef(initialSnapshotRef.current.hasMore);

  const resetHistory = useCallback(() => {
    loadOwnershipRef.current = beginHistorySession(loadOwnershipRef.current);
    cursorRef.current = null;
    lastMessageIdRef.current = null;
    latestHasMoreRef.current = false;
    latestMessageCountRef.current = 0;
    hasInitializedSessionRef.current = true;
    clearSessionTimelineCache(sessionId);
    setMessages([]);
    setHasMore(false);
    setIsLoading(false);
    setIsLoadingMore(false);
    setError(null);
  }, [sessionId]);

  const applyCachedResult = useCallback(
    (result: { messages: ChatMessage[]; hasMore: boolean; nextCursor: number | null; lastMessageId: number | null }) => {
      latestMessageCountRef.current = result.messages.length;
      latestHasMoreRef.current = result.hasMore;
      setMessages(result.messages);
      setHasMore(result.hasMore);
      cursorRef.current = result.nextCursor;
      lastMessageIdRef.current = result.lastMessageId;
    },
    []
  );

  const applyInitialResult = useCallback(
    (
      result: { messages: ChatMessage[]; hasMore: boolean; nextCursor: number | null },
      options: { mergeIntoExisting?: boolean } = {}
    ) => {
      const { mergeIntoExisting = false } = options;

      if (mergeIntoExisting) {
        let resolvedMessages: ChatMessage[] = result.messages;
        const previousMessageCount = latestMessageCountRef.current;
        const previousHasMore = latestHasMoreRef.current;

        setMessages((prev) => {
          const mergeResult = messageTimeline.mergeMessages(prev, result.messages, 'append');
          lastMessageIdRef.current = mergeResult.lastMessageId;
          resolvedMessages = mergeResult.changed ? mergeResult.messages : prev;
          return resolvedMessages;
        });

        latestMessageCountRef.current = resolvedMessages.length;

        const nextHasMore = previousMessageCount > result.messages.length
          ? previousHasMore
          : result.hasMore;

        latestHasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
        cursorRef.current = previousMessageCount > result.messages.length
          ? cursorRef.current
          : result.nextCursor;

        return;
      }

      latestMessageCountRef.current = result.messages.length;
      latestHasMoreRef.current = result.hasMore;
      setMessages(result.messages);
      setHasMore(result.hasMore);
      cursorRef.current = result.nextCursor;
      lastMessageIdRef.current = messageTimeline.getLastMessageId(result.messages);
    },
    []
  );

  useEffect(() => {
    latestMessageCountRef.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    latestHasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    // 切 session 第一件事就是把分页所有权推进到新 generation 并丢弃旧 owner：
    // 旧请求在 await 之后再也匹配不上，它的 finally 不会释放新请求的锁；
    // 新 session 也不会被旧请求继续锁住，可以立刻发起自己的分页。
    loadOwnershipRef.current = beginHistorySession(loadOwnershipRef.current);
    // 旧请求的 finally 已经不再拥有所有权，不会再替新 session 清这个状态，
    // 所以必须在这里显式归位，否则新会话会一直显示"加载中"。
    setIsLoadingMore(false);

    if (!sessionId) {
      setHistorySessionId(null);
      setMessages([]);
      setHasMore(true);
      setError(null);
      setIsLoading(false);
      cursorRef.current = null;
      lastMessageIdRef.current = null;
      latestMessageCountRef.current = 0;
      latestHasMoreRef.current = true;
      return;
    }

    let isMounted = true;
    const cachedEntry = getSessionTimelineCache(sessionId);
    setHistorySessionId(sessionId);

    initialSnapshotRef.current = getInitialSessionHistorySnapshot(sessionId);

    if (cachedEntry) {
      applyCachedResult(cachedEntry);
      setError(null);
      setIsLoading(false);
      hasInitializedSessionRef.current = true;
    } else {
      setMessages([]);
      setHasMore(true);
      cursorRef.current = null;
      lastMessageIdRef.current = null;
      latestMessageCountRef.current = 0;
      latestHasMoreRef.current = true;
      hasInitializedSessionRef.current = false;
    }

    async function init() {
      const generation = loadOwnershipRef.current.generation;
      if (!cachedEntry) {
        setIsLoading(true);
      }

      setError(null);

      try {
        const result = await messageTimeline.open({
          sessionId,
          limit: CHAT_INITIAL_MESSAGE_WINDOW_SIZE,
        });

        if (!isMounted || generation !== loadOwnershipRef.current.generation) return;

        if (result.success) {
          applyInitialResult(result);
          hasInitializedSessionRef.current = true;
        } else {
          if (!cachedEntry) {
            setError(result.error || '加载失败');
          }

          hasInitializedSessionRef.current = Boolean(cachedEntry);
        }
      } catch (err) {
        if (!isMounted || generation !== loadOwnershipRef.current.generation) return;

        if (!cachedEntry) {
          setError(err instanceof Error ? err.message : '加载失败');
        }

        hasInitializedSessionRef.current = Boolean(cachedEntry);
      } finally {
        if (isMounted && generation === loadOwnershipRef.current.generation) {
          setIsLoading(false);
        }
      }
    }

    void init();

    return () => {
      isMounted = false;
    };
  }, [sessionId, applyCachedResult, applyInitialResult]);

  useEffect(() => {
    if (!sessionId || historySessionId !== sessionId) {
      return;
    }

    if (!hasInitializedSessionRef.current) {
      return;
    }

    setSessionTimelineCache({
      sessionId,
      messages,
      hasMore,
      nextCursor: cursorRef.current,
      lastMessageId: lastMessageIdRef.current,
    });
  }, [
    sessionId,
    historySessionId,
    messages,
    hasMore,
  ]);

  const loadMore = useCallback(async () => {
    const started = beginHistoryLoadRequest(loadOwnershipRef.current, {
      sessionId,
      // hasMore 优先读 ref：最后一页返回的同一个 tick 就会把 ref 写成 false，
      // 不能等 React 把 state 提交回来，否则排队的空转还能再进来一次。
      hasMore: latestHasMoreRef.current,
      cursor: cursorRef.current,
    });

    if (!started) {
      return false;
    }

    loadOwnershipRef.current = started.ownership;
    const owner: HistoryLoadRequestOwner = started.owner;
    const requestedCursor = started.cursor;

    setIsLoadingMore(true);

    try {
      const result = await messageTimeline.loadOlder({
        sessionId: owner.sessionId,
        cursor: requestedCursor,
        limit: CHAT_HISTORY_PAGE_SIZE,
      });

      // 读库返回时 session 可能已经切换：旧请求不得写新会话的任何 state / ref。
      if (!isHistoryLoadRequestCurrent(loadOwnershipRef.current, owner)) {
        return false;
      }

      if (result.success) {
        const didReceiveOlderMessages = Array.isArray(result.messages) && result.messages.length > 0;
        const didCursorAdvance =
          result.nextCursor !== null &&
          result.nextCursor !== undefined &&
          result.nextCursor !== requestedCursor;

        if (didReceiveOlderMessages) {
          setMessages((prev) => messageTimeline.mergeMessages(prev, result.messages, 'prepend').messages);
        }

        const nextHasMore = resolveNextHistoryHasMore({
          hasMore: result.hasMore,
          didCursorAdvance,
        });

        // 同步写 ref，而不是只依赖 `hasMore` state 的下一次提交：
        // 最后一页返回后 presentation 侧立刻就能拿到 hasMore=false，不再空转一次。
        latestHasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
        cursorRef.current = didCursorAdvance ? result.nextCursor : null;

        return didReceiveOlderMessages;
      }

      setError(result.error || '加载更多失败');
      return false;
    } catch (err) {
      if (!isHistoryLoadRequestCurrent(loadOwnershipRef.current, owner)) {
        return false;
      }

      console.error('[useMessageHistoryState] Load more failed:', err);
      setError(err instanceof Error ? err.message : '加载更多失败');
      return false;
    } finally {
      const releasedOwnership = finishHistoryLoadRequest(loadOwnershipRef.current, owner);

      // 只有仍持有这把锁的那次 finish 才允许解锁；stale finish 完全 no-op，
      // 否则 A 的旧请求会把 B 仍在飞的状态清掉。
      if (releasedOwnership !== loadOwnershipRef.current) {
        loadOwnershipRef.current = releasedOwnership;
        setIsLoadingMore(false);
      }
    }
  }, [sessionId]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;

    // refresh 与 loadMore 共用同一个 session generation：请求发出时记下它，
    // 返回时若 generation 已经前进，说明这次结果属于旧会话，直接丢弃。
    const requestGeneration = loadOwnershipRef.current.generation;

    setIsLoading(true);
    setError(null);

    try {
      const result = await messageTimeline.open({
        sessionId,
        limit: CHAT_INITIAL_MESSAGE_WINDOW_SIZE,
      });

      if (requestGeneration !== loadOwnershipRef.current.generation) {
        return;
      }

      if (result.success) {
        applyInitialResult(result);
      } else {
        setError(result.error || '刷新失败');
      }
    } catch (err) {
      if (requestGeneration !== loadOwnershipRef.current.generation) {
        return;
      }

      setError(err instanceof Error ? err.message : '刷新失败');
    } finally {
      // 旧会话的 finally 不得把新会话的 loading 清掉。
      if (requestGeneration === loadOwnershipRef.current.generation) {
        setIsLoading(false);
      }
    }
  }, [sessionId, applyInitialResult]);

  return {
    messages,
    setMessages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    setError,
    loadMore,
    refresh,
    resetHistory,
    lastMessageIdRef,
  };
}
