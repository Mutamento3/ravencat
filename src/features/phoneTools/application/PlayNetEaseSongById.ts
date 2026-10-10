/**
 * 网易云 exact-song product capability。
 *
 * ```text
 * songId
 *   → NetEase exact route builder
 *   → Host 注入的 Device Control application primitive
 *   → exact-package ACTION_VIEW / CATEGORY_BROWSABLE dispatch
 * ```
 *
 * 执行真值边界：route dispatch != playback success。
 *
 * `play_request_dispatched` 只代表播放请求已经派发给网易云，不代表网易云已经开始播放。
 * PHONE-8A 已证明即使 exact route 命中正确歌曲，官方客户端仍可能因为版权 / 会员 / 地区 /
 * 登录 / 资源状态拒绝播放（《晴天》是真实失败样本）。最终 playback truth 以后由 PHONE-8D
 * MediaSession 或显式 observation 提供，本层不轮询、不重试、不读取播放状态。
 */

import {
  buildNetEaseExactSongUri,
  isValidNetEaseSongId,
  NETEASE_MUSIC_PACKAGE,
} from './NetEaseExactSongRoute';
import type { NetEaseUriDispatchFailureReason } from './NetEaseMusicRuntimeDependencies';
import { getNetEaseMusicRuntimeDependencies } from './NetEaseMusicRuntimeDependencies';

export type NetEasePlayRequestResult = {
  status: 'play_request_dispatched';
  songId: number;
  targetPackage: string;
};

export type NetEasePlayRequestFailureReason =
  | 'invalid_song_id'
  | 'protected_app'
  | 'route_unavailable'
  | 'route_dispatch_failed';

/** 预期业务失败统一收敛为单一 error contract，供未来 Tool 层单点处理。 */
export class NetEasePlayRequestError extends Error {
  readonly reason: NetEasePlayRequestFailureReason;

  constructor(reason: NetEasePlayRequestFailureReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = 'NetEasePlayRequestError';
  }
}

/**
 * 固定 package + deterministic route 理论上不可能产生的失败。
 *
 * 这是内部 route contract 被破坏的 invariant，不是用户输入失败：
 * 不做映射伪装、不做 silent fallback、不换 route 重试。
 */
export class NetEaseRouteContractError extends Error {
  readonly reason: 'invalid_target_package' | 'invalid_target_uri';

  constructor(reason: 'invalid_target_package' | 'invalid_target_uri', message: string) {
    super(message);
    this.reason = reason;
    this.name = 'NetEaseRouteContractError';
  }
}

/**
 * 读取注入 primitive 的失败 reason。
 *
 * 这里只按结构读取，不 import Device Control 的 error class：Phone Tools 与 Device Control
 * 之间只允许存在 Host 注入的 runtime dependency，不允许静态 feature 依赖。
 */
function readDispatchFailureReason(error: unknown): NetEaseUriDispatchFailureReason | null {
  if (typeof error !== 'object' || error === null || !('reason' in error)) {
    return null;
  }
  const { reason } = error as { reason?: unknown };
  switch (reason) {
    case 'protected_app':
    case 'route_unavailable':
    case 'route_dispatch_failed':
    case 'invalid_target_package':
    case 'invalid_target_uri':
      return reason;
    default:
      return null;
  }
}

function mapDispatchFailure(error: unknown): unknown {
  const reason = readDispatchFailureReason(error);
  const message = error instanceof Error ? error.message : String(error);

  if (
    reason === 'protected_app'
    || reason === 'route_unavailable'
    || reason === 'route_dispatch_failed'
  ) {
    return new NetEasePlayRequestError(reason, message);
  }

  if (reason === 'invalid_target_package' || reason === 'invalid_target_uri') {
    return new NetEaseRouteContractError(
      reason,
      `网易云固定 route contract 被 Device Control 拒绝（${reason}）：${message}`,
    );
  }

  // 非 Device Control 契约内的错误保持原样上抛，不吞、不兜底。
  return error;
}

/**
 * 请求网易云播放指定歌曲。
 *
 * 只接受正的 JS safe integer songId；URI 由本层 deterministic 构造，
 * caller 无法修改 package、scheme 或 query 参数。
 */
export async function playNetEaseSongById(songId: number): Promise<NetEasePlayRequestResult> {
  if (!isValidNetEaseSongId(songId)) {
    throw new NetEasePlayRequestError(
      'invalid_song_id',
      'songId 必须是正的整数（JS safe integer）',
    );
  }

  // 固定 package + deterministic route：两者都不由 caller 提供。
  const uri = buildNetEaseExactSongUri(songId);

  let result;
  try {
    result = await getNetEaseMusicRuntimeDependencies()
      .dispatchBrowsableUriToPackage(NETEASE_MUSIC_PACKAGE, uri);
  } catch (error) {
    throw mapDispatchFailure(error);
  }

  // 成功只声称 play_request_dispatched：不声称 playing / playback_started / 播放成功。
  return {
    status: 'play_request_dispatched',
    songId,
    targetPackage: result.targetPackage,
  };
}
