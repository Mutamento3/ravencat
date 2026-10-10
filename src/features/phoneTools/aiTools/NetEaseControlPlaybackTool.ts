/** 向网易云当前活动播放会话派发控制请求，不自动观察最终状态。 */

import type { Tool, ToolContext } from '@shared/aiTools';
import {
  controlNetEasePlayback,
  NetEasePlaybackError,
} from '../application/NetEasePlayback';
import type { NetEasePlaybackCommand } from '../application/NetEasePlaybackRuntimeDependencies';
import {
  netEaseToolFailure,
  netEaseToolSuccess,
  runNetEaseToolAsCurrentHost,
} from './NetEaseToolExecution';

export interface NetEaseControlPlaybackArgs {
  command: NetEasePlaybackCommand;
}

export const netEaseControlPlaybackDefinition = {
  name: 'netease_control_playback',
  description: '【主理 AI 专属】控制网易云当前播放会话：pause 暂停，resume 恢复，next 请求下一首，previous 请求上一首。成功仅表示请求已派发，不代表已确认新的播放状态。',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['pause', 'resume', 'next', 'previous'],
        description: '要派发给当前网易云播放会话的控制命令',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
} as const;

export type ControlNetEasePlaybackCapability = typeof controlNetEasePlayback;

export function createNetEaseControlPlaybackTool(
  controlPlayback: ControlNetEasePlaybackCapability = controlNetEasePlayback,
): Tool<NetEaseControlPlaybackArgs, ToolContext> {
  return {
    name: netEaseControlPlaybackDefinition.name,
    definition: netEaseControlPlaybackDefinition,
    execute: (args, context) => runNetEaseToolAsCurrentHost(context, async () => {
      try {
        const result = await controlPlayback(args.command);
        return netEaseToolSuccess(
          'playback_command_dispatched: 播放控制请求已经派发给网易云；最终播放状态尚未重新确认。',
          result,
        );
      } catch (error) {
        if (!(error instanceof NetEasePlaybackError)) throw error;
        return netEaseToolFailure({ code: error.reason, message: error.message });
      }
    }),
  };
}
