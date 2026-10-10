/** Device Control 对 Android MediaSession 观察能力的稳定应用层契约。 */

export type NotificationListenerAccessState =
  | { status: 'granted' }
  | { status: 'not_granted' };

export type NotificationListenerSettingsResult =
  | { status: 'settings_open_dispatched'; reason: null }
  | { status: 'settings_open_failed'; reason: string };

export type MediaSessionPlaybackState =
  | 'none'
  | 'stopped'
  | 'paused'
  | 'playing'
  | 'fast_forwarding'
  | 'rewinding'
  | 'buffering'
  | 'error'
  | 'connecting'
  | 'skipping_to_previous'
  | 'skipping_to_next'
  | 'skipping_to_queue_item'
  | 'unknown';

export interface MediaSessionSnapshot {
  packageName: string;
  playback: {
    state: MediaSessionPlaybackState;
    positionMs: number | null;
    speed: number | null;
    updatedAtEpochMs: number | null;
  };
  metadata: {
    mediaId: string | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    durationMs: number | null;
  };
  /** Session advertised capability；具体参数语义仍需在后续控制阶段独立验证。 */
  actions: {
    play: boolean;
    pause: boolean;
    playPause: boolean;
    stop: boolean;
    next: boolean;
    previous: boolean;
    seekTo: boolean;
    playFromMediaId: boolean;
    playFromSearch: boolean;
    playFromUri: boolean;
    prepare: boolean;
    prepareFromMediaId: boolean;
    prepareFromSearch: boolean;
    prepareFromUri: boolean;
  };
}
export type MediaSessionSnapshotResult =
  | { status: 'session_snapshot_available'; snapshot: MediaSessionSnapshot }
  | { status: 'permission_not_granted' }
  | { status: 'no_active_session'; packageName: string }
  | { status: 'invalid_package_name'; reason: string }
  | { status: 'snapshot_failed'; reason: string };

export interface MediaSessionObservationPort {
  getNotificationListenerAccessState(): Promise<NotificationListenerAccessState>;
  openNotificationListenerSettings(): Promise<NotificationListenerSettingsResult>;
  getMediaSessionSnapshot(packageName: string): Promise<MediaSessionSnapshotResult>;
}
