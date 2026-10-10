/**
 * 群聊发言 plan 的强制终止 command。
 *
 * 与用户消息换代（supersede）是两套语义：终止不创建 successor、不计算继承
 * 队列，清掉该 plan 的全部后续发言机会。顺序必须是先持久撤销资格（plan 与
 * queued/running 任务在同一事务内裁决为 terminated 终态），commit 后再 abort
 * 在途请求——abort 只节约模型/网络资源，晚到输出的落库资格已被持久化 fence
 * 撤销。
 */

import { getChatGroupRuntimeDependencies } from './ChatGroupRuntime';
import { abortGroupSpeechPlanExecution } from './GroupSpeechExecutionAbort';
import { cancelGroupAutoInvocation } from './GroupAutoInvocationScheduler';
import { emitChatGroupSpeechPlanChanged } from '../../messages/events/ChatEvents';

/** 返回 true 表示确实终止了一个 active plan；无 active plan 时返回 false。 */
export async function terminateGroupSpeechPlan(groupId: string): Promise<boolean> {
  const terminatedPlanId = await getChatGroupRuntimeDependencies()
    .groups.terminateActiveSpeechPlan(groupId);
  if (!terminatedPlanId) {
    return false;
  }
  emitChatGroupSpeechPlanChanged(groupId);
  // 以下都是 commit 后的资源节约副作用，不影响已裁决的持久事实：
  // 中止在途请求；取消 30 秒自动召唤计时，避免被终止的输入窗口再次触发召唤。
  abortGroupSpeechPlanExecution(terminatedPlanId);
  cancelGroupAutoInvocation(groupId);
  return true;
}
