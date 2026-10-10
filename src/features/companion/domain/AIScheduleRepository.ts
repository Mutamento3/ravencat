/** AI Schedule 持久端口；所有状态迁移与时间事实裁决均由实现原子提交。 */

import type {
  AISchedule,
  AIScheduleCompletionDisposition,
  AIScheduleStatus,
} from './AISchedule';

export type AIScheduleCommandErrorCode =
  | 'companion_disabled'
  | 'not_found'
  | 'not_owner'
  | 'not_scheduled'
  | 'not_claimed'
  | 'already_past'
  | 'invalid_time'
  | 'already_claimed'
  | 'already_terminal'
  | 'run_mismatch'
  | 'not_due'
  | 'stale_projection';

export interface AIScheduleListCursor {
  remindAt: string;
  scheduleId: string;
}

export interface AIScheduleListItem {
  scheduleId: string;
  remindAt: string;
  summary: string;
  status: AIScheduleStatus;
}

export interface ListAISchedulesInput {
  ownerAIId: string;
  from: string;
  to: string;
  status?: AIScheduleStatus;
  after?: AIScheduleListCursor | null;
  limit: number;
}

export interface AIScheduleListPage {
  items: AIScheduleListItem[];
  nextCursor: AIScheduleListCursor | null;
  hasMore: boolean;
}

export type AIScheduleCommandOutcome<TStatus extends string> =
  | { status: TStatus; schedule: AISchedule }
  | { status: AIScheduleCommandErrorCode };

export interface UpdateAIScheduleInput {
  scheduleId: string;
  ownerAIId: string;
  occurredAt: string;
  remindAt?: string;
  summary?: string;
  details?: string;
}

export interface AIScheduleRepository {
  createScheduled(schedule: AISchedule, occurredAt: string): Promise<
    AIScheduleCommandOutcome<'created'>
  >;
  getByScheduleId(scheduleId: string): Promise<AISchedule | null>;
  list(input: ListAISchedulesInput): Promise<AIScheduleListPage>;
  updateScheduled(input: UpdateAIScheduleInput): Promise<
    AIScheduleCommandOutcome<'updated'>
  >;
  cancelScheduled(input: {
    scheduleId: string;
    ownerAIId: string;
    occurredAt: string;
  }): Promise<AIScheduleCommandOutcome<'cancelled'>>;
  claimScheduled(input: {
    scheduleId: string;
    ownerAIId: string;
    runId: string;
    claimedAt: string;
    /** callback 携带的 durable 版本期望：与当前 remind_at 不一致即拒绝（stale_projection）。 */
    expectedRemindAt: string;
    /** 与 callback 一起携带的 durable 版本 token（updated_at）；不一致即拒绝。 */
    projectionToken: string;
  }): Promise<AIScheduleCommandOutcome<'claimed'>>;
  consumeClaimed(input: {
    scheduleId: string;
    runId: string;
    consumedAt: string;
    /** consume 与 completionDisposition 必须由同一个 SQLite transaction 提交。 */
    completionDisposition: AIScheduleCompletionDisposition;
  }): Promise<AIScheduleCommandOutcome<'consumed'>>;
  /** 供 projection reconcile 读取全部 scheduled 真值（不依赖 owner 或时间范围）。 */
  listAllScheduled(): Promise<AISchedule[]>;
  /**
   * 读取所有尚未收口的 claim，供进程重启 / 前台恢复使用。
   * 返回值是 durable snapshot；真正收口仍必须重新用 scheduleId + runId CAS。
   */
  listAllClaimed(): Promise<AISchedule[]>;
  /**
   * 系统级 authority invalidation：owner 已不再是当前主理 AI 时终结该 schedule。
   * 与用户 / AI cancel 不同，这里不要求 `now < remindAt`，也不改写 owner identity。
   */
  terminalizeScheduledForOwnerInvalidation(input: {
    scheduleId: string;
    occurredAt: string;
  }): Promise<AIScheduleCommandOutcome<'cancelled'>>;
}
