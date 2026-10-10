/** Phone Tool Package 产品目录；只承载发现、分组与展示信息。 */

export type PhoneToolPackageStatus = 'available' | 'planned';

export interface PhoneToolPackageTool {
  id: string;
  toolName: string;
  title: string;
  description: string;
  implementationStatus: PhoneToolPackageStatus;
}

export interface PhoneToolPackage {
  id: string;
  title: string;
  description: string;
  implementationStatus: PhoneToolPackageStatus;
  tools: readonly PhoneToolPackageTool[];
}

export const PHONE_TOOL_PACKAGE_CATALOG = [
  {
    id: 'neteaseMusic',
    title: '网易云音乐工具包',
    description: '用于音乐搜索、精确播放、当前播放状态、播放控制与公开歌单读取。',
    implementationStatus: 'available',
    tools: [
      {
        id: 'searchSongs',
        toolName: 'netease_search_songs',
        title: '搜索歌曲',
        description: '搜索歌曲候选及其稳定数字 ID。',
        implementationStatus: 'available',
      },
      {
        id: 'searchPublicPlaylists',
        toolName: 'netease_search_public_playlists',
        title: '搜索公开歌单',
        description: '搜索公开歌单候选。',
        implementationStatus: 'available',
      },
      {
        id: 'getPublicPlaylist',
        toolName: 'netease_get_public_playlist',
        title: '读取公开歌单',
        description: '分页读取公开歌单的元数据和歌曲。',
        implementationStatus: 'available',
      },
      {
        id: 'getSongLyrics',
        toolName: 'netease_get_song_lyrics',
        title: '读取歌词',
        description: '读取指定歌曲的歌词及可用状态。',
        implementationStatus: 'available',
      },
      {
        id: 'resolveShareLink',
        toolName: 'netease_resolve_share_link',
        title: '解析分享链接',
        description: '将分享链接解析为歌曲或歌单的稳定数字 ID。',
        implementationStatus: 'available',
      },
      {
        id: 'playSong',
        toolName: 'netease_play_song',
        title: '播放歌曲',
        description: '按精确歌曲 ID 向官方客户端派发播放请求。',
        implementationStatus: 'available',
      },
      {
        id: 'getPlaybackState',
        toolName: 'netease_get_playback_state',
        title: '读取当前播放',
        description: '读取当前活动播放会话的歌曲、状态与控制能力。',
        implementationStatus: 'available',
      },
      {
        id: 'controlPlayback',
        toolName: 'netease_control_playback',
        title: '控制当前播放',
        description: '暂停、恢复或请求切换当前播放会话。',
        implementationStatus: 'available',
      },
    ],
  },
] as const satisfies readonly PhoneToolPackage[];

export function getPhoneToolPackageById(id: string): PhoneToolPackage | undefined {
  return PHONE_TOOL_PACKAGE_CATALOG.find((toolPackage) => toolPackage.id === id);
}
