/**
 * 从唯一 AI 日程真值读取主动生活 read model。
 *
 * 这个 adapter 只读 durable truth，不写回状态，也不创建 activity projection table。
 * 日程状态机由 Repository 拥有；这里只映射产品字段并提供稳定分页。
 */

import { databaseCoordinator, type DatabaseReadExecutor } from '@platform/persistence';
import {
  type ProactiveLifeCompletionDisposition,
  type ProactiveLifeFutureCursor,
  type ProactiveLifeFutureRecord,
  type ProactiveLifeHistoryCursor,
  type ProactiveLifeHistoryRecord,
  type ProactiveLifePage,
  type ProactiveLifeReadRepository,
  type ProactiveLifeRunningRecord,
  type ProactiveLifeSourceType,
  type ProactiveLifeOverviewRecord,
} from '../domain/ProactiveLifeReadRepository';

interface FutureRow {
  source_type: ProactiveLifeSourceType;
  source_id: string;
  owner_ai_id: string;
  planned_at: string;
  summary: string | null;
}

interface FutureOverviewRow extends FutureRow {
  future_count: number;
}

interface RunningRow {
  source_type: ProactiveLifeSourceType;
  source_id: string;
  owner_ai_id: string;
  planned_at: string;
  summary: string | null;
  started_at: string;
  run_id: string;
}

interface HistoryRow {
  source_type: ProactiveLifeSourceType;
  source_id: string;
  owner_ai_id: string;
  planned_at: string;
  summary: string | null;
  occurred_at: string;
  terminal_at: string;
  run_id: string | null;
  completion_disposition: string;
}

const FUTURE_ROWS = `
  SELECT
    'ai_schedule' AS source_type,
    schedule_id AS source_id,
    owner_ai_id,
    remind_at AS planned_at,
    summary,
    julianday(remind_at) AS planned_at_epoch
  FROM raven_cat_ai_schedules
  WHERE owner_ai_id = ?
    AND status = 'scheduled'
    AND julianday(remind_at) > julianday(?)`;

const RUNNING_ROWS = `
  SELECT
    'ai_schedule' AS source_type,
    schedule_id AS source_id,
    owner_ai_id,
    remind_at AS planned_at,
    summary,
    claimed_at AS started_at,
    claimed_by_run_id AS run_id,
    julianday(claimed_at) AS started_at_epoch
  FROM raven_cat_ai_schedules
  WHERE owner_ai_id = ?
    AND status = 'claimed'`;

const HISTORY_ROWS = `
  SELECT
    'ai_schedule' AS source_type,
    schedule_id AS source_id,
    owner_ai_id,
    remind_at AS planned_at,
    summary,
    COALESCE(claimed_at, remind_at) AS occurred_at,
    COALESCE(consumed_at, remind_at) AS terminal_at,
    claimed_by_run_id AS run_id,
    CASE WHEN status IN ('scheduled','cancelled') THEN 'unexecuted' ELSE completion_disposition END AS completion_disposition,
    julianday(COALESCE(claimed_at, remind_at)) AS occurred_at_epoch
  FROM raven_cat_ai_schedules
  WHERE owner_ai_id = ?
    AND (status = 'consumed' OR (status = 'cancelled' AND cancelled_reason IN ('expired','merged_schedule','merged_chat'))
      OR (status = 'scheduled' AND julianday(remind_at) <= julianday(?)))`;

export class SQLiteProactiveLifeReadRepository implements ProactiveLifeReadRepository {
  async loadOverview(input: {
    ownerAIId: string;
    now: string;
    historyLimit: number;
  }): Promise<ProactiveLifeOverviewRecord> {
    const db = this.openExecutor('overview');
    // future、running、history 必须来自同一个短快照；Chat anchor 在事务提交后由 application 补齐。
    return db.withExclusiveTransactionAsync(async (tx) => {
      const future = await tx.getFirstAsync<FutureOverviewRow>(
        `WITH unified_future AS (${FUTURE_ROWS})
         SELECT source_type, source_id, owner_ai_id, planned_at, summary,
                COUNT(*) OVER () AS future_count
         FROM unified_future
         ORDER BY planned_at_epoch ASC, source_id ASC
         LIMIT 1`,
        [input.ownerAIId, input.now],
      );
      const runningRows = await tx.getAllAsync<RunningRow>(
        `WITH unified_running AS (${RUNNING_ROWS})
         SELECT source_type, source_id, owner_ai_id, planned_at, summary,
                started_at, run_id
         FROM unified_running
         ORDER BY started_at_epoch ASC, source_id ASC`,
        [input.ownerAIId],
      );
      const history = await queryHistory(tx, {
        ownerAIId: input.ownerAIId,
        now: input.now,
        limit: input.historyLimit,
      });

      return {
        nextFuture: future ? toFutureRecord(future) : null,
        futureCount: future?.future_count ?? 0,
        runningItems: runningRows.map(toRunningRecord),
        recentHistory: history.items,
        historyNextCursor: history.nextCursor,
      };
    });
  }

