/**
 * 网易云播放与当前句歌词查询的最小运行时依赖。
 *
 * Phone Tools 只描述自己消费的结构契约；generic MediaSession 的真实实现由 Host 从
 * Device Control application public API 注入，避免两个 Feature 形成静态依赖环。
 * 当前句歌词复用公开歌词 backend，由 Host 装配，不在 application 导入具体 adapter。
 */

import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { NetEasePublicDataBackend } from './NetEasePublicDataBackend';

export type NetEasePlaybackCommand = 'pause' | 'resume' | 'next' | 'previous';

export type NetEaseMediaSessionPlaybackState =
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

export interface NetEaseMediaSessionSnapshot {
  packageName: string;
  /** 系统媒体输出观察；远程 session 不推断本机设备。 */
  audioOutput: { playbackType: 'local' | 'remote'; deviceNames: string[] } | null;
  playback: {
    state: NetEaseMediaSessionPlaybackState;
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

export type NetEaseMediaSessionSnapshotResult =
  | { status: 'session_snapshot_available'; snapshot: NetEaseMediaSessionSnapshot }
  | { status: 'permission_not_granted' }
  | { status: 'no_active_session'; packageName: string }
  | { status: 'invalid_package_name'; reason: string }
  | { status: 'snapshot_failed'; reason: string };

export type NetEaseMediaSessionCommandResult =
  | {
      status: 'command_dispatched';
      packageName: string;
      command: NetEasePlaybackCommand;
    }
  | { status: 'permission_not_granted' }
  | { status: 'no_active_session'; packageName: string }
  | {
      status: 'action_not_supported';
      packageName: string;
      command: NetEasePlaybackCommand;
    }
  | { status: 'invalid_package_name'; reason: string }
  | { status: 'invalid_command'; reason: string }
  | {
      status: 'dispatch_failed';
      packageName: string;
      command: NetEasePlaybackCommand;
      reason: string;
    };

export interface NetEasePlaybackRuntimeDependencies {
  getSongLyrics: NetEasePublicDataBackend['getSongLyrics'];
  getMediaSessionSnapshot(
    packageName: string,
  ): Promise<NetEaseMediaSessionSnapshotResult>;
  dispatchMediaSessionCommand(
    packageName: string,
    command: NetEasePlaybackCommand,
  ): Promise<NetEaseMediaSessionCommandResult>;
}

const netEasePlaybackRuntimeSlot =
  createRuntimeSlot<NetEasePlaybackRuntimeDependencies>('NetEase Playback');

export function configureNetEasePlaybackRuntimeDependencies(
  dependencies: NetEasePlaybackRuntimeDependencies,
): void {
  netEasePlaybackRuntimeSlot.configure(dependencies);
}

export function getNetEasePlaybackRuntimeDependencies(): NetEasePlaybackRuntimeDependencies {
  return netEasePlaybackRuntimeSlot.get();
}
