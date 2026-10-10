/**
 * Together Listening 对网易云运行时事实的最小消费契约。
 *
 * 本层只判断产品 eligibility 与 Activity reconciliation，不知道 PhoneTools、
 * Device Control 或 Android。观察失败与明确媒体终态分开建模，避免一次临时失败误杀 Activity。
 */

import {
  isTogetherListeningTerminalPhase,
  type TogetherListeningActivity,
} from '../domain/TogetherListeningActivity';
import {
  endTogetherListeningActivity,
} from './TogetherListeningLifecycle';
import {
  projectTogetherListeningSystemPresentation,
} from './TogetherListeningSystemPresentation';
import {
  getTogetherListeningRuntimeDependencies,
  type TogetherListeningNetEaseObservation,
  type TogetherListeningObservedPlaybackState,
} from './TogetherListeningRuntime';

export type TogetherListeningNetEaseUnavailableReason =
  | 'no_active_session'
  | 'playback_stopped'
  | 'playback_none'
  | 'playback_error'
  | 'unsupported_playback_state'
  | 'missing_title'
  | 'permission_not_granted'
  | 'protected_app'
  | 'observation_failed';

export type TogetherListeningNetEaseAvailability =
  | {
      available: true;
      playbackState: 'playing' | 'paused' | 'buffering' | 'connecting';
      mediaId: string | null;
      title: string;
      artist: string | null;
      album: string | null;
    }
  | {
      available: false;
      reason: TogetherListeningNetEaseUnavailableReason;
      playbackState: TogetherListeningObservedPlaybackState | null;
      mediaId: string | null;
      title: string | null;
      artist: string | null;
      album: string | null;
    };

export interface TogetherListeningRuntimeSnapshot {
  capturedAtEpochMs: number;
  currentHostAiId: string | null;
  netease: TogetherListeningNetEaseAvailability;
  activity: TogetherListeningActivity | null;
}

export interface UserRuntimeStatusItem {
  key: 'netease_playback';
  text: string;
  source: 'system';
  writePolicy: 'system_only';
  updatedAtEpochMs: number;
}

const ELIGIBLE_STATES = new Set<TogetherListeningObservedPlaybackState>([
  'playing',
  'paused',
  'buffering',
  'connecting',
]);

function isEligiblePlaybackState(
  state: TogetherListeningObservedPlaybackState,
): state is Extract<TogetherListeningObservedPlaybackState, 'playing' | 'paused' | 'buffering' | 'connecting'> {
  return ELIGIBLE_STATES.has(state);
}