  async listFuture(input: {
    ownerAIId: string;
    now: string;
    after?: ProactiveLifeFutureCursor | null;
    limit: number;
  }): Promise<ProactiveLifePage<ProactiveLifeFutureRecord, ProactiveLifeFutureCursor>> {
    const cursor = input.after;
    const afterSql = cursor
      ? `WHERE (
           planned_at_epoch > julianday(?)
           OR (
             planned_at_epoch = julianday(?)
           AND source_id > ?
           )
         )`
      : '';
    const params: (string | number)[] = [
      input.ownerAIId,
      input.now,
    ];
    if (cursor) {
      params.push(cursor.plannedAt, cursor.plannedAt, cursor.sourceId);
    }
    params.push(input.limit + 1);

    const rows = await this.openExecutor('future').getAllAsync<FutureRow>(
      `WITH unified_future AS (${FUTURE_ROWS})
       SELECT source_type, source_id, owner_ai_id, planned_at, summary
       FROM unified_future
       ${afterSql}
       ORDER BY planned_at_epoch ASC, source_id ASC
       LIMIT ?`,
      params,
    );
    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const items = pageRows.map(toFutureRecord);
    const last = items[items.length - 1];
    return {
      items,
      hasMore,
      nextCursor: hasMore && last ? toFutureCursor(last) : null,
    };
  }

  async listHistory(input: {
    now: string;
    ownerAIId: string;
    before?: ProactiveLifeHistoryCursor | null;
    limit: number;
  }): Promise<ProactiveLifePage<ProactiveLifeHistoryRecord, ProactiveLifeHistoryCursor>> {
    return queryHistory(this.openExecutor('history'), input);
  }

  private openExecutor(operation: string) {
    return databaseCoordinator.openTaskExecutor({
      name: `companion.proactiveLife.${operation}`,
      feature: 'companion',
      priority: 'interactive',
    });
  }
}

function toFutureRecord(row: FutureRow): ProactiveLifeFutureRecord {
  return {
    sourceType: row.source_type,
    sourceId: row.source_id,
    ownerAIId: row.owner_ai_id,
    plannedAt: row.planned_at,
    summary: row.summary,
  };
}

function toRunningRecord(row: RunningRow): ProactiveLifeRunningRecord {
  return {
    sourceType: row.source_type,
    sourceId: row.source_id,
    ownerAIId: row.owner_ai_id,
    plannedAt: row.planned_at,
    summary: row.summary,
    startedAt: row.started_at,
    runId: row.run_id,
  };
}

function toHistoryRecord(row: HistoryRow): ProactiveLifeHistoryRecord {
  return {
    sourceType: row.source_type,
    sourceId: row.source_id,
    ownerAIId: row.owner_ai_id,
    plannedAt: row.planned_at,
    summary: row.summary,
    occurredAt: row.occurred_at,
    terminalAt: row.terminal_at,
    runId: row.run_id,
    completionDisposition: toCompletionDisposition(row.completion_disposition),
  };
}

function toFutureCursor(item: ProactiveLifeFutureRecord): ProactiveLifeFutureCursor {
  return {
    plannedAt: item.plannedAt,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
  };
}

function toHistoryCursor(item: ProactiveLifeHistoryRecord): ProactiveLifeHistoryCursor {
  return {
    occurredAt: item.occurredAt,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
  };
}

type HistoryQueryExecutor = Pick<DatabaseReadExecutor, 'getAllAsync'>;

async function queryHistory(
  db: HistoryQueryExecutor,
  input: {
    now: string;
    ownerAIId: string;
    before?: ProactiveLifeHistoryCursor | null;
    limit: number;
  },
): Promise<ProactiveLifePage<ProactiveLifeHistoryRecord, ProactiveLifeHistoryCursor>> {
  const cursor = input.before;
  const beforeSql = cursor
    ? `WHERE (
         occurred_at_epoch < julianday(?)
         OR (
           occurred_at_epoch = julianday(?)
           AND source_id < ?
         )
       )`
    : '';
  const params: (string | number)[] = [input.ownerAIId, input.now];
  if (cursor) {
    params.push(cursor.occurredAt, cursor.occurredAt, cursor.sourceId);
  }
  params.push(input.limit + 1);

  const rows = await db.getAllAsync<HistoryRow>(
    `WITH unified_history AS (${HISTORY_ROWS})
     SELECT source_type, source_id, owner_ai_id, planned_at, summary,
            occurred_at, terminal_at, run_id, completion_disposition
     FROM unified_history
     ${beforeSql}
     ORDER BY occurred_at_epoch DESC, source_id DESC
     LIMIT ?`,
    params,
  );
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const items = pageRows.map(toHistoryRecord);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? toHistoryCursor(last) : null,
  };
}

function toCompletionDisposition(value: string): ProactiveLifeCompletionDisposition {
  if (value === 'unexecuted') return 'unexecuted';
  if (value === 'agent_terminal') return 'completed';
  if (value === 'interrupted') return 'interrupted';
  throw new Error(`SQLite AI Schedule completion_disposition 非法：${value}`);
}

export const proactiveLifeReadRepository = new SQLiteProactiveLifeReadRepository();
