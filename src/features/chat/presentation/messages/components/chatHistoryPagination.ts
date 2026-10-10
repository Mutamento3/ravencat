/**
 * 聊天历史向上分页的 demand 判定、排队语义与请求所有权。
 *
 * 分页只能由「用户真实的向上滚动」产生 demand。
 * 数据落地、in-flight 结束、渲染条数变化都不得自行生成 demand：
 * prepend 之后 `maintainVisibleContentPosition` 会修正 offset，此时 JS 侧读到的
 * `contentOffset.y` 可能仍是修正前的旧值，一旦把这种旧值和"数据刚落地"组合起来
 * 自动续页，就会在用户已经停手的情况下继续翻页，最终把整段历史灌进内存。
 *
 * 因此这里只有一个 demand 入口：滚动。in-flight 期间最多排队一个 token，
 * 请求结束后最多消费一个 token，且 token 只能由新的真实滚动设置。
 *
 * 本文件同时持有两层「请求所有权」：
 * - `HistoryPaginationGate`：组件层分页门（generation + in-flight + 排队 token）；
 * - `HistoryLoadOwnership`：application 层 `loadMore()` 的请求 owner。
 *
 * 两层都必须显式记录 generation，而不是靠布尔量。原因：异步请求的 finally 在
 * `await` 之后才执行，那时 session 可能已经切换、gate / 锁可能已经属于另一个会话。
 * 只有「这个请求是否仍拥有当前 generation」这一判断能在 mutate 之前可靠地挡住旧请求。
 * 组件层与 application 层都是同一份纯逻辑，verify 脚本直接加载本文件验证，不复制影子实现。
 */

/** 历史分页每页条数。首屏窗口与预加载窗口是另外的语义，不要与此混用。 */
export const CHAT_HISTORY_PAGE_SIZE = 30;

/** 顶部预取水位：视口高度的倍数。用户撞到顶部之前就应开始补页。 */
export const CHAT_HISTORY_PREFETCH_VIEWPORT_RATIO = 1.5;

/**
 * 内容不足一屏时才允许的补页水位。
 * 展示层折叠（reasoning 聚合、assistant segment collapse、tool status）会让
 * 原始 messages 很多但实际高度不足以产生滚动事件，此时需要补齐到可滚动。
 */
export const CHAT_HISTORY_BOOTSTRAP_VIEWPORT_RATIO = 1.2;

export type ScrollHistoryDemandDecision = 'request' | 'queue' | 'ignore';

export interface HistoryPaginationDemand {
  /** 加载期间用户继续向上滚动留下的唯一排队 token。 */
  readonly scrollQueued: boolean;
}

export const IDLE_HISTORY_PAGINATION_DEMAND: HistoryPaginationDemand = { scrollQueued: false };

export interface ScrollHistoryDemandInput {
  /** 本次滚动回调读到的 contentOffset.y。 */
  contentOffsetY: number;
  /** 上一次滚动回调的 contentOffset.y；null 表示还没有可比对的基线。 */
  previousContentOffsetY: number | null;
  /** 当前 viewport 高度（layoutMeasurement.height）。 */
  viewportHeight: number;
  hasMore: boolean;
  isPageInFlight: boolean;
  /** 当前处于用户手势上下文（drag 或 momentum），程序化滚动不算。 */
  isUserScrollActive: boolean;
}

export function resolveHistoryPrefetchDistance(viewportHeight: number): number {
  return viewportHeight * CHAT_HISTORY_PREFETCH_VIEWPORT_RATIO;
}

/**
 * 判定一次滚动回调是否产生历史分页 demand。
 *
 * `request` = 立即请求；`queue` = 已有请求在飞，记一个排队 token；`ignore` = 什么都不做。
 *
 * 这里刻意**没有**「这次滚动是否紧跟在内容尺寸变化之后」的修正标记：
 * `onContentSizeChange` 也可能来自 reasoning 展开、图片尺寸完成、展示投影重排，
 * 这些情况后面并不一定跟随一次 offset 修正滚动，标记会一直挂着并吞掉用户真实的上滑。
 * 方向判断本身已经足够：prepend 的修正只会把 y 推大，而 demand 要求 y 严格变小。
 */
export function resolveScrollDemandDecision(
  input: ScrollHistoryDemandInput
): ScrollHistoryDemandDecision {
  const {
    contentOffsetY,
    previousContentOffsetY,
    viewportHeight,
    hasMore,
    isPageInFlight,
    isUserScrollActive,
  } = input;

  if (!hasMore) {
    return 'ignore';
  }

  // 程序化滚动（scrollToEnd / scrollToIndex）不是用户意图。
  if (!isUserScrollActive) {
    return 'ignore';
  }

  if (previousContentOffsetY === null) {
    return 'ignore';
  }

  // 只承认「向历史方向移动」：y 必须比上一次更小。
  // prepend 的 offset 修正是把 y 推大，天然被这一条挡掉。
  if (contentOffsetY >= previousContentOffsetY) {
    return 'ignore';
  }

  if (viewportHeight <= 0) {
    return 'ignore';
  }

  if (contentOffsetY > resolveHistoryPrefetchDistance(viewportHeight)) {
    return 'ignore';
  }

  return isPageInFlight ? 'queue' : 'request';
}

