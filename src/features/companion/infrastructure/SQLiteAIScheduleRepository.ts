/** 使用 SQLite 保存 AI Schedule 真值，并原子提交 update/cancel/claim/consume。 */

import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import {
  createAISchedule,
  createAIScheduleFromRow,
  AI_SCHEDULE_CANCELLED_REASON_OWNER_REVOKED,
  type AISchedule,
  type AIScheduleCompletionDisposition,
  type AIScheduleRow,
} from '../domain/AISchedule';
import type {
  AIScheduleCommandErrorCode,
  AIScheduleCommandOutcome,
  AIScheduleListItem,
  AIScheduleListPage,
  AIScheduleRepository,
  ListAISchedulesInput,
  UpdateAIScheduleInput,
} from '../domain/AIScheduleRepository';
import { COMPANION_STATE_ID, type CompanionStateRow } from '../domain/CompanionState';

export class SQLiteAIScheduleRepository implements AIScheduleRepository {
  async createScheduled(
    data: AISchedule,
    occurredAt: string,
  ): Promise<AIScheduleCommandOutcome<'created'>> {
    const schedule = createAISchedule(data);
    if (schedule.status !== 'scheduled') {
      throw new Error('createScheduled 只接受 scheduled AI Schedule');
    }
    if (Date.parse(schedule.remindAt) <= Date.parse(occurredAt)) {
      return { status: 'invalid_time' };
    }
    return this.openExecutor('create').withExclusiveTransactionAsync(async (tx) => {
      const authority = await this.validateCompanionAuthority(tx, schedule.ownerAIId);
      if (authority) return { status: authority };
      await tx.runAsync(
        `INSERT INTO raven_cat_ai_schedules (
         schedule_id, owner_ai_id, remind_at, summary, details,
         source_conversation_id, source_message_ids_json, source_excerpt,
         status, claimed_by_run_id, claimed_at, consumed_at, completion_disposition, cancelled_at,
         cancelled_reason, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        toValues(schedule),
      );
      return { status: 'created', schedule };
    });
  }

  async getByScheduleId(scheduleId: string): Promise<AISchedule | null> {
    return this.getByScheduleIdWithExecutor(this.openExecutor('get'), scheduleId);
  }

  async list(input: ListAISchedulesInput): Promise<AIScheduleListPage> {
    const conditions = [
      'owner_ai_id = ?',
      'remind_at >= ?',
      'remind_at < ?',
    ];
    const params: (string | number)[] = [input.ownerAIId, input.from, input.to];
    if (input.status) {
      conditions.push('status = ?');
      params.push(input.status);
    }
    if (input.after) {
      conditions.push('(remind_at > ? OR (remind_at = ? AND schedule_id > ?))');
      params.push(input.after.remindAt, input.after.remindAt, input.after.scheduleId);
    }
    params.push(input.limit + 1);
    const rows = await this.openExecutor('list').getAllAsync<AIScheduleRow>(
      `SELECT * FROM raven_cat_ai_schedules
       WHERE ${conditions.join(' AND ')}
       ORDER BY remind_at ASC, schedule_id ASC
       LIMIT ?`,
      params,
    );
    const hasMore = rows.length > input.limit;
    const schedules = (hasMore ? rows.slice(0, input.limit) : rows)
      .map((row) => createAIScheduleFromRow(row)!);
    const items: AIScheduleListItem[] = schedules.map((schedule) => ({
      scheduleId: schedule.scheduleId,
      remindAt: schedule.remindAt,
      summary: schedule.summary,
      status: schedule.status,
    }));
    const last = items[items.length - 1];
    return {
      items,
      hasMore,
      nextCursor: hasMore && last
        ? { remindAt: last.remindAt, scheduleId: last.scheduleId }
        : null,
    };
  }

  async updateScheduled(
    input: UpdateAIScheduleInput,
  ): Promise<AIScheduleCommandOutcome<'updated'>> {
    return this.openExecutor('update').withExclusiveTransactionAsync(async (tx) => {
      const authority = await this.validateCompanionAuthority(tx, input.ownerAIId);
      if (authority) return { status: authority };
      const current = await this.getByScheduleIdWithExecutor(tx, input.scheduleId);
      const invalid = classifyMutableSchedule(current, input.ownerAIId, input.occurredAt);
      if (invalid) return { status: invalid };
      if (input.remindAt && Date.parse(input.remindAt) <= Date.parse(input.occurredAt)) {
        return { status: 'invalid_time' };
      }

      const next = createAISchedule({
        ...current!,
        remindAt: input.remindAt ?? current!.remindAt,
        summary: input.summary ?? current!.summary,
        details: input.details ?? current!.details,
        updatedAt: input.occurredAt,
      });
      const result = await tx.runAsync(
        `UPDATE raven_cat_ai_schedules
         SET remind_at = ?, summary = ?, details = ?, updated_at = ?
         WHERE schedule_id = ? AND owner_ai_id = ?
           AND status = 'scheduled' AND remind_at > ?`,
        [
          next.remindAt,
          next.summary,
          next.details,
          next.updatedAt,
          input.scheduleId,
          input.ownerAIId,
          input.occurredAt,
        ],
      );
      if (result.changes !== 1) {
        throw new Error('AI Schedule update 原子条件在 exclusive transaction 内失效');
      }
      return { status: 'updated', schedule: next };
    });
  }

  async cancelScheduled(input: {
    scheduleId: string;
    ownerAIId: string;
    occurredAt: string;
  }): Promise<AIScheduleCommandOutcome<'cancelled'>> {
    return this.openExecutor('cancel').withExclusiveTransactionAsync(async (tx) => {
      const current = await this.getByScheduleIdWithExecutor(tx, input.scheduleId);
      const invalid = classifyMutableSchedule(current, input.ownerAIId, input.occurredAt);
      if (invalid) return { status: invalid };
      const result = await tx.runAsync(
        `UPDATE raven_cat_ai_schedules
         SET status = 'cancelled', cancelled_at = ?, updated_at = ?
         WHERE schedule_id = ? AND owner_ai_id = ?
           AND status = 'scheduled' AND remind_at > ?`,
        [input.occurredAt, input.occurredAt, input.scheduleId, input.ownerAIId, input.occurredAt],
      );
      if (result.changes !== 1) {
        throw new Error('AI Schedule cancel 原子条件在 exclusive transaction 内失效');
      }
      return {
        status: 'cancelled',
        schedule: createAISchedule({
          ...current!,
          status: 'cancelled',
          cancelledAt: input.occurredAt,
          updatedAt: input.occurredAt,
        }),
      };
    });
  }

  async claimScheduled(input: {
    scheduleId: string;
    ownerAIId: string;
    runId: string;
    claimedAt: string;
    expectedRemindAt: string;
    projectionToken: string;
  }): Promise<AIScheduleCommandOutcome<'claimed'>> {
    return this.openExecutor('claim').withExclusiveTransactionAsync(async (tx) => {
      const authority = await this.validateCompanionAuthority(tx, input.ownerAIId);
      if (authority) return { status: authority };
      const current = await this.getByScheduleIdWithExecutor(tx, input.scheduleId);
      if (!current) return { status: 'not_found' };
      if (current.ownerAIId !== input.ownerAIId) return { status: 'not_owner' };
      if (current.status === 'claimed') return { status: 'already_claimed' };
      if (current.status !== 'scheduled') return { status: 'not_scheduled' };
      if (current.remindAt !== input.expectedRemindAt) return { status: 'stale_projection' };
      if (current.updatedAt !== input.projectionToken) return { status: 'stale_projection' };
      if (Date.parse(current.remindAt) > Date.parse(input.claimedAt)) return { status: 'not_due' };

      // due-time CAS 作为最终并发边界：只允许 scheduled → claimed 且版本完全匹配。
      const result = await tx.runAsync(
        `UPDATE raven_cat_ai_schedules
         SET status = 'claimed', claimed_by_run_id = ?, claimed_at = ?, updated_at = ?
         WHERE schedule_id = ? AND owner_ai_id = ? AND status = 'scheduled'
           AND remind_at = ? AND updated_at = ? AND remind_at <= ?`,
        [
          input.runId,
          input.claimedAt,
          input.claimedAt,
          input.scheduleId,
          input.ownerAIId,
          input.expectedRemindAt,
          input.projectionToken,
          input.claimedAt,
        ],
      );
      if (result.changes !== 1) return { status: 'already_claimed' };
      return {
        status: 'claimed',
        schedule: (await this.getByScheduleIdWithExecutor(tx, input.scheduleId))!,
      };
    });
  }

  async consumeClaimed(input: {
    scheduleId: string;
    runId: string;
    consumedAt: string;
    completionDisposition: AIScheduleCompletionDisposition;
  }): Promise<AIScheduleCommandOutcome<'consumed'>> {
    return this.openExecutor('consume').withExclusiveTransactionAsync(async (tx) => {
      const current = await this.getByScheduleIdWithExecutor(tx, input.scheduleId);
      if (!current) return { status: 'not_found' };
      if (current.status === 'consumed') {
        return {
          status: current.claimedByRunId === input.runId
            ? 'already_terminal'
            : 'run_mismatch',
        };
      }
      if (current.status !== 'claimed') return { status: 'not_claimed' };
      if (current.claimedByRunId !== input.runId) return { status: 'run_mismatch' };
      const result = await tx.runAsync(
        `UPDATE raven_cat_ai_schedules
         SET status = 'consumed', consumed_at = ?, completion_disposition = ?, updated_at = ?
         WHERE schedule_id = ? AND status = 'claimed' AND claimed_by_run_id = ?`,
        [
          input.consumedAt,
          input.completionDisposition,
          input.consumedAt,
          input.scheduleId,
          input.runId,
        ],
      );
      if (result.changes !== 1) {
        throw new Error('AI Schedule consume 原子条件在 exclusive transaction 内失效');
      }
      return {
        status: 'consumed',
        schedule: (await this.getByScheduleIdWithExecutor(tx, input.scheduleId))!,
      };
    });
  }

  async listAllScheduled(): Promise<AISchedule[]> {
    const rows = await this.openExecutor('listAllScheduled').getAllAsync<AIScheduleRow>(
      `SELECT * FROM raven_cat_ai_schedules WHERE status = 'scheduled' ORDER BY remind_at ASC, schedule_id ASC`,
    );
    return rows.map((row) => createAIScheduleFromRow(row)!);
  }

  async listAllClaimed(): Promise<AISchedule[]> {
    const rows = await this.openExecutor('listAllClaimed').getAllAsync<AIScheduleRow>(
      `SELECT * FROM raven_cat_ai_schedules
       WHERE status = 'claimed'
       ORDER BY schedule_id ASC`,
    );
    return rows.map((row) => createAIScheduleFromRow(row)!);
  }

  async terminalizeScheduledForOwnerInvalidation(input: {
    scheduleId: string;
    occurredAt: string;
  }): Promise<AIScheduleCommandOutcome<'cancelled'>> {
    return this.openExecutor('terminalize').withExclusiveTransactionAsync(async (tx) => {
      const current = await this.getByScheduleIdWithExecutor(tx, input.scheduleId);
      if (!current) return { status: 'not_found' };
      if (current.status !== 'scheduled') return { status: 'not_scheduled' };
      const result = await tx.runAsync(
        `UPDATE raven_cat_ai_schedules
         SET status = 'cancelled', cancelled_at = ?, cancelled_reason = ?, updated_at = ?
         WHERE schedule_id = ? AND status = 'scheduled'`,
        [
          input.occurredAt,
          AI_SCHEDULE_CANCELLED_REASON_OWNER_REVOKED,
          input.occurredAt,
          input.scheduleId,
        ],
      );
      if (result.changes !== 1) {
        throw new Error('AI Schedule owner invalidation 原子条件在 exclusive transaction 内失效');
      }
      return {
        status: 'cancelled',
        schedule: (await this.getByScheduleIdWithExecutor(tx, input.scheduleId))!,
      };
    });
  }

  /** 开关与 claim/create/update 共用数据库快照，关闭后的迟到回调不能取得执行权。 */
  private async validateCompanionAuthority(
    tx: DatabaseTransactionExecutor, ownerAIId: string,
  ): Promise<'companion_disabled' | 'not_owner' | null> {
    const state = await tx.getFirstAsync<CompanionStateRow>(
      'SELECT * FROM raven_cat_companion_state WHERE id = ?', [COMPANION_STATE_ID],
    );
    if (!state || state.desired_enabled === 0) return 'companion_disabled';
    return state.host_ai_id === ownerAIId ? null : 'not_owner';
  }

  private openExecutor(operation: string) {
    return databaseCoordinator.openTaskExecutor({
      name: `companion.aiSchedule.${operation}`,
      feature: 'companion',
      priority: 'runtime',
    });
  }

  private async getByScheduleIdWithExecutor(
    db: Pick<DatabaseTransactionExecutor, 'getFirstAsync'>,
    scheduleId: string,
  ): Promise<AISchedule | null> {
    const row = await db.getFirstAsync<AIScheduleRow>(
      'SELECT * FROM raven_cat_ai_schedules WHERE schedule_id = ? LIMIT 1',
      [scheduleId],
    );
    return createAIScheduleFromRow(row);
  }
}

function classifyMutableSchedule(
  schedule: AISchedule | null,
  ownerAIId: string,
  occurredAt: string,
): AIScheduleCommandErrorCode | null {
  if (!schedule) return 'not_found';
  if (schedule.ownerAIId !== ownerAIId) return 'not_owner';
  if (schedule.status !== 'scheduled') return 'not_scheduled';
  if (Date.parse(schedule.remindAt) <= Date.parse(occurredAt)) return 'already_past';
  return null;
}

function toValues(schedule: AISchedule): (string | null)[] {
  return [
    schedule.scheduleId,
    schedule.ownerAIId,
    schedule.remindAt,
    schedule.summary,
    schedule.details,
    schedule.sourceConversationId,
    schedule.sourceMessageIds ? JSON.stringify(schedule.sourceMessageIds) : null,
    schedule.sourceExcerpt,
    schedule.status,
    schedule.claimedByRunId,
    schedule.claimedAt,
    schedule.consumedAt,
    schedule.completionDisposition,
    schedule.cancelledAt,
    schedule.cancelledReason,
    schedule.createdAt,
    schedule.updatedAt,
  ];
}

export const aiScheduleRepository = new SQLiteAIScheduleRepository();
