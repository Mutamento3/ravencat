/**
 * AI 回复回合的低噪声时间线诊断：用 runId / correlationId 串联一轮回复的关键里程碑，
 * 供真机区分「模型首 token 慢 / 网络流慢 / JS runtime 冻结 / T3 commit 等待 / 通知延迟」。
 * 只输出事件名与 id，禁止输出 prompt、API key、消息正文等隐私内容。
 */

export type TurnTimelineEvent =
  | 'user_message_committed'
  | 'execution_host_started'
  | 'turn_claimed'
  | 'model_request_started'
  | 'first_delta_received'
  | 'model_stream_completed'
  | 'assistant_turn_committed'
  | 'notification_enqueued'
  | 'notification_suppressed'
  | 'notification_failed';

export interface TurnTimelineContext {
  sessionId?: string;
  runId?: string;
  correlationId?: string;
}

export function logTurnTimeline(
  event: TurnTimelineEvent,
  context: TurnTimelineContext = {},
): void {
  console.info(`[TurnTimeline] ${event}`, {
    sessionId: context.sessionId ?? null,
    runId: context.runId ?? null,
    correlationId: context.correlationId ?? null,
    atEpochMs: Date.now(),
  });
}
