/** 普通聊天 AI 回复执行宿主：通过 Headless JS 任务 Service 在后台执行对话轮次。 */
import { requireNativeModule } from 'expo-modules-core';

declare class ConversationTurnRuntimeNativeModule {
  startHostRelationshipReplyTask(aiId: string, change: string, occurredAt: string): Promise<boolean>;
  waitForExecutionStop(hostId: string): Promise<string>;
  finishExecution(hostId: string): Promise<void>;
  getExecutionRemainingTime(hostId: string): Promise<number>;
  startConversationTurnTask(
    sessionIds: string[],
    correlationId: string | null,
    deliveryTiming: string | null
  ): Promise<boolean>;
}

const nativeModule = requireNativeModule<ConversationTurnRuntimeNativeModule>(
  'ConversationTurnRuntime'
);

export const waitForConversationExecutionStop = (hostId: string) => nativeModule.waitForExecutionStop(hostId);
export const finishConversationExecution = (hostId: string) => nativeModule.finishExecution(hostId);
export const getConversationExecutionRemainingTime = (hostId: string) => nativeModule.getExecutionRemainingTime(hostId);

/** 身份变更由用户操作触发，原生宿主持有完整回复期；不生成伪造的用户聊天消息。 */
export function startHostRelationshipReplyTask(aiId: string, change: 'appointed' | 'revoked', occurredAt: string): Promise<boolean> {
  return nativeModule.startHostRelationshipReplyTask(aiId, change, occurredAt);
}

/**
 * 启动一次对话轮次执行的 Headless JS 任务；多个会话在任务内串行执行。
 * 返回 true 表示 Service 已进入前台执行期；拒绝或启动回执超时返回 false。
 * 待回复事实仍留在持久化游标/高水位中，由启动恢复或后续触发按 orphan 语义接管。
 */
export function startConversationTurnTask(
  sessionIds: string[],
  options?: { correlationId?: string | null; deliveryTiming?: 'paced' | 'immediate' | null }
): Promise<boolean> {
  return nativeModule.startConversationTurnTask(
    sessionIds,
    options?.correlationId ?? null,
    options?.deliveryTiming ?? null
  );
}
