import type { TogetherListeningActivity } from '../domain/TogetherListeningActivity';
import {
  captureTogetherListeningRuntimeSnapshot,
  reconcileTogetherListeningRuntime,
  type TogetherListeningNetEaseUnavailableReason,
} from './TogetherListeningRuntimeAwareness';

export type TogetherListeningInAppPlayback =
  | {
      status: 'available';
      state: 'playing' | 'paused' | 'buffering' | 'connecting';
      title: string;
      artist: string | null;
    }
  | {
      status: 'temporarily_unavailable';
      reason: Extract<
        TogetherListeningNetEaseUnavailableReason,
        | 'permission_not_granted'
        | 'protected_app'
        | 'observation_failed'
        | 'missing_title'
        | 'unsupported_playback_state'
      >;
    };

export interface TogetherListeningInAppState {
  activityId: string;
  hostAiId: string;
  chatSessionId: string;
  activatedAtEpochMs: number | null;
  playback: TogetherListeningInAppPlayback;
}

function mapActiveActivity(
  activity: TogetherListeningActivity,
  snapshot: Awaited<ReturnType<typeof reconcileTogetherListeningRuntime>>,
): TogetherListeningInAppState {
  let playback: TogetherListeningInAppPlayback;
  if (!('reason' in snapshot.netease)) {
    playback = {
        status: 'available',
        state: snapshot.netease.playbackState,
        title: snapshot.netease.title,
        artist: snapshot.netease.artist,
      };
  } else {
    switch (snapshot.netease.reason) {
      case 'permission_not_granted':
      case 'protected_app':
      case 'observation_failed':
      case 'missing_title':
      case 'unsupported_playback_state':
        playback = {
        status: 'temporarily_unavailable',
          reason: snapshot.netease.reason,
        };
        break;
      case 'no_active_session':
      case 'playback_stopped':
      case 'playback_none':
      case 'playback_error':
        throw new Error('明确媒体终态必须在 presentation mapping 前收口 Activity');
    }
  }
  return {
    activityId: activity.id,
    hostAiId: activity.hostAiId,
    chatSessionId: activity.chatSessionId,
    activatedAtEpochMs: activity.activatedAtEpochMs,
    playback,
  };
}

/** Host presentation 每次重读 canonical truth，并先执行已有 runtime reconciliation。 */
export async function prepareTogetherListeningInAppPresentationState(): Promise<
  TogetherListeningInAppState | null
> {
  const snapshot = await reconcileTogetherListeningRuntime(
    await captureTogetherListeningRuntimeSnapshot(),
  );
  if (!snapshot.activity || snapshot.activity.phase !== 'active') {
    return null;
  }
  return mapActiveActivity(snapshot.activity, snapshot);
}
