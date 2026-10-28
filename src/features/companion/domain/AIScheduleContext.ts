/** 日程处理结果的上下文交接凭据，不是待执行任务或唤醒队列。 */
export interface AIScheduleContextItem {
  scheduleId: string;
  remindAt: string;
  summary: string;
  details: string;
  sourceExcerpt: string | null;
  reason: string;
  targetScheduleId: string | null;
  presentedRunId: string | null;
}

export interface AIScheduleDispatchInput {
  scheduleId: string;
  ownerAIId: string;
  expectedRemindAt: string;
  projectionToken: string;
  occurredAt: string;
}
