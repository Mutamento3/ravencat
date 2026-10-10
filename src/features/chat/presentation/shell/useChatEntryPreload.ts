/**
 * 预热会话时间线，并维护有限的预加载结果。
 *
 * 预热的唯一职责是「让消息出现得更快」。它不决定任何会话能不能进入，
 * 也不允许创建会话身份、不允许伪装成交互优先级的工作。
 */

import { useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';

import type { ChatSession } from '../../conversation/domain/SessionRepository';
import { resolveCanonicalConversation } from '../../conversation/application/ResolveCanonicalConversation';
import { getCanonicalChatConversation } from '../../conversation/application/ChatPresentation';
import { messageTimeline } from '../../messages/application/MessageTimeline';
import {
  getSessionTimelineCache,
  setSessionTimelineCache,
  type SessionTimelineCacheEntry,
} from '../messages/components/sessionTimelineCache';
import { CHAT_INITIAL_MESSAGE_WINDOW_SIZE } from '../messages/components/chatBottomAnchorExperiment';
import {
  CHAT_ENTRY_PRELOAD_FIRST_TIER,
  CHAT_ENTRY_PRELOAD_TARGET,
} from './conversationPreloadCandidates';
import {
  chatPreloadCandidateKey,
  type ChatPreloadCandidate,
  type ChatPreloadEntry,
} from './chatScreenTypes';

/** 入口预热复用首屏窗口，避免预热结果与进入会话后的首屏窗口不一致。 */
const CHAT_ENTRY_PRELOAD_LIMIT = CHAT_INITIAL_MESSAGE_WINDOW_SIZE;

/** 后台预热优先级：不得与用户真实交互争抢 SQLite 调度。 */
const CHAT_ENTRY_PRELOAD_PRIORITY = 'maintenance';

interface UseChatEntryPreloadParams {
  currentAI: { id: string } | null;
  setCurrentSession: (session: ChatSession | null) => void;
}

export function useChatEntryPreload({
  currentAI,
  setCurrentSession,
}: UseChatEntryPreloadParams) {
  const chatPreloadMapRef = useRef(new Map<string, ChatPreloadEntry>());
  const preloadRunIdRef = useRef(0);

  const publishEntry = useCallback((key: string, entry: ChatPreloadEntry | null) => {
    if (!entry) {
      chatPreloadMapRef.current.delete(key);
      return null;
    }
    chatPreloadMapRef.current.set(key, entry);
    return entry;
  }, []);

  /**
   * 解析会话身份。已存在的 canonical 会话只做一次索引读；
   * 只有 brand-new AI 才进入创建事务——进入路径不允许被写锁拖慢。
   */
  const resolveConversation = useCallback(async (ai: { id: string }) => {
    if (!ai?.id) {
      return null;
    }

    const existing = await getCanonicalChatConversation(ai.id);
    if (existing) {
      return existing;
    }

    return resolveCanonicalConversation({ aiId: ai.id });
  }, []);

  const refreshCurrentSession = useCallback(async () => {
    if (!currentAI?.id) {
      return;
    }

    try {
      const session = await resolveConversation({ id: currentAI.id });
      setCurrentSession(session);
    } catch (error) {
      console.error('Failed to refresh session:', error);
    }
  }, [currentAI?.id, resolveConversation, setCurrentSession]);

  const preloadSessionTimeline = useCallback(async (
    sessionId?: string | null
  ): Promise<SessionTimelineCacheEntry | null> => {
    if (!sessionId) {
      return null;
    }

    const cachedEntry = getSessionTimelineCache(sessionId);
    if (cachedEntry) {
      return cachedEntry;
    }

    const result = await messageTimeline.open({
      sessionId,
      limit: CHAT_ENTRY_PRELOAD_LIMIT,
      priority: CHAT_ENTRY_PRELOAD_PRIORITY,
    });

    if (!result.success) {
      return null;
    }

    return setSessionTimelineCache({
      sessionId,
      messages: result.messages,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      lastMessageId: messageTimeline.getLastMessageId(result.messages),
    });
  }, []);

  const warmConversationEntry = useCallback(async (
    candidate: ChatPreloadCandidate
  ): Promise<ChatPreloadEntry> => {
    const key = chatPreloadCandidateKey(candidate);
    const existingEntry = chatPreloadMapRef.current.get(key);
    if (existingEntry?.promise) {
      return existingEntry.promise;
    }

    let preloadPromise: Promise<ChatPreloadEntry>;

    const settle = (patch: Pick<ChatPreloadEntry, 'status' | 'timelineStatus' | 'error'>) => {
      const nextEntry: ChatPreloadEntry = {
        key,
        error: null,
        updatedAt: Date.now(),
        promise: null,
        ...patch,
      };
      publishEntry(key, nextEntry);
      return nextEntry;
    };

    preloadPromise = (async (): Promise<ChatPreloadEntry> => {
      if (!candidate.sessionId) {
        return settle({ status: 'ready', timelineStatus: 'skipped', error: null });
      }

      const timelineCache = await preloadSessionTimeline(candidate.sessionId);
      return settle({
        status: 'ready',
        timelineStatus: timelineCache ? 'ready' : 'error',
        error: timelineCache ? null : '时间线预热失败',
      });
    })()
      .catch((error) => settle({
        status: 'error',
        timelineStatus: 'error',
        error: error instanceof Error ? error.message : '预热失败',
      }))
      .finally(() => {
        const latestEntry = chatPreloadMapRef.current.get(key);
        if (latestEntry?.promise === preloadPromise) {
          publishEntry(key, { ...latestEntry, promise: null });
        }
      });

    publishEntry(key, {
      key,
      status: 'loading',
      timelineStatus: 'skipped',
      error: null,
      updatedAt: Date.now(),
      promise: preloadPromise,
    });

    return preloadPromise;
  }, [preloadSessionTimeline, publishEntry]);

  /**
   * 分层预热：第一层串行跑完列表最前面的会话，其余等关键交互稳定后再继续。
   * 每一批都检查 runId，列表换代后旧批次立即让路。
   */
  const preloadConversationTimelines = useCallback(async (candidates: ChatPreloadCandidate[]) => {
    const targets = candidates.filter((candidate) => Boolean(candidate.sessionId));
    if (targets.length === 0) {
      return;
    }

    const runId = preloadRunIdRef.current + 1;
    preloadRunIdRef.current = runId;
    const isCurrentRun = () => preloadRunIdRef.current === runId;

    const runInOrder = async (items: ChatPreloadCandidate[]) => {
      for (const candidate of items) {
        if (!isCurrentRun()) {
          return;
        }
        await warmConversationEntry(candidate);
      }
    };

    const firstTier = targets.slice(0, CHAT_ENTRY_PRELOAD_FIRST_TIER);
    const remaining = targets.slice(CHAT_ENTRY_PRELOAD_FIRST_TIER, CHAT_ENTRY_PRELOAD_TARGET);

    await runInOrder(firstTier);
    if (!isCurrentRun() || remaining.length === 0) {
      return;
    }

    // 第二层等首屏与关键交互稳定后再跑，避免启动阶段连续串行占用 SQLite 调度。
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });
    if (!isCurrentRun()) {
      return;
    }

    await runInOrder(remaining);
  }, [warmConversationEntry]);

  return {
    refreshCurrentSession,
    resolveConversation,
    preloadSessionTimeline,
    warmConversationEntry,
    preloadConversationTimelines,
  };
}
