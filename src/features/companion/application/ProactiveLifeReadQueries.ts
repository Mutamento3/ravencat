/** 主动生活只读查询；日程持有计划事实，Chat 持有实际响应与行动记录。 */

import type {
  ChatTimelineAnchor,
  findFirstVisibleTimelineAnchorsByRunIds,
  listChatAgentActivityEvidence,
} from '@features/chat';
import { getCompanionRuntimeDependencies } from './CompanionRuntimeDependencies';
import type {
  ProactiveLifeFutureCursor,
  ProactiveLifeFutureRecord,
  ProactiveLifeHistoryCursor,
  ProactiveLifeHistoryRecord,
  ProactiveLifePage,
  ProactiveLifeRunningRecord,
} from '../domain/ProactiveLifeReadRepository';

export type {
  ProactiveLifeFutureCursor,
  ProactiveLifeHistoryCursor,
  ProactiveLifeSourceType,
} from '../domain/ProactiveLifeReadRepository';

export type ProactiveLifeFutureItem = ProactiveLifeFutureRecord;
export interface ProactiveLifeRunningItem extends ProactiveLifeRunningRecord {
  modelResponded: boolean;
}

export interface ProactiveLifeHistoryItem extends ProactiveLifeHistoryRecord {
  chatAnchor: ChatTimelineAnchor | null;
  modelResponded: boolean;
}

export interface ProactiveLifeOverview {
  nextFuture: ProactiveLifeFutureItem | null;
  futureCount: number;
  runningItems: ProactiveLifeRunningItem[];
  recentHistory: ProactiveLifeHistoryItem[];
  historyNextCursor: ProactiveLifeHistoryCursor | null;
}

export interface ProactiveLifeOverviewQuery {
  ownerAIId: string;
  now: string;
  historyLimit: number;
}

export interface ProactiveLifeFutureQuery {
  ownerAIId: string;
  now: string;
  after?: ProactiveLifeFutureCursor | null;
  limit: number;
}

export interface ProactiveLifeHistoryQuery {
  now: string;
  ownerAIId: string;
  before?: ProactiveLifeHistoryCursor | null;
  limit: number;
}

export async function loadProactiveLifeOverview(
  input: ProactiveLifeOverviewQuery,
): Promise<ProactiveLifeOverview> {
  assertReadQuery(input.ownerAIId, input.now, input.historyLimit, 'historyLimit');
  const dependencies = getCompanionRuntimeDependencies();
  const overview = await dependencies.repositories.proactiveLife.loadOverview({
    ownerAIId: input.ownerAIId,
    now: input.now,
    historyLimit: input.historyLimit,
  });
  const runningEvidence = await dependencies.chat.listAgentActivityEvidence(overview.runningItems.map((item) => item.runId));
  const respondedRunIds = new Set(runningEvidence.filter((item) => item.respondedAt !== null).map((item) => item.runId));

  return {
    nextFuture: overview.nextFuture,
    futureCount: overview.futureCount,
    runningItems: overview.runningItems.map((item) => ({ ...item, modelResponded: respondedRunIds.has(item.runId) })),
    recentHistory: await attachChatAnchors(
      overview.recentHistory,
      dependencies.chat.findFirstVisibleTimelineAnchorsByRunIds,
      dependencies.chat.listAgentActivityEvidence,
    ),
    historyNextCursor: overview.historyNextCursor,
  };
}

export async function listProactiveLifeFuture(
  input: ProactiveLifeFutureQuery,
): Promise<ProactiveLifePage<ProactiveLifeFutureRecord, ProactiveLifeFutureCursor>> {
  assertReadQuery(input.ownerAIId, input.now, input.limit, 'limit');
  return getCompanionRuntimeDependencies().repositories.proactiveLife.listFuture(input);
}

export async function listProactiveLifeHistory(
  input: ProactiveLifeHistoryQuery,
): Promise<ProactiveLifePage<ProactiveLifeHistoryItem, ProactiveLifeHistoryCursor>> {
  assertReadQuery(input.ownerAIId, input.now, input.limit, 'limit');
  const dependencies = getCompanionRuntimeDependencies();
  const history = await dependencies.repositories.proactiveLife.listHistory(input);
  return {
    ...history,
    items: await attachChatAnchors(
      history.items,
      dependencies.chat.findFirstVisibleTimelineAnchorsByRunIds,
      dependencies.chat.listAgentActivityEvidence,
    ),
  };
}

async function attachChatAnchors(
  items: ProactiveLifeHistoryRecord[],
  findAnchors: typeof findFirstVisibleTimelineAnchorsByRunIds,
  findEvidence: typeof listChatAgentActivityEvidence,
): Promise<ProactiveLifeHistoryItem[]> {
  const runIds = Array.from(new Set(items.flatMap((item) => item.runId ? [item.runId] : [])));
  if (runIds.length === 0) {
    return items.map((item) => ({ ...item, chatAnchor: null, modelResponded: false }));
  }

  const anchors = await findAnchors({ runIds });
  const evidence = await findEvidence(runIds);
  const evidenceByRunId = new Map(evidence.map((item) => [item.runId, item]));
  const anchorsByRunId = new Map(anchors.map((anchor) => [anchor.runId, anchor]));
  return items.map((item) => {
    const record = item.runId ? evidenceByRunId.get(item.runId) : undefined;
    const modelResponded = Boolean(record?.respondedAt);
    const completionDisposition = item.runId === null ? 'unexecuted'
      : record?.terminalCode === 'COMPLETED' && modelResponded ? 'completed'
      : record?.terminalCode === 'INTERRUPTED' || item.completionDisposition === 'interrupted' ? 'interrupted'
      : record?.terminalCode ? 'failed' : modelResponded ? 'interrupted' : 'unexecuted';
    return { ...item, completionDisposition, modelResponded,
      chatAnchor: item.runId ? anchorsByRunId.get(item.runId) ?? null : null };
  });
}

function assertReadQuery(
  ownerAIId: string,
  now: string,
  limit: number,
  limitName: string,
): void {
  if (ownerAIId.length === 0) {
    throw new Error('主动生活查询 ownerAIId 不能为空');
  }
  if (!Number.isFinite(Date.parse(now))) {
    throw new Error('主动生活查询 now 必须是有效绝对时间');
  }
  assertPositiveInteger(limit, limitName);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`主动生活查询 ${name} 必须是正整数`);
  }
}
