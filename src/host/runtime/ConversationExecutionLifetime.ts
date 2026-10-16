/** 原生截止事件负责取消；任务结束负责释放。这里不 claim、不恢复，也不执行聊天业务。 */
import { waitForConversationExecutionStop, finishConversationExecution, getConversationExecutionRemainingTime } from '@platform/device';
import { logTurnTimeline } from '@shared/diagnostics/TurnTimelineLog';

export interface ConversationExecutionLifetimeData {
  hostId: string;
}

export async function withConversationExecutionLifetime<T>(
  data: ConversationExecutionLifetimeData,
  execute: (context: { signal: AbortSignal; executionDeadlineAt: number }) => Promise<T>,
): Promise<T> {
  if (!data.hostId) throw new Error('聊天执行宿主参数非法');
  const controller = new AbortController();
  const stopped = waitForConversationExecutionStop(data.hostId).then(reason => {
    logTurnTimeline('execution_host_stopped', { hostId: data.hostId });
    if (reason !== 'completed') controller.abort(reason);
  }, error => {
    console.error('[ConversationExecutionLifetime] 原生宿主监督失败', error);
    controller.abort('execution_host_bridge_failed');
  });
  try {
    // 两端都使用单调时钟。以请求时刻计算保守截止点，不受用户改系统时间影响。
    const requestedAt = performance.now();
    const remaining = await getConversationExecutionRemainingTime(data.hostId);
    return await execute({ signal: controller.signal, executionDeadlineAt: requestedAt + remaining });
  } finally {
    await finishConversationExecution(data.hostId);
    await stopped;
  }
}