function normalizeMetadata(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

export function resolveTogetherListeningNetEaseAvailability(
  observation: TogetherListeningNetEaseObservation,
): TogetherListeningNetEaseAvailability {
  if (observation.status !== 'snapshot_available') {
    return {
      available: false,
      reason: observation.status,
      playbackState: null,
      mediaId: null,
      title: null,
      artist: null,
      album: null,
    };
  }

  const metadata = {
    mediaId: normalizeMetadata(observation.mediaId),
    title: normalizeMetadata(observation.title),
    artist: normalizeMetadata(observation.artist),
    album: normalizeMetadata(observation.album),
  };
  let reason: TogetherListeningNetEaseUnavailableReason | null = null;
  switch (observation.playbackState) {
    case 'playing':
    case 'paused':
    case 'buffering':
    case 'connecting':
      break;
    case 'stopped':
      reason = 'playback_stopped';
      break;
    case 'none':
      reason = 'playback_none';
      break;
    case 'error':
      reason = 'playback_error';
      break;
    case 'fast_forwarding':
    case 'rewinding':
    case 'skipping_to_previous':
    case 'skipping_to_next':
    case 'skipping_to_queue_item':
    case 'unknown':
      reason = 'unsupported_playback_state';
      break;
  }
  if (reason) {
    return {
      available: false,
      reason,
      playbackState: observation.playbackState,
      ...metadata,
    };
  }
  if (!metadata.title) {
    return {
      available: false,
      reason: 'missing_title',
      playbackState: observation.playbackState,
      ...metadata,
    };
  }
  if (!isEligiblePlaybackState(observation.playbackState)) {
    throw new Error(`未分类的网易云播放状态：${observation.playbackState}`);
  }
  return {
    available: true,
    playbackState: observation.playbackState,
    ...metadata,
    title: metadata.title,
  };
}

export function isExplicitTogetherListeningMediaLoss(
  availability: TogetherListeningNetEaseAvailability,
): boolean {
  if (!('reason' in availability)) {
    return false;
  }
  return (
    availability.reason === 'no_active_session'
    || availability.reason === 'playback_stopped'
    || availability.reason === 'playback_none'
    || availability.reason === 'playback_error'
  );
}

export async function captureTogetherListeningRuntimeSnapshot(): Promise<TogetherListeningRuntimeSnapshot> {
  const runtime = getTogetherListeningRuntimeDependencies();
  const capturedAtEpochMs = runtime.nowEpochMs();
  const [observation, activity, currentHostAiId] = await Promise.all([
    runtime.observeNetEasePlayback(),
    runtime.repository.getCurrent(),
    runtime.getCurrentHostAIId(),
  ]);
  return {
    capturedAtEpochMs,
    currentHostAiId,
    netease: resolveTogetherListeningNetEaseAvailability(observation),
    activity,
  };
}

/** 仅在已有模型 run 的准备阶段显式调用；它不是 MediaSession observer 或 AI wake source。 */
export async function reconcileTogetherListeningRuntime(
  snapshot: TogetherListeningRuntimeSnapshot,
): Promise<TogetherListeningRuntimeSnapshot> {
  if (!snapshot.activity) {
    return snapshot;
  }
  const endReason = snapshot.activity.hostAiId !== snapshot.currentHostAiId
    ? 'host_authority_lost'
    : isExplicitTogetherListeningMediaLoss(snapshot.netease)
      ? 'media_unavailable'
      : null;
  if (!endReason) {
    return snapshot;
  }
  const result = await endTogetherListeningActivity({
    activityId: snapshot.activity.id,
    reason: endReason,
  });
  if (result.status === 'activity_not_found') {
    return { ...snapshot, activity: null };
  }
  return {
    ...snapshot,
    activity: isTogetherListeningTerminalPhase(result.activity.phase)
      ? null
      : result.activity,
  };
}

/**
 * DB ready 后按 canonical current Activity 恢复或清理原生系统 presentation。
 *
 * 冷启动不得直接把 DB 残留的 active 重新投到系统：先走 canonical runtime
 * reconciliation 收口 Host authority 已丢失或网易云已明确终态的 Activity，
 * 再按最终 Activity 投影。transient observation failure 不属于明确终态，
 * 不会在这里误杀 Activity。
 */
export async function reconcileTogetherListeningSystemPresentation(): Promise<void> {
  const runtime = getTogetherListeningRuntimeDependencies();
  const snapshot = await captureTogetherListeningRuntimeSnapshot();
  const reconciled = await reconcileTogetherListeningRuntime(snapshot);
  const activity = reconciled.activity;
  if (!activity) {
    await runtime.systemPresentation.cancelPresentation();
    return;
  }
  await projectTogetherListeningSystemPresentation(activity);
}

export function buildUserRuntimeStatusItems(
  snapshot: TogetherListeningRuntimeSnapshot,
): UserRuntimeStatusItem[] {
  if (!snapshot.netease.available) {
    return [];
  }
  const artist = snapshot.netease.artist ? ` — ${snapshot.netease.artist}` : '';
  const stateSuffix = {
    playing: '',
    paused: '（已暂停）',
    buffering: '（正在缓冲）',
    connecting: '（正在连接）',
  }[snapshot.netease.playbackState];
  return [{
    key: 'netease_playback',
    text: `正在听歌：网易云音乐《${snapshot.netease.title}》${artist}${stateSuffix}`,
    source: 'system',
    writePolicy: 'system_only',
    updatedAtEpochMs: snapshot.capturedAtEpochMs,
  }];
}
