/** App JS 进程存活期间的群聊自动召唤调度；页面路由不拥有计时器。 */

const AUTO_INVOCATION_DELAY_MS = 30_000;

export interface GroupInvocationResult {
  success: boolean;
  error: string | null;
  planId: string | null;
  outcome: 'completed' | 'already_running' | 'no_messages' | 'not_found' | 'failed';
}

interface ScheduledGroupInvocation {
  latestUserMessageId: number;
  dueAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  invoke: () => Promise<GroupInvocationResult>;
}

const scheduledByGroupId = new Map<string, ScheduledGroupInvocation>();

export function scheduleGroupAutoInvocation(params: {
  groupId: string;
  latestUserMessageId: number;
  invoke: () => Promise<GroupInvocationResult>;
}): void {
  const existing = scheduledByGroupId.get(params.groupId);
  if (existing?.timer !== null && existing?.timer !== undefined) {
    clearTimeout(existing.timer);
  }

  const scheduled: ScheduledGroupInvocation = {
    latestUserMessageId: params.latestUserMessageId,
    dueAt: Date.now() + AUTO_INVOCATION_DELAY_MS,
    timer: null,
    invoke: params.invoke,
  };
  scheduledByGroupId.set(params.groupId, scheduled);
  armScheduledInvocation(params.groupId, scheduled);
}

/** 当前计划已固定到该消息时，手动或自动召唤都可取消对应计时。 */
export function acknowledgeGroupInvocationInput(
  groupId: string,
  inputUpperBoundMessageId: number,
): void {
  const scheduled = scheduledByGroupId.get(groupId);
  if (!scheduled || scheduled.latestUserMessageId > inputUpperBoundMessageId) {
    return;
  }
  cancelGroupAutoInvocation(groupId);
}

/** 活动计划结束后，继续处理执行期间新提交且已到期的用户消息。 */
export function notifyGroupInvocationSettled(groupId: string): void {
  const scheduled = scheduledByGroupId.get(groupId);
  if (!scheduled || scheduled.timer !== null) {
    return;
  }
  armScheduledInvocation(groupId, scheduled);
}

export function cancelGroupAutoInvocation(groupId: string): void {
  const scheduled = scheduledByGroupId.get(groupId);
  if (scheduled?.timer !== null && scheduled?.timer !== undefined) {
    clearTimeout(scheduled.timer);
  }
  scheduledByGroupId.delete(groupId);
}

function armScheduledInvocation(
  groupId: string,
  scheduled: ScheduledGroupInvocation,
): void {
  const delay = Math.max(0, scheduled.dueAt - Date.now());
  scheduled.timer = setTimeout(() => {
    if (scheduledByGroupId.get(groupId) !== scheduled) {
      return;
    }
    scheduled.timer = null;
    void scheduled.invoke().then((result) => {
      if (scheduledByGroupId.get(groupId) !== scheduled) {
        return;
      }
      if (result.outcome !== 'already_running') {
        scheduledByGroupId.delete(groupId);
      }
    }).catch(() => {
      if (scheduledByGroupId.get(groupId) === scheduled) {
        scheduledByGroupId.delete(groupId);
      }
    });
  }, delay);
}
