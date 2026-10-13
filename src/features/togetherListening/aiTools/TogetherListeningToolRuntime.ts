/** Together Listening AI Tool 的执行时事实读取与 typed result helper。 */

import type { ToolContext, ToolExecuteResult } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import type {
  TogetherListeningActivity,
  TogetherListeningEndReason,
  TogetherListeningPhase,
} from '../domain/TogetherListeningActivity';
import {
  getCurrentTogetherListeningActivity,
  endTogetherListeningActivity,
} from '../application/TogetherListeningLifecycle';
import { getTogetherListeningRuntimeDependencies, type TogetherListeningCurrentLyric } from '../application/TogetherListeningRuntime';
import {
  isExplicitTogetherListeningMediaLoss,
  resolveTogetherListeningNetEaseAvailability,
  readTogetherListeningCurrentLyric,
  type TogetherListeningNetEaseAvailability,
} from '../application/TogetherListeningRuntimeAwareness';

export type TogetherListeningUnavailableReason =
  | 'no_chat_session'
  | 'chat_unavailable'
  | 'stale_host_authority'
  | 'no_active_netease_playback'
  | 'playback_not_eligible'
  | 'observation_unavailable'
  | 'no_pending_user_invitation'
  | 'no_active_together_listening';

export interface TogetherListeningToolResultData {
  status:
    | 'invitation_created'
    | 'activity_in_progress'
    | 'invitation_accepted'
    | 'invitation_declined'
    | 'left'
    | 'unavailable'
    | 'transition_conflict';
  reason?: TogetherListeningUnavailableReason;
  activityId?: string;
  phase?: TogetherListeningPhase | null;
  endReason?: TogetherListeningEndReason | null;
  projectionStatus?: 'projected' | 'failed' | 'deferred' | 'skipped';
  latestHostAiId?: string | null;
  mediaReason?: string;
  currentLyric?: TogetherListeningCurrentLyric | null;
}

export function typedResult(
  data: TogetherListeningToolResultData,
  message: string,
): ToolExecuteResult {
  return { success: true, message, data };
}

export function unavailable(
  reason: TogetherListeningUnavailableReason,
  message: string,
  data: Omit<Partial<TogetherListeningToolResultData>, 'status' | 'reason'> = {},
): ToolExecuteResult {
  return typedResult({ status: 'unavailable', reason, ...data }, message);
}

export async function readCurrentHostAuthority(context: ToolContext): Promise<
  | { authorized: true; hostAiId: string }
  | { authorized: false; result: ToolExecuteResult }
> {
  throwIfAbortSignalAborted(context.abortSignal);
  const latestHostAiId = await getTogetherListeningRuntimeDependencies().getCurrentHostAIId();
  if (!latestHostAiId || context.aiConfig.id !== latestHostAiId) {
    return {
      authorized: false,
      result: unavailable(
        'stale_host_authority',
        '当前 AI 已不再是主理 AI，Together Listening 操作未执行。',
        { latestHostAiId },
      ),
    };
  }
  return { authorized: true, hostAiId: latestHostAiId };
}

export async function readCurrentActivity(): Promise<TogetherListeningActivity | null> {
  return getCurrentTogetherListeningActivity();
}

export async function observeLatestNetEase(): Promise<TogetherListeningNetEaseAvailability> {
  const runtime = getTogetherListeningRuntimeDependencies();
  return resolveTogetherListeningNetEaseAvailability(await runtime.observeNetEasePlayback());
}

export function readLatestCurrentLyric(availability: TogetherListeningNetEaseAvailability) {
  return readTogetherListeningCurrentLyric(availability, getTogetherListeningRuntimeDependencies().nowEpochMs());
}

export function mapMediaUnavailable(
  availability: TogetherListeningNetEaseAvailability,
): ToolExecuteResult {
  if (!('reason' in availability)) {
    throw new Error('可用的网易云 observation 不能映射成 unavailable');
  }
  const reason = availability.reason === 'no_active_session'
    || availability.reason === 'playback_stopped'
    || availability.reason === 'playback_none'
    || availability.reason === 'playback_error'
    ? 'no_active_netease_playback'
    : availability.reason === 'permission_not_granted'
      || availability.reason === 'protected_app'
      || availability.reason === 'observation_failed'
      ? 'observation_unavailable'
      : 'playback_not_eligible';
  return unavailable(
    reason,
    reason === 'no_active_netease_playback'
      ? '当前没有可继续的网易云播放，Together Listening 操作未执行。'
      : reason === 'observation_unavailable'
        ? '暂时无法读取网易云播放状态，Together Listening 操作未执行。'
        : '当前网易云播放不满足 Together Listening 条件，操作未执行。',
    { mediaReason: availability.reason },
  );
}

export async function endForExplicitMediaLoss(
  activity: TogetherListeningActivity,
  availability: TogetherListeningNetEaseAvailability,
): Promise<ToolExecuteResult | null> {
  if (!isExplicitTogetherListeningMediaLoss(availability)) {
    return null;
  }
  const result = await endTogetherListeningActivity({
    activityId: activity.id,
    reason: 'media_unavailable',
  });
  if (result.status === 'transitioned') {
    return typedResult({
      status: 'unavailable',
      reason: 'no_active_netease_playback',
      activityId: result.activity.id,
      phase: result.activity.phase,
      endReason: result.activity.endReason,
      projectionStatus: result.projectionStatus,
    }, '网易云播放已结束，本次 Together Listening Activity 已按媒体事实结束。');
  }
  return typedResult({
    status: 'transition_conflict',
    activityId: 'activity' in result ? result.activity.id : activity.id,
    phase: 'activity' in result ? result.activity.phase : null,
    endReason: 'activity' in result ? result.activity.endReason : null,
  }, 'Together Listening Activity 已被其他操作更新，本次操作未覆盖现有结果。');
}
