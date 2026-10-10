/** 仅供 Host 按需加载的网易云 production child Tool 组装出口。 */

import {
  createNetEaseGetPublicPlaylistTool,
} from './aiTools/NetEaseGetPublicPlaylistTool';
import { createNetEaseGetPlaybackStateTool } from './aiTools/NetEaseGetPlaybackStateTool';
import { createNetEaseGetSongLyricsTool } from './aiTools/NetEaseGetSongLyricsTool';
import { createNetEaseControlPlaybackTool } from './aiTools/NetEaseControlPlaybackTool';
import { createNetEasePlaySongTool } from './aiTools/NetEasePlaySongTool';
import { createNetEaseResolveShareLinkTool } from './aiTools/NetEaseResolveShareLinkTool';
import {
  createNetEaseSearchPublicPlaylistsTool,
} from './aiTools/NetEaseSearchPublicPlaylistsTool';
import { createNetEaseSearchSongsTool } from './aiTools/NetEaseSearchSongsTool';
import { playNetEaseSongById } from './application/PlayNetEaseSongById';
import {
  controlNetEasePlayback,
  getNetEasePlaybackSnapshot,
} from './application/NetEasePlayback';
import { nativeNetEasePublicDataBackend } from './infrastructure/NativeNetEasePublicDataBackend';
import { nativeNetEaseShareLinkResolver } from './infrastructure/NativeNetEaseShareLinkResolver';

/**
 * 网易云八个 production child Tool 的唯一组装结果。
 * Registry 直接消费这一组装结果，避免重复创建 native production adapter。
 */
export const productionNetEaseChildTools = [
  createNetEaseSearchSongsTool(nativeNetEasePublicDataBackend),
  createNetEaseSearchPublicPlaylistsTool(nativeNetEasePublicDataBackend),
  createNetEaseGetPublicPlaylistTool(nativeNetEasePublicDataBackend),
  createNetEaseGetSongLyricsTool(nativeNetEasePublicDataBackend),
  createNetEaseResolveShareLinkTool(nativeNetEaseShareLinkResolver),
  createNetEasePlaySongTool(playNetEaseSongById),
  createNetEaseGetPlaybackStateTool(getNetEasePlaybackSnapshot),
  createNetEaseControlPlaybackTool(controlNetEasePlayback),
] as const;
