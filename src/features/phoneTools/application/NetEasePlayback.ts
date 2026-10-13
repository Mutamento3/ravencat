/**
 * 网易云现有播放会话的产品能力。
 *
 * 本层固定网易云身份、执行 Protected Apps 准入并映射产品错误；MediaSession 的观察和
 * 控制仍由 Host 注入的 Device Control primitive 完成。command dispatched 只表示派发，
 * 不表示播放状态已经改变；确认状态必须由 caller 显式发起一次新的 snapshot observation。
 */

import { loadCurrentProtectedPackages } from './CurrentProtectedAppsPolicy';
import { NETEASE_MUSIC_PACKAGE } from './NetEaseExactSongRoute';
import {
  getNetEasePlaybackRuntimeDependencies,
  type NetEaseMediaSessionSnapshot,
  type NetEasePlaybackCommand,
} from './NetEasePlaybackRuntimeDependencies';
import {
  assertProtectedAppCapabilityAllowed,
  ProtectedAppsPolicyError,
} from './ProtectedAppsPolicy';

export type NetEasePlaybackSnapshot = Omit<NetEaseMediaSessionSnapshot, 'packageName'>;

export type NetEasePlaybackSnapshotResult = {
  status: 'playback_snapshot_available';
  targetPackage: string;
  snapshot: NetEasePlaybackSnapshot;
};

export type NetEasePlaybackCommandResult = {
  status: 'playback_command_dispatched';
  targetPackage: string;
  command: NetEasePlaybackCommand;
};

export type NetEasePlaybackFailureReason =
  | 'protected_app'
  | 'permission_not_granted'
  | 'no_active_session'
  | 'snapshot_failed'
  | 'action_not_supported'
  | 'dispatch_failed';

export class NetEasePlaybackError extends Error {
  readonly reason: NetEasePlaybackFailureReason;

  constructor(reason: NetEasePlaybackFailureReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = 'NetEasePlaybackError';
  }
}

/** 固定 package 与冻结 command 被 generic primitive 拒绝时，表示内部集成契约已破坏。 */
export class NetEasePlaybackContractError extends Error {
  readonly reason: 'invalid_package_name' | 'invalid_command';

  constructor(reason: 'invalid_package_name' | 'invalid_command', message: string) {
    super(message);
    this.reason = reason;
    this.name = 'NetEasePlaybackContractError';
  }
}

async function assertNetEasePlaybackAllowed(
  capabilityKind: 'observation' | 'action',
): Promise<void> {
  const protectedPackages = await loadCurrentProtectedPackages();
  try {
    assertProtectedAppCapabilityAllowed(
      NETEASE_MUSIC_PACKAGE,
      protectedPackages,
      capabilityKind,
    );
  } catch (error) {
    if (error instanceof ProtectedAppsPolicyError) {
      throw new NetEasePlaybackError('protected_app', error.message);
    }
    throw error;
  }
}

export async function getNetEasePlaybackSnapshot(): Promise<NetEasePlaybackSnapshotResult> {
  await assertNetEasePlaybackAllowed('observation');
  const result = await getNetEasePlaybackRuntimeDependencies()
    .getMediaSessionSnapshot(NETEASE_MUSIC_PACKAGE);

  switch (result.status) {
    case 'session_snapshot_available': {
      const { playback, metadata, actions, audioOutput } = result.snapshot;
      return {
        status: 'playback_snapshot_available',
        targetPackage: NETEASE_MUSIC_PACKAGE,
        snapshot: { playback, metadata, actions, audioOutput },
      };
    }
    case 'permission_not_granted':
      throw new NetEasePlaybackError(
        'permission_not_granted',
        '尚未授予通知使用权，无法读取网易云播放状态。',
      );
    case 'no_active_session':
      throw new NetEasePlaybackError(
        'no_active_session',
        '网易云当前没有可用的活动播放会话。',
      );
    case 'snapshot_failed':
      throw new NetEasePlaybackError('snapshot_failed', result.reason);
    case 'invalid_package_name':
      throw new NetEasePlaybackContractError(
        'invalid_package_name',
        `网易云固定 package 被 MediaSession observation 拒绝：${result.reason}`,
      );
  }
}

export async function controlNetEasePlayback(
  command: NetEasePlaybackCommand,
): Promise<NetEasePlaybackCommandResult> {
  await assertNetEasePlaybackAllowed('action');
  const result = await getNetEasePlaybackRuntimeDependencies()
    .dispatchMediaSessionCommand(NETEASE_MUSIC_PACKAGE, command);

  switch (result.status) {
    case 'command_dispatched':
      return {
        status: 'playback_command_dispatched',
        targetPackage: NETEASE_MUSIC_PACKAGE,
        command,
      };
    case 'permission_not_granted':
      throw new NetEasePlaybackError(
        'permission_not_granted',
        '尚未授予通知使用权，无法控制网易云播放。',
      );
    case 'no_active_session':
      throw new NetEasePlaybackError(
        'no_active_session',
        '网易云当前没有可用的活动播放会话。',
      );
    case 'action_not_supported':
      throw new NetEasePlaybackError(
        'action_not_supported',
        `网易云当前播放会话不支持 ${command}。`,
      );
    case 'dispatch_failed':
      throw new NetEasePlaybackError('dispatch_failed', result.reason);
    case 'invalid_package_name':
    case 'invalid_command':
      throw new NetEasePlaybackContractError(
        result.status,
        `网易云播放控制固定契约被 MediaSession primitive 拒绝：${result.reason}`,
      );
  }
}
