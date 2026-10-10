/** 搜索网易云公开歌曲候选，不在 Tool 内替模型消歧。 */

import type { Tool, ToolContext } from '@shared/aiTools';
import type { NetEasePublicDataBackend } from '../application/NetEasePublicDataBackend';
import {
  netEaseToolFailure,
  netEaseSongCandidatesSuccess,
  NETEASE_SEARCH_DEFAULT_LIMIT,
  NETEASE_SEARCH_MAX_LIMIT,
  runNetEaseToolAsCurrentHost,
} from './NetEaseToolExecution';

export interface NetEaseSearchSongsArgs {
  query: string;
  limit?: number;
}

export const netEaseSearchSongsDefinition = {
  name: 'netease_search_songs',
  description: [
    '【主理 AI 专属】搜索网易云公开歌曲候选，返回歌曲、艺人、专辑等身份信息。',
    '结果仅是候选：必须结合歌名、艺人、专辑和用户上下文消歧，不得默认选择第一项；仍有多个合理候选时应询问用户。',
  ].join(''),
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '歌曲、艺人或其他搜索关键词',
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

export function createNetEaseSearchSongsTool(
  backend: Pick<NetEasePublicDataBackend, 'searchSongs'>,
): Tool<NetEaseSearchSongsArgs, ToolContext> {
  return {
    name: netEaseSearchSongsDefinition.name,
    definition: netEaseSearchSongsDefinition,
    execute: (args, context) => runNetEaseToolAsCurrentHost(context, async () => {
      const result = await backend.searchSongs(
        args.query,
        args.limit ?? NETEASE_SEARCH_DEFAULT_LIMIT,
      );
      if (result.ok === false) return netEaseToolFailure(result.error);
      return netEaseSongCandidatesSuccess(
        `找到 ${result.data.length} 个歌曲候选，请结合歌名、艺人和专辑继续消歧。`,
        result.data,
      );
    }),
  };
}
