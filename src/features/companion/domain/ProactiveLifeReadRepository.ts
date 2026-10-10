/** 主动生活只读端口；不拥有 AI 日程的业务事实。 */

export type ProactiveLifeSourceType = 'ai_schedule';

export interface ProactiveLifeFutureCursor {
  plannedAt: string;
  sourceType: ProactiveLifeSourceType;
  sourceId: string;
}

export interface ProactiveLifeHistoryCursor {
  /** 机会真正获得执行机会的时间（canonical claimed_at）。 */
  occurredAt: string;
  sourceType: ProactiveLifeSourceType;
  sourceId: string;
}

/** 主动生活历史的用户可理解终态，不暴露 AI Schedule 的内部 disposition 名称。 */
export type ProactiveLifeCompletionDisposition = 'completed' | 'interrupted' | 'unexecuted' | 'failed';

export interface ProactiveLifeFutureRecord {
  sourceType: ProactiveLifeSourceType;
  sourceId: string;
  ownerAIId: string;
  plannedAt: string;
  summary: string | null;
}

export interface ProactiveLifeRunningRecord extends ProactiveLifeFutureRecord {
  startedAt: string;
  runId: string;
}

export interface ProactiveLifeHistoryRecord extends ProactiveLifeFutureRecord {
  occurredAt: string;
  terminalAt: string;
  runId: string | null;
  completionDisposition: ProactiveLifeCompletionDisposition;
}

export interface ProactiveLifePage<Item, Cursor> {
  items: Item[];
  nextCursor: Cursor | null;
  hasMore: boolean;
}

export interface ProactiveLifeOverviewRecord {
  nextFuture: ProactiveLifeFutureRecord | null;
  futureCount: number;
  runningItems: ProactiveLifeRunningRecord[];
  recentHistory: ProactiveLifeHistoryRecord[];
  historyNextCursor: ProactiveLifeHistoryCursor | null;
}

export interface ProactiveLifeReadRepository {
  loadOverview(input: {
    ownerAIId: string;
    now: string;
    historyLimit: number;
  }): Promise<ProactiveLifeOverviewRecord>;
  listFuture(input: {
    ownerAIId: string;
    now: string;
    after?: ProactiveLifeFutureCursor | null;
    limit: number;
  }): Promise<ProactiveLifePage<ProactiveLifeFutureRecord, ProactiveLifeFutureCursor>>;
  listHistory(input: {
    now: string;
    ownerAIId: string;
    before?: ProactiveLifeHistoryCursor | null;
    limit: number;
  }): Promise<ProactiveLifePage<ProactiveLifeHistoryRecord, ProactiveLifeHistoryCursor>>;
}
