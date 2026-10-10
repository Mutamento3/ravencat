/** 普通聊天 AI 回复执行宿主：通过 Headless JS 任务 Service 在后台执行对话轮次。 */
import { requireNativeModule } from 'expo-modules-core';

declare class ConversationTurnRuntimeNativeModule {
  startConversationTurnTask(
    sessionIds: string[],
    correlationId: string | null,
    deliveryTiming: string | null
  ): Promise<boolean>;
}

const nativeModule = requireNativeModule<ConversationTurnRuntimeNativeModule>(
  'ConversationTurnRuntime'
);

/**
 * 启动一次对话轮次执行的 Headless JS 任务；多个会话在任务内串行执行。
 * 返回 false 表示原生侧未能启动（React context 缺失或系统拒绝 startService）；
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