export function queueScrollDemand(
  demand: HistoryPaginationDemand
): HistoryPaginationDemand {
  if (demand.scrollQueued) {
    return demand;
  }
  return { scrollQueued: true };
}

/**
 * 一次分页请求结束后消费排队 token。
 *
 * 只会消费「已经存在的」一个 token，不会自己制造新 demand；
 * `hasMore` 已经为 false 时直接丢弃 token，避免继续空请求。
 */
export function consumeQueuedScrollDemand(
  demand: HistoryPaginationDemand,
  params: { hasMore: boolean }
): { demand: HistoryPaginationDemand; shouldRequest: boolean } {
  if (!demand.scrollQueued) {
    return { demand, shouldRequest: false };
  }

  return {
    demand: IDLE_HISTORY_PAGINATION_DEMAND,
    shouldRequest: params.hasMore,
  };
}

/**
 * 内容高度不足以产生滚动时，才允许继续补页。
 *
 * 这不是普通分页通道：一旦内容超过水位就立即退出，交回滚动 demand 模型。
 *
 * `contentHeight` 用 `null` 表示「尚未测量」。它不能和真实高度 0 合并：
 * list layout 与 content size 测量是两条独立回调，后者可能晚到，
 * 把未测量当成 0 会让每次 list layout 都误判「内容不足一屏」而白补一页。
 */
export function shouldRequestBootstrapPage(params: {
  contentHeight: number | null;
  viewportHeight: number;
  hasMore: boolean;
  isPageInFlight: boolean;
}): boolean {
  const { contentHeight, viewportHeight, hasMore, isPageInFlight } = params;

  if (contentHeight === null) {
    return false;
  }

  if (!hasMore || isPageInFlight) {
    return false;
  }

  if (viewportHeight <= 0) {
    return false;
  }

  return contentHeight <= viewportHeight * CHAT_HISTORY_BOOTSTRAP_VIEWPORT_RATIO;
}

/**
 * 分页请求门：generation 所有权 + in-flight 互斥 + 唯一排队 token。
 *
 * 组件层把整个 gate 放在一个 ref 里。anchor 与滚动共用同一个 gate，
 * 所以两者不会并发请求同一页。
 *
 * `generation` 标识「这个 gate 属于哪一次列表生命周期」。session 切换时推进
 * generation 并建立全新的 idle gate，旧请求此后只是一个 stale token：
 * 它的 finally 既不能清 current gate 的 in-flight，也不能消费 current gate 的排队 token。
 */
export interface HistoryPaginationGate {
  readonly generation: number;
  readonly inFlight: boolean;
  readonly demand: HistoryPaginationDemand;
}

export const IDLE_HISTORY_PAGINATION_GATE: HistoryPaginationGate = {
  generation: 0,
  inFlight: false,
  demand: IDLE_HISTORY_PAGINATION_DEMAND,
};

/** session 切换 / 列表状态重置：建立新 generation 的 idle gate。 */
export function beginHistoryPaginationGeneration(
  gate: HistoryPaginationGate
): HistoryPaginationGate {
  return {
    generation: gate.generation + 1,
    inFlight: false,
    demand: IDLE_HISTORY_PAGINATION_DEMAND,
  };
}

/** 一次分页请求的所有权凭证。请求开始时捕获，结束时用它判断自己是否已经过期。 */
export interface HistoryPageRequestToken {
  readonly generation: number;
}

/** 把一次滚动判定应用到 gate。只有 `queue` 会改变状态。 */
export function applyScrollDemandToGate(
  gate: HistoryPaginationGate,
  decision: ScrollHistoryDemandDecision
): HistoryPaginationGate {
  if (decision !== 'queue') {
    return gate;
  }

  const demand = queueScrollDemand(gate.demand);
  return demand === gate.demand ? gate : { ...gate, demand };
}

/** 尝试开始一页请求。返回 null 表示已有请求在飞，或已经没有更早的消息。 */
export function beginHistoryPageRequest(
  gate: HistoryPaginationGate,
  params: { hasMore: boolean }
): { gate: HistoryPaginationGate; request: HistoryPageRequestToken } | null {
  if (gate.inFlight || !params.hasMore) {
    return null;
  }

  return {
    gate: { ...gate, inFlight: true },
    request: { generation: gate.generation },
  };
}

/**
 * 结束一页请求。
 *
 * 返回 null 表示这次 finish 已经过期（gate 已经属于新的 generation）：
 * 调用方必须**完全 no-op**——不得清当前 gate、不得消费当前排队 token、
 * 不得触发 queued-scroll。旧会话的异步返回只允许处理自己那一份状态。
 *
 * 未过期时：只在存在排队 token 且仍有更早消息时要求续页；token 无论是否被消费都会清空，
 * 因此一次失败最多多试一次，不会把列表锁死，也不会自己制造新的 demand。
 */
