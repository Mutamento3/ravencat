/**
 * @fileoverview 统一会话列表排序
 *
 * AI 单聊与群聊在会话列表里是同一种列表项，必须共用同一套顺序语义，
 * 因此排序规则只在这里实现一次：会话列表 UI 与后台预热候选都消费本模块，
 * 禁止在 presentation 或 preload 里再写第二套比较器。
 *
 * 顺序语义（唯一权威）：
 *   1. pinned 永远在普通会话之前；
 *   2. pinned 区内部按「置顶区有效时间」从新到旧：
 *        max(真实消息活动时间, pinnedAt)
 *      —— `pinnedAt` 只负责「用户刚置顶时立刻浮到置顶区顶部」，
 *      之后真实新消息仍可让别的置顶会话自然反超（置顶不冻结位置）；
 *   3. 普通区只按真实消息活动时间；当前可见时间线没有消息
 *      （从未有过消息 / 已 clear / 可见消息被删空）时用 createdAt 稳定回落，
 *      而不是保留已被隐藏消息的时间；
 *   4. createdAt 兜底；
 *   5. id 稳定 tie-break，避免列表顺序抖动。
 *
 * `pinnedAt` **只在 pinned 区参与排序**：取消置顶时必须把 pinnedAt 清空，
 * 否则一个已经取消置顶的会话会因为「刚刚置顶过」继续赖在普通区前面。
 *
 * 「打开会话」不改变顺序：排序时间只来自持久化的消息活动与置顶事实。
 */

export interface ConversationOrderingKey {
  /** 稳定身份：单聊为 AI id，群聊为 groupId。 */
  id: string;
  isPinned: boolean;
  /**
   * 最后一条**可见**消息时间（ISO 字符串）。
   * 为空字符串 / null / undefined 都表示当前可见时间线没有消息。
   */
  lastActivityAt?: string | null;
  /**
   * 最近一次置顶时刻（ISO 字符串）。未置顶必须为 null / undefined。
   * 只在 pinned 区参与排序，绝不进入普通区。
   */
  pinnedAt?: string | null;
  /** 会话创建时间（ISO 字符串）。 */
  createdAt: string;
}

function toTimestamp(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** 普通区排序时间：只认真实消息活动，没有可见消息时回落到创建时间。 */
export function resolveNormalOrderingTime(key: ConversationOrderingKey): number {
  return toTimestamp(key.lastActivityAt) ?? toTimestamp(key.createdAt) ?? 0;
}

/**
 * 置顶区排序时间：真实消息活动与「最近置顶时刻」取较晚者。
 * 于是刚置顶立刻到顶部，之后的新消息又能重新洗牌。
 */
export function resolvePinnedOrderingTime(key: ConversationOrderingKey): number {
  return Math.max(
    resolveNormalOrderingTime(key),
    toTimestamp(key.pinnedAt) ?? 0,
  );
}

/** 按分区取排序时间：pinned 用置顶区规则，普通会话绝不参考 pinnedAt。 */
export function resolveConversationOrderingTime(key: ConversationOrderingKey): number {
  return key.isPinned ? resolvePinnedOrderingTime(key) : resolveNormalOrderingTime(key);
}

export function compareConversationOrdering(
  left: ConversationOrderingKey,
  right: ConversationOrderingKey,
): number {
  if (left.isPinned !== right.isPinned) {
    return left.isPinned ? -1 : 1;
  }

  const activityDiff =
    resolveConversationOrderingTime(right) - resolveConversationOrderingTime(left);
  if (activityDiff !== 0) {
    return activityDiff;
  }

  const createdDiff = (toTimestamp(right.createdAt) ?? 0) - (toTimestamp(left.createdAt) ?? 0);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  if (left.id === right.id) {
    return 0;
  }

  return left.id < right.id ? -1 : 1;
}

/** 返回新数组，调用方传入的列表不会被原地重排。 */
export function sortConversationOrdering<T extends ConversationOrderingKey>(
  items: readonly T[],
): T[] {
  return [...items].sort(compareConversationOrdering);
}
