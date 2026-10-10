/**
 * 后台预热候选：直接由统一会话列表的排序结果派生。
 *
 * 「用户列表里最可能点的会话」必须等于「最优先预热的会话」，所以候选顺序不允许
 * 再写一套自己的排序——统一复用 `@shared/utils/conversationListOrdering`
 * 的同一套语义（pinned 分区 → 置顶区有效时间 / 可见消息活动 → createdAt → id）。
 *
 * 热点集合是**动态**的：会话列表事实（新消息、置顶/取消置顶、clear history、
 * 删除最新消息、新建 canonical 会话）变化后必须重新计算；判断「是否需要开新一轮
 * 预热」只看 top 候选的身份与顺序（见 `resolveConversationPreloadHotSet`），
 * 不把 lastTime 本身塞进签名，避免每条消息都无意义重跑。
 */

import type { AIProfile } from '@features/assistants';
import { sortConversationOrdering } from '@shared/utils/conversationListOrdering';
import type { GroupChat } from '../../group/domain/GroupChat';
import type { ChatPreloadCandidate } from './chatScreenTypes';

/**
 * 分层预热规模。
 *
 * 每条会话只读最近一页，数据量本身不大；真正要避免的是启动阶段连续串行占用
 * SQLite 调度，所以先只跑列表最前面的若干条，其余等首屏与关键交互稳定后再跑。
 *
 * `CHAT_ENTRY_PRELOAD_TARGET` 必须 <= `SESSION_TIMELINE_CACHE_SESSION_CAPACITY`，
 * 否则预热完的会话会被下一批立刻互相淘汰。
 */
export const CHAT_ENTRY_PRELOAD_FIRST_TIER = 6;
export const CHAT_ENTRY_PRELOAD_TARGET = 16;

export interface BuildConversationPreloadCandidatesParams {
  aiList?: AIProfile[];
  groupChats?: GroupChat[];
}

/**
 * 只保留「时间线真实存在、可以立刻读取」的候选：
 * - direct：被拉黑的 AI 不预热；还没有 canonical 会话（从未打开过）的 AI 不预热，
 *   预热永远不允许成为创建会话身份的副作用来源。
 * - group：会话身份就是 groupId，全部可预热。
 */
export function buildConversationPreloadCandidates({
  aiList = [],
  groupChats = [],
}: BuildConversationPreloadCandidatesParams): ChatPreloadCandidate[] {
  const directCandidates: ChatPreloadCandidate[] = [];
  for (const ai of aiList) {
    if (ai?.isBlocked === true || !ai?.canonicalConversationId) {
      continue;
    }
    directCandidates.push({
      kind: 'direct',
      id: ai.id,
      sessionId: ai.canonicalConversationId,
      isPinned: ai.isPinned === true,
      lastActivityAt: ai.lastTime || null,
      pinnedAt: ai.pinnedAt || null,
      createdAt: ai.createdAt,
    });
  }

  const groupCandidates: ChatPreloadCandidate[] = groupChats.map((group) => ({
    kind: 'group',
    id: group.id,
    sessionId: group.id,
    isPinned: group.isPinned === true,
    lastActivityAt: group.lastTime || null,
    pinnedAt: group.pinnedAt || null,
    createdAt: group.createdAt,
  }));

  return sortConversationOrdering([...directCandidates, ...groupCandidates]);
}

/** 预热执行顺序（第一层最前面的若干条 + 后续批次）由调用方按本函数结果切片。 */
export function sliceConversationPreloadTiers(
  candidates: ChatPreloadCandidate[],
  firstTierSize: number,
  target: number,
): { firstTier: ChatPreloadCandidate[]; remaining: ChatPreloadCandidate[] } {
  const targets = candidates.slice(0, Math.max(0, target));
  const tierSize = Math.max(0, firstTierSize);

  return {
    firstTier: targets.slice(0, tierSize),
    remaining: targets.slice(tierSize),
  };
}

/**
 * 热点集合签名：只描述**当前 top 预热的身份与顺序**。
 *
 * 刻意不包含 lastTime / pinnedAt 等时间值：时间变化只有在真正改变 top 集合的
 * 身份或顺序时才值得重开一轮预热，否则「列表重读一次」就会变成一次全量重跑。
 * 消息事实本身的变化由 freshness 通道单独处理（见下面三个函数）。
 */
export function buildConversationPreloadHotSetSignature(
  candidates: ChatPreloadCandidate[],
  target: number = CHAT_ENTRY_PRELOAD_TARGET,
): string {
  return candidates
    .slice(0, Math.max(0, target))
    .map((candidate) => `${candidate.kind}:${candidate.id}:${candidate.sessionId ?? ''}`)
    .join('|');
}

/**
 * freshness key。
 *
 * 与热点签名单项同构（`kind:id:sessionId`）而不是只用 id：
 * conversation identity 变化（如 canonical session 重建）时必须当成另一条事实，
 * 否则会错误复用旧 freshness。
 */
export function buildConversationPreloadCandidateKey(
  candidate: Pick<ChatPreloadCandidate, 'kind' | 'id' | 'sessionId'>,
): string {
  return `${candidate.kind}:${candidate.id}:${candidate.sessionId ?? ''}`;
}

/** key → 该会话当时的 timeline 事实版本（`lastActivityAt`）。 */
export type ConversationPreloadFreshnessSnapshot = Record<string, string | null>;

