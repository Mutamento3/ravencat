/** 读取网易云歌词并保留 backend 的状态与截断真值。 */

import type { Tool, ToolContext } from '@shared/aiTools';
import type { NetEasePublicDataBackend } from '../application/NetEasePublicDataBackend';
import {
  netEaseToolFailure,
  netEaseSongLyricsSuccess,
  runNetEaseToolAsCurrentHost,
} from './NetEaseToolExecution';

export interface NetEaseGetSongLyricsArgs {
  song_id: number;
}

export const netEaseGetSongLyricsDefinition = {
  name: 'netease_get_song_lyrics',
  description: '读取指定网易云歌曲的歌词，保留 available、no_lyrics、uncollected 状态。',
  parameters: {
    type: 'object',
    properties: {
      song_id: {
        type: 'integer',
        description: '网易云歌曲的正 JS safe integer ID',
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    },
    required: ['song_id'],
    additionalProperties: false,
  },
} as const;

export function createNetEaseGetSongLyricsTool(
  backend: Pick<NetEasePublicDataBackend, 'getSongLyrics'>,
): Tool<NetEaseGetSongLyricsArgs, ToolContext> {
  return {
    name: netEaseGetSongLyricsDefinition.name,
    definition: netEaseGetSongLyricsDefinition,
    execute: (args, context) => runNetEaseToolAsCurrentHost(context, async () => {
      const result = await backend.getSongLyrics(args.song_id);
      if (result.ok === false) return netEaseToolFailure(result.error);
      return netEaseSongLyricsSuccess(`歌词状态：${result.data.status}。`, result.data);
    }),
  };
}
