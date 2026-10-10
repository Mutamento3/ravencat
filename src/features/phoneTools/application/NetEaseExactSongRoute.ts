/**
 * 网易云 exact-song route contract：PHONE-8A 真机冻结的最小 route，不扩展。
 *
 * 这是 NetEase app-specific route 的唯一构造点，Device Control 仍然不知道网易云：
 * package identity 与 route 语义属于 Phone Tools，Device Control 只做受控派发。
 *
 * 冻结内容：
 *
 * ```text
 * package : com.netease.cloudmusic
 * route   : orpheus://song/{songId}?thirdfrom=push
 * ```
 *
 * 不添加 autoplay / switch / replacePlayList / waitColdStartPlayConnected / spm 或任何
 * 其他未冻结参数：PHONE-8A 已证明最小 thirdfrom=push 足够命中正确歌曲。
 */

/** 网易云音乐 production package。 */
export const NETEASE_MUSIC_PACKAGE = 'com.netease.cloudmusic';

/** PHONE-8A 真机确认的最小 exact-song query。 */
const NETEASE_EXACT_SONG_QUERY = 'thirdfrom=push';

/**
 * songId 边界：必须是正 JS safe integer。
 *
 * `Number.isSafeInteger` 已覆盖 finite / integer / safe 三项，`> 0` 同时排除 0、负数与 NaN。
 * PHONE-8B1 返回的 songId 本来就是 safe JS number，这里不接受 string ID 或任何非整数形式。
 */
export function isValidNetEaseSongId(songId: unknown): songId is number {
  return typeof songId === 'number' && songId > 0 && Number.isSafeInteger(songId);
}

/** songId 已通过严格校验，因此 URI 构造是完全 deterministic 的。 */
export function buildNetEaseExactSongUri(songId: number): string {
  return `orpheus://song/${songId}?${NETEASE_EXACT_SONG_QUERY}`;
}
