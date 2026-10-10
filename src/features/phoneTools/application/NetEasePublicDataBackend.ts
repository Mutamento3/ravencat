/** Phone Tools 拥有的网易云公开只读数据 contract；不暴露 EAPI 或原始响应。 */

export type NetEasePublicDataFailureCode =
  | 'network_failure'
  | 'api_rejected'
  | 'invalid_response'
  | 'not_found';

export type NetEasePublicDataResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: NetEasePublicDataFailureCode; message: string; apiCode: number | null };
    };

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

export interface NetEasePublicDataBackend {
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
}
