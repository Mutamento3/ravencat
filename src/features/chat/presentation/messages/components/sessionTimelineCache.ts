/**
 * 在聊天展示层缓存会话时间线窗口，供进入会话时复用并限制缓存规模。
 *
 * 这只是**性能缓存**：是否命中缓存绝不能成为「能不能进入会话」的前置条件。
 * 每个 session 内部有窗口上限，会话数量也必须用 LRU 约束——否则后台预热
 * 会把缓存撑到无界，或者预热完一批又立刻被下一批互相淘汰。
 */

import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import { CHAT_INITIAL_MESSAGE_WINDOW_SIZE } from './chatBottomAnchorExperiment';

/**
 * 缓存窗口不得小于首屏窗口。
 *
 * 裁剪会把 `hasMore` 置为 true（被裁掉的部分相对于留下的窗口确实更早），
 * 所以缓存窗口一旦小于首屏窗口，进入会话时就会先按缓存给出 `hasMore = true`，
 * 等首屏查询回来才被纠正 —— 用户会看见一次没有事实依据的加载态。
 */
export const SESSION_TIMELINE_CACHE_WINDOW = CHAT_INITIAL_MESSAGE_WINDOW_SIZE;

/**
 * 缓存的会话数量上限。
 *
 * 必须不小于后台预热目标（`CHAT_ENTRY_PRELOAD_TARGET`），否则预热完的会话会在
 * 后续预热中被立刻互相淘汰，预热等于白做；再多留几条余量给用户正在打开的会话。
 */
export const SESSION_TIMELINE_CACHE_SESSION_CAPACITY = 20;

export interface SessionTimelineCacheEntry {
  sessionId: string;
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: number | null;
  lastMessageId: number | null;
}

/**
 * 依赖 `Map` 保留插入序实现 LRU：命中 / 写入都把 key 重新插入到末尾，
 * 超出容量时淘汰最前面的（最久未使用）会话。
 */
const CACHE = new Map<string, SessionTimelineCacheEntry>();

function evictOverflowSessions(): void {
  while (CACHE.size > SESSION_TIMELINE_CACHE_SESSION_CAPACITY) {
    const oldestKey = CACHE.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    CACHE.delete(oldestKey);
  }
}

function getLastMessageId(messages: ChatMessage[]): number | null {
  if (messages.length === 0) {
    return null;
  }

  return Math.max(...messages.map((message) => message.id));
}

function getNextCursor(messages: ChatMessage[]): number | null {
  if (messages.length === 0) {
    return null;
  }

  return Math.min(...messages.map((message) => message.id));
}

function normalizeSessionTimelineCacheEntry(entry: SessionTimelineCacheEntry): SessionTimelineCacheEntry {
  const messages = entry.messages.slice(-SESSION_TIMELINE_CACHE_WINDOW);
  const didTrimHistory = entry.messages.length > messages.length;

  return {
    ...entry,
    messages,
    hasMore: entry.hasMore || didTrimHistory,
    nextCursor: messages.length > 0 ? getNextCursor(messages) : null,
    lastMessageId: getLastMessageId(messages),
  };
}

export function getSessionTimelineCache(
  sessionId?: string | null
): SessionTimelineCacheEntry | null {
  if (!sessionId) {
    return null;
  }

  const entry = CACHE.get(sessionId);
  if (!entry) {
    return null;
  }

  const normalizedEntry = normalizeSessionTimelineCacheEntry(entry);
  // 命中即刷新 LRU 使用顺序（delete + set 把它移到队尾）。
  CACHE.delete(normalizedEntry.sessionId);
  CACHE.set(normalizedEntry.sessionId, normalizedEntry);

  // 深拷贝 messages，防止跨组件引用污染
  return {
    ...normalizedEntry,
    messages: [...normalizedEntry.messages],
  };
}

export function setSessionTimelineCache(entry: SessionTimelineCacheEntry): SessionTimelineCacheEntry {
  const normalizedEntry = normalizeSessionTimelineCacheEntry(entry);
  CACHE.delete(normalizedEntry.sessionId);
  CACHE.set(normalizedEntry.sessionId, normalizedEntry);
  evictOverflowSessions();
  return normalizedEntry;
}

export function clearSessionTimelineCache(sessionId?: string | null): void {
  if (sessionId) {
    CACHE.delete(sessionId);
  } else {
    CACHE.clear();
  }
}

/** 诊断用：当前缓存的会话数量。 */
export function getSessionTimelineCacheSize(): number {
  return CACHE.size;
}
