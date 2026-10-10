import {
  getPublicPlaylist,
  getSongLyrics,
  searchPublicPlaylists,
  searchSongs,
} from '../../../../modules/netease-public-data';
import type { NetEasePublicDataBackend } from '../application/NetEasePublicDataBackend';

/** production adapter 只把 Phone Tools contract 交给 native backend。 */
export const nativeNetEasePublicDataBackend: NetEasePublicDataBackend = {
  searchSongs,
  searchPublicPlaylists,
  getPublicPlaylist,
  getSongLyrics,
};
