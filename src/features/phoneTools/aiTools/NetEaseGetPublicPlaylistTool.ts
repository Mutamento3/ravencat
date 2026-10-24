/** 分页读取网易云公开歌单，不在 Tool 内自动翻完整歌单。 */

import type { Tool, ToolContext } from '@shared/aiTools';
import type { NetEasePublicDataBackend } from '../application/NetEasePublicDataBackend';
import {
  netEaseToolFailure,
  netEasePublicPlaylistSuccess,
  runNetEaseToolAsCurrentHost,
} from './NetEaseToolExecution';

export const NETEASE_PLAYLIST_DEFAULT_LIMIT = 50;
export const NETEASE_PLAYLIST_MAX_LIMIT = 100;
export const NETEASE_PLAYLIST_MAX_OFFSET = 2_147_483_647;

export interface NetEaseGetPublicPlaylistArgs {
  playlist_id: number;
  offset?: number;
  limit?: number;
}

export const netEaseGetPublicPlaylistDefinition = {
  name: 'netease_get_public_playlist',
  description: '分页读取指定网易云公开歌单的元数据和歌曲。',
  parameters: {
    type: 'object',
    properties: {
      playlist_id: {
        type: 'integer',
        description: '网易云歌单的正 JS safe integer ID',
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      },
      offset: {
        type: 'integer',
        description: '分页偏移；默认 0',
        minimum: 0,
        maximum: NETEASE_PLAYLIST_MAX_OFFSET,
        default: 0,
      },
      limit: {
        type: 'integer',
        description: '本页歌曲数量；默认 50，最大 100',
        minimum: 1,
        maximum: NETEASE_PLAYLIST_MAX_LIMIT,
        default: NETEASE_PLAYLIST_DEFAULT_LIMIT,
      },
    },
    required: ['playlist_id'],
    additionalProperties: false,
  },
} as const;

export function createNetEaseGetPublicPlaylistTool(
  backend: Pick<NetEasePublicDataBackend, 'getPublicPlaylist'>,
): Tool<NetEaseGetPublicPlaylistArgs, ToolContext> {
  return {
    name: netEaseGetPublicPlaylistDefinition.name,
    definition: netEaseGetPublicPlaylistDefinition,
    execute: (args, context) => runNetEaseToolAsCurrentHost(context, async () => {
      const result = await backend.getPublicPlaylist(
        args.playlist_id,
        args.offset ?? 0,
        args.limit ?? NETEASE_PLAYLIST_DEFAULT_LIMIT,
      );
      if (result.ok === false) return netEaseToolFailure(result.error);
      return netEasePublicPlaylistSuccess(
        `已读取歌单第 ${result.data.offset} 项起的 ${result.data.tracks.length} 首歌曲。`,
        result.data,
      );
    }),
  };
}
