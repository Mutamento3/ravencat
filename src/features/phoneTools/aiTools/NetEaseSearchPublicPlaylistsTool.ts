/** 搜索网易云公开歌单候选，不自动读取第一项详情。 */

import type { Tool, ToolContext } from '@shared/aiTools';
import type { NetEasePublicDataBackend } from '../application/NetEasePublicDataBackend';
import {
  netEaseToolFailure,
  netEasePlaylistCandidatesSuccess,
  NETEASE_SEARCH_DEFAULT_LIMIT,
  NETEASE_SEARCH_MAX_LIMIT,
  runNetEaseToolAsCurrentHost,
} from './NetEaseToolExecution';

export interface NetEaseSearchPublicPlaylistsArgs {
  query: string;
  limit?: number;
}

export const netEaseSearchPublicPlaylistsDefinition = {
  name: 'netease_search_public_playlists',
  description: '【主理 AI 专属】搜索网易云公开歌单候选；只返回候选，不自动读取第一项歌单详情。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '歌单搜索关键词',
        minLength: 1,
        maxLength: 200,
        pattern: '\\S',
      },
      limit: {
        type: 'integer',
        description: '候选数量；默认 10，最大 100',
        minimum: 1,
        maximum: NETEASE_SEARCH_MAX_LIMIT,
        default: NETEASE_SEARCH_DEFAULT_LIMIT,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
} as const;

export function createNetEaseSearchPublicPlaylistsTool(
  backend: Pick<NetEasePublicDataBackend, 'searchPublicPlaylists'>,
): Tool<NetEaseSearchPublicPlaylistsArgs, ToolContext> {
  return {
    name: netEaseSearchPublicPlaylistsDefinition.name,
    definition: netEaseSearchPublicPlaylistsDefinition,
    execute: (args, context) => runNetEaseToolAsCurrentHost(context, async () => {
      const result = await backend.searchPublicPlaylists(
        args.query,
        args.limit ?? NETEASE_SEARCH_DEFAULT_LIMIT,
      );
      if (result.ok === false) return netEaseToolFailure(result.error);
      return netEasePlaylistCandidatesSuccess(
        `找到 ${result.data.length} 个公开歌单候选。`,
        result.data,
      );
    }),
  };
}