/** 记录当前 top 候选的 timeline 事实版本；只关心 tracked hot set。 */
export function buildConversationPreloadFreshnessSnapshot(
  candidates: ChatPreloadCandidate[],
  target: number = CHAT_ENTRY_PRELOAD_TARGET,
): ConversationPreloadFreshnessSnapshot {
  const snapshot: ConversationPreloadFreshnessSnapshot = {};
  for (const candidate of candidates.slice(0, Math.max(0, target))) {
    snapshot[buildConversationPreloadCandidateKey(candidate)] = candidate.lastActivityAt ?? null;
  }
  return snapshot;
}

export interface ConversationPreloadFreshnessChanges {
  snapshot: ConversationPreloadFreshnessSnapshot;
  /** timeline cache 可能已过期、需要定向失效 + 重读的候选。 */
  changedCandidates: ChatPreloadCandidate[];
}

/**
 * 找出「timeline 事实版本变了」的 top 候选。
 *
 * 判据是**不相等**而不是「变新」：新消息（10:00 → 11:00）、删除最新消息
 * （11:00 → 10:00）、clear history（11:00 → null）、删除到空（10:00 → null）
 * 都会让旧 cache 过期，任何一个方向都必须刷新。
 *
 * 新进入 tracked hot set 的候选（上一轮 snapshot 里没有它的 key）视为 freshness
 * unknown：它的旧 cache 无法证明 fresh，因此也进入定向集合；这正好覆盖
 * 「会话掉出 top16 后又被新消息带回榜单」的场景。首次运行没有任何上一轮事实，
 * 不做无依据的失效（此时 LRU 里本来也不该有它的缓存）。
 */
export function resolveConversationPreloadFreshnessChanges({
  previous,
  candidates,
  target = CHAT_ENTRY_PRELOAD_TARGET,
}: {
  previous: ConversationPreloadFreshnessSnapshot | null;
  candidates: ChatPreloadCandidate[];
  target?: number;
}): ConversationPreloadFreshnessChanges {
  const trackedCandidates = candidates.slice(0, Math.max(0, target));
  const snapshot = buildConversationPreloadFreshnessSnapshot(candidates, target);

  if (!previous) {
    return { snapshot, changedCandidates: [] };
  }

  const changedCandidates = trackedCandidates.filter((candidate) => {
    const key = buildConversationPreloadCandidateKey(candidate);
    if (!Object.prototype.hasOwnProperty.call(previous, key)) {
      return true;
    }
    return (previous[key] ?? null) !== (candidate.lastActivityAt ?? null);
  });

  return { snapshot, changedCandidates };
}

export interface ConversationPreloadRunnableContext {
  /** 当前前台群聊 groupId；null / undefined 表示没有打开群聊。 */
  activeGroupId?: string | null;
  /** direct 侧：该 AI 是否正在进入 / 停留（由 conversation preparation 决定）。 */
  isDirectConversationActiveOrPreparing?: (aiId: string) => boolean;
}

/**
 * 本轮背景预热是否应该读这条会话。
 *
 * 前台会话（active direct / active group）由 ChatDetail / GroupChatDetail 自己
 * 实时读 timeline，后台再读一次是重复 IO。
 *
 * 注意：这个过滤**只作用于 runnable 读集合**，绝不影响热点集合的身份、顺序与
 * 签名 —— 否则「只是打开一个群聊」就会重排热点集合，违背纯导航不改热点集合。
 */
export function isConversationPreloadCandidateRunnable(
  candidate: ChatPreloadCandidate,
  context: ConversationPreloadRunnableContext = {},
): boolean {
  if (candidate.kind === 'group') {
    return !context.activeGroupId || candidate.id !== context.activeGroupId;
  }

  return !context.isDirectConversationActiveOrPreparing?.(candidate.id);
}

export function filterRunnableConversationPreloadCandidates(
  candidates: ChatPreloadCandidate[],
  context: ConversationPreloadRunnableContext = {},
): ChatPreloadCandidate[] {
  return candidates.filter((candidate) => (
    isConversationPreloadCandidateRunnable(candidate, context)
  ));
}

export interface ConversationPreloadHotSetDecision {
  signature: string;
  /** 本轮要预热的候选（已按 top target 截断）。 */
  candidates: ChatPreloadCandidate[];
  /** 签名未变时为 false：不得重开整轮预热。 */
  shouldPreload: boolean;
}

/**
 * 由当前列表事实推导「是否要开新一轮预热」。
 *
 * 调用方持有上一轮签名：事实更新后重新 build 候选，签名没变就不开新轮；
 * 签名变了才把新的 top 候选交给 `preloadConversationTimelines`。
 * 打开已有会话这类纯导航不会改变列表事实，因此不会重排热点集合。
 */
export function resolveConversationPreloadHotSet({
  previousSignature,
  candidates,
  target = CHAT_ENTRY_PRELOAD_TARGET,
}: {
  previousSignature: string | null;
  candidates: ChatPreloadCandidate[];
  target?: number;
}): ConversationPreloadHotSetDecision {
  const normalizedTarget = Math.max(0, target);
  const topCandidates = candidates.slice(0, normalizedTarget);
  const signature = buildConversationPreloadHotSetSignature(candidates, normalizedTarget);

  return {
    signature,
    candidates: topCandidates,
    shouldPreload: previousSignature === null || previousSignature !== signature,
  };
}
