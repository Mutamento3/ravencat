/**
 * canonical user_reply 的 Android-backed execution host 触发口：
 * 页面 runtime 在 T1 commit 后调用本模块启动 Headless JS service，
 * 由具备 Android 后台生命周期的原生 service 持有回复执行，不依赖 React 页面存活。
 */
import { startConversationTurnTask, startHostRelationshipReplyTask } from '../../../modules/conversation-turn-runtime';
export { waitForConversationExecutionStop, finishConversationExecution, getConversationExecutionRemainingTime } from '../../../modules/conversation-turn-runtime';

/** 用户身份操作的即时唤醒，不借用 canonical 用户消息或页面执行。 */
export const startHostRelationshipReplyExecution = startHostRelationshipReplyTask;

export interface ConversationTurnExecutionStartOptions {
  correlationId?: string | null;
  deliveryTiming?: 'paced' | 'immediate' | null;
}

/**
 * 启动会话回合 execution host（Headless JS）；多个会话在同一任务内串行执行。
 * 返回系统是否接受启动；拒绝时待回复事实仍留在持久化游标/高水位中，
 * 由后续 execution host 触发或启动恢复按 orphan 语义接管，不做页面内兜底执行。
 */
export async function startConversationTurnExecutionHost(
  sessionIds: string[],
  options: ConversationTurnExecutionStartOptions = {},
): Promise<boolean> {
  if (sessionIds.length === 0) {
    return true;
  }
  try {
    return await startConversationTurnTask(sessionIds, options);
  } catch (error) {
    console.warn('[ConversationTurnExecutionHost] 启动 execution host 失败：', {
      sessionIds,
      correlationId: options.correlationId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
