/** 网易云公开只读数据原生桥；EAPI 与上游 JSON 形状不会越过此边界。 */

import { NativeModule, requireNativeModule } from 'expo';

export type NetEasePublicDataFailureCode =
  | 'network_failure'
  | 'api_rejected'
  | 'invalid_response'
  | 'not_found';

export type NetEasePublicDataFailure = {
  code: NetEasePublicDataFailureCode;
  message: string;
  apiCode: number | null;
};

export type NetEasePublicDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: NetEasePublicDataFailure };

export type NetEaseSongCandidate = {
  songId: number;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
};

export type NetEasePublicPlaylistCandidate = {
  playlistId: number;
  name: string;
  creatorName: string;
  trackCount: number;
};

export type NetEasePublicPlaylist = NetEasePublicPlaylistCandidate & {
  totalTrackCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  tracks: NetEaseSongCandidate[];
};

export type NetEaseSongLyrics =
  | { status: 'available'; text: string; truncated: boolean }
  | { status: 'no_lyrics' | 'uncollected' };

export type NetEaseShareLinkFailureCode =
  | 'invalid_url'
  | 'unsupported_host'
  | 'redirect_rejected'
  | 'too_many_redirects'
  | 'network_failure'
  | 'unsupported_resource_type'
  | 'invalid_resource_id'
  | 'unresolvable_share_link';

export type NetEaseShareLinkFailure = {
  code: NetEaseShareLinkFailureCode;
  message: string;
};

export type NetEaseShareLinkResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: NetEaseShareLinkFailure };

export type NetEaseSharedResource =
  | { type: 'song'; songId: number }
  | { type: 'playlist'; playlistId: number };

declare class NetEasePublicDataNativeModule extends NativeModule {
  searchSongs(query: string, limit: number): Promise<NetEasePublicDataResult<NetEaseSongCandidate[]>>;
  searchPublicPlaylists(
    query: string,
    limit: number,
  ): Promise<NetEasePublicDataResult<NetEasePublicPlaylistCandidate[]>>;
  getPublicPlaylist(
    playlistId: number,
    offset: number,
    limit: number,
  ): Promise<NetEasePublicDataResult<NetEasePublicPlaylist>>;
  getSongLyrics(songId: number): Promise<NetEasePublicDataResult<NetEaseSongLyrics>>;
  resolveShareLink(url: string): Promise<NetEaseShareLinkResult<NetEaseSharedResource>>;
}

const nativeModule = requireNativeModule<NetEasePublicDataNativeModule>(
  'RavenCatNetEasePublicData',
);

export const searchSongs = (query: string, limit: number) => nativeModule.searchSongs(query, limit);
export const searchPublicPlaylists = (query: string, limit: number) =>
  nativeModule.searchPublicPlaylists(query, limit);
export const getPublicPlaylist = (playlistId: number, offset: number, limit: number) =>
  nativeModule.getPublicPlaylist(playlistId, offset, limit);
export const getSongLyrics = (songId: number) => nativeModule.getSongLyrics(songId);
export const resolveShareLink = (url: string) => nativeModule.resolveShareLink(url);

export default nativeModule;
