/** 读取网易云当前活动播放会话的真实快照，不推断快照之外的状态。 */

import type { Tool, ToolContext } from '@shared/aiTools';
import {
  getNetEasePlaybackSnapshot,
  NetEasePlaybackError,
} from '../application/NetEasePlayback';
import {
  netEaseToolFailure,
  netEaseToolSuccess,
  runNetEaseToolAsCurrentHost,
} from './NetEaseToolExecution';

export type NetEaseGetPlaybackStateArgs = Record<string, never>;

export const netEaseGetPlaybackStateDefinition = {
  name: 'netease_get_playback_state',
  description: '【主理 AI 专属】读取网易云当前播放会话的歌曲信息、播放状态与可用控制能力。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
} as const;

export type GetNetEasePlaybackStateCapability = typeof getNetEasePlaybackSnapshot;

export function createNetEaseGetPlaybackStateTool(
  getPlaybackState: GetNetEasePlaybackStateCapability = getNetEasePlaybackSnapshot,
): Tool<NetEaseGetPlaybackStateArgs, ToolContext> {
  return {
    name: netEaseGetPlaybackStateDefinition.name,
    definition: netEaseGetPlaybackStateDefinition,
    execute: (_args, context) => runNetEaseToolAsCurrentHost(context, async () => {
      try {
        const result = await getPlaybackState();
        return netEaseToolSuccess(
          'playback_snapshot_available: 已读取网易云当前活动播放会话快照。',
          result,
        );
      } catch (error) {
        if (!(error instanceof NetEasePlaybackError)) throw error;
        return netEaseToolFailure({ code: error.reason, message: error.message });
      }
    }),
  };
}
