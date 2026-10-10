import type { TogetherListeningActivity } from '../domain/TogetherListeningActivity';
import { getTogetherListeningRuntimeDependencies } from './TogetherListeningRuntime';

/** Together Listening 真值投影到 Android 系统通知所需的最小稳定事实。 */
export interface TogetherListeningSystemPresentationState {
  activityId: string;
  hostAiId: string;
  chatSessionId: string;
  activatedAtEpochMs: number;
  aiName: string;
  aiAvatar: string | null;
}

/**
 * 将已提交 Activity 收敛到系统 presentation。
 *
 * 本函数只做投影：失败不能回滚 Activity，也不能改变 Chat projectionStatus。
 */
export async function projectTogetherListeningSystemPresentation(
  activity: TogetherListeningActivity,
): Promise<void> {
  const runtime = getTogetherListeningRuntimeDependencies();
  if (activity.phase !== 'active') {
    // pending 是当前 Activity，必须清掉崩溃遗留的任意旧 presentation；终态只撤销
    // 自己的 identity，避免迟到的旧 transition 误撤销已经建立的新 Activity surface。
    await runtime.systemPresentation.cancelPresentation(
      activity.phase === 'pending_user_response' || activity.phase === 'pending_ai_response'
        ? undefined
        : activity.id,
    );
    return;
  }

  const activatedAtEpochMs = activity.activatedAtEpochMs;
  if (activatedAtEpochMs === null) {
    throw new Error(`active Together Listening 缺少 activatedAtEpochMs：${activity.id}`);
  }
  const identity = await runtime.resolveSystemPresentationAIIdentity(activity.hostAiId);
  if (!identity) {
    throw new Error(`Together Listening Host AI 不存在：${activity.hostAiId}`);
  }

  await runtime.systemPresentation.upsertActivePresentation({
    activityId: activity.id,
    hostAiId: activity.hostAiId,
    chatSessionId: activity.chatSessionId,
    activatedAtEpochMs,
    aiName: identity.name,
    aiAvatar: identity.avatar,
  });
}
