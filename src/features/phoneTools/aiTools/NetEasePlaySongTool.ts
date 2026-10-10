/** 按精确 song ID 派发网易云播放请求，不声称最终播放状态。 */

import type { Tool, ToolContext } from '@shared/aiTools';
import {
  NetEasePlayRequestError,
  playNetEaseSongById,
} from '../application/PlayNetEaseSongById';
import {
  netEaseToolFailure,
  netEaseToolSuccess,
  runNetEaseToolAsCurrentHost,
} from './NetEaseToolExecution';

export interface NetEasePlaySongArgs {
  song_id: number;
}

export const netEasePlaySongDefinition = {
  name: 'netease_play_song',
  description: '【主理 AI 专属】按精确网易云 song ID 向官方客户端派发播放请求；结果不代表最终播放状态。',
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

export type PlayNetEaseSongCapability = typeof playNetEaseSongById;

export function createNetEasePlaySongTool(
  playSong: PlayNetEaseSongCapability = playNetEaseSongById,
): Tool<NetEasePlaySongArgs, ToolContext> {
  return {
    name: netEasePlaySongDefinition.name,
    definition: netEasePlaySongDefinition,
    execute: (args, context) => runNetEaseToolAsCurrentHost(context, async () => {
      try {
        const result = await playSong(args.song_id);
        return netEaseToolSuccess(
          'play_request_dispatched: 请求已经派发给官方网易云音乐；最终播放状态尚未确认。',
          result,
        );
      } catch (error) {
        if (!(error instanceof NetEasePlayRequestError)) throw error;
        return netEaseToolFailure({ code: error.reason, message: error.message });
      }
    }),
  };
}