export function finishHistoryPageRequest(
  gate: HistoryPaginationGate,
  request: HistoryPageRequestToken,
  params: { hasMore: boolean }
): { gate: HistoryPaginationGate; shouldRequestQueued: boolean } | null {
  if (request.generation !== gate.generation) {
    return null;
  }

  const consumption = consumeQueuedScrollDemand(gate.demand, { hasMore: params.hasMore });

  return {
    gate: { ...gate, inFlight: false, demand: consumption.demand },
    shouldRequestQueued: consumption.shouldRequest,
  };
}

/* ------------------------------------------------------------------ *
 * application 层：loadMore 的请求所有权
 * ------------------------------------------------------------------ */

/**
 * 一次 `loadMore()` 的所有权凭证。
 *
 * 只用布尔锁是不够的：`finally` 里的 `lock = false` 无法区分「自己还持锁」与
 * 「锁已经被新会话的请求重新拿走」。带上 generation / sessionId / requestId 之后，
 * 旧请求的 finally 只能释放自己那一把锁。
 */
export interface HistoryLoadRequestOwner {
  readonly generation: number;
  readonly sessionId: string;
  readonly requestId: number;
}

export interface HistoryLoadOwnership {
  readonly generation: number;
  readonly requestSequence: number;
  readonly active: HistoryLoadRequestOwner | null;
}

export const IDLE_HISTORY_LOAD_OWNERSHIP: HistoryLoadOwnership = {
  generation: 0,
  requestSequence: 0,
  active: null,
};

/**
 * session 切换：推进 generation 并丢弃旧 owner。
 *
 * 丢弃 owner 是关键——新 session 必须立刻能发起自己的分页，
 * 不能被上一个 session 的旧请求继续锁住。
 */
export function beginHistorySession(
  ownership: HistoryLoadOwnership
): HistoryLoadOwnership {
  return {
    generation: ownership.generation + 1,
    requestSequence: ownership.requestSequence,
    active: null,
  };
}

/**
 * 尝试开启一次 `loadMore()`。
 *
 * 入口条件与旧实现的 guard 一致：有 session、确实还有更早消息、有游标、
 * 且当前没有归属于本 generation 的在飞请求。返回 null 表示这次调用不该读库。
 *
 * 通过校验的游标一并回传，调用方不必再自查一次同一组不变量。
 */
export function beginHistoryLoadRequest(
  ownership: HistoryLoadOwnership,
  params: { sessionId: string | null | undefined; hasMore: boolean; cursor: number | null }
): {
  ownership: HistoryLoadOwnership;
  owner: HistoryLoadRequestOwner;
  cursor: number;
} | null {
  const { sessionId, hasMore, cursor } = params;

  if (!sessionId || !hasMore || cursor === null || ownership.active) {
    return null;
  }

  const owner: HistoryLoadRequestOwner = {
    generation: ownership.generation,
    sessionId,
    requestId: ownership.requestSequence + 1,
  };

  return {
    ownership: { ...ownership, requestSequence: owner.requestId, active: owner },
    owner,
    cursor,
  };
}

/**
 * 这个请求在 `await` 之后是否仍然拥有当前 session 的写入权。
 *
 * 只要返回 false，调用方就不得执行任何 setState / ref 写入——
 * 包括 `messages`、`hasMore`、`cursor`、`lastMessageId`、`error`、`isLoadingMore`。
 */
export function isHistoryLoadRequestCurrent(
  ownership: HistoryLoadOwnership,
  owner: HistoryLoadRequestOwner
): boolean {
  return Boolean(
    ownership.generation === owner.generation
    && ownership.active
    && ownership.active.requestId === owner.requestId
    && ownership.active.sessionId === owner.sessionId
  );
}

/** 结束一次请求：只有仍持有所有权的那次 finish 才清空 active；stale finish 完全 no-op。 */
export function finishHistoryLoadRequest(
  ownership: HistoryLoadOwnership,
  owner: HistoryLoadRequestOwner
): HistoryLoadOwnership {
  if (!isHistoryLoadRequestCurrent(ownership, owner)) {
    return ownership;
  }

  return { ...ownership, active: null };
}

/**
 * 最后一页的 hasMore：游标没有前进就说明仓储侧已经没有更早的消息。
 *
 * 结果必须在请求返回的同一 tick 写进同步 ref，不能等 React 下一次提交，
 * 否则 presentation 侧在 `loadMore()` resolve 之后仍然可能以为还有历史而空转一次。
 */
export function resolveNextHistoryHasMore(params: {
  hasMore: boolean;
  didCursorAdvance: boolean;
}): boolean {
  return Boolean(params.hasMore && params.didCursorAdvance);
}
