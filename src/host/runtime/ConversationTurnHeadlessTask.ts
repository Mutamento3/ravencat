/**
 * ConversationTurnExecutionTask —— 普通聊天 canonical user_reply 的 Android execution host。
 *
 * 页面 runtime 在 T1 commit 后只负责启动原生 Headless service；本任务在具备
 * Android 后台生命周期的 runtime 中 claim 并等待 run 到达 terminal，
 * 执行链路仍是 executeUserReplyTurn → processAIReply（不复制回复业务流程）。
 * 启动恢复（recovery）同样只发现待恢复会话并委派本任务，多个会话在此串行执行。
 * 真机证据见 95205b9：Activity 不可见后页面 fire-and-forget 回调会被冻结。
 */
import { AppState } from 'react-native';
import { emitChatMessagesUpdated } from '@features/chat/composition';
import { logTurnTimeline } from '@shared/diagnostics/TurnTimelineLog';
import { ensureHostDatabaseReady } from '../composition/ensureHostDatabaseReady';
import { getConversationTurnCoordinator } from './ConversationTurnCoordinator';

interface ConversationTurnTaskData {
  sessionIds?: string[];
  correlationId?: string;
  deliveryTiming?: 'paced' | 'immediate';
  createdAtEpochMs?: number;
}

export async function runConversationTurnHeadlessTask(
  data: ConversationTurnTaskData,
): Promise<void> {
  const sessionIds = (data.sessionIds ?? [])
    .map((sessionId) => sessionId?.trim())
    .filter((sessionId): sessionId is string => Boolean(sessionId));
  if (sessionIds.length === 0) {
    throw new Error('ConversationTurnExecutionTask 缺少 sessionIds');
  }
  const correlationId = data.correlationId?.trim() || undefined;

  await ensureHostDatabaseReady();

  // 后台 runtime 的 setTimeout 会被冻结：后台执行一律 immediate，跳过 paced 分段定时器。
  const deliveryTiming = AppState.currentState === 'active'
    ? data.deliveryTiming
    : 'immediate';

  // 串行执行：recovery 批量场景下模型请求并发有界（=1），claim/orphan 判定在
  // executeTurnFromHost 内按会话独立进行，事实以持久化 fence 为准。
  for (const sessionId of sessionIds) {
    logTurnTimeline('execution_host_started', {
      sessionId,
      correlationId,
    });
    const result = await getConversationTurnCoordinator().executeTurnFromHost(sessionId, {
      correlationId,
      deliveryTiming,
      replyCallbacks: {
        notifyUI: emitChatMessagesUpdated,
      },
    });
    console.info('[ConversationTurnExecutionTask] session completed', {
      sessionId,
      correlationId: correlationId ?? null,
      result,
    });
  }
}
