/** 当前主理 AI 向用户发起 Together Listening 邀请。 */

import type { ToolContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { createAITogetherListeningInvitation } from '../application/TogetherListeningLifecycle';
import {
  mapMediaUnavailable,
  readCurrentActivity,
  readCurrentHostAuthority,
  observeLatestNetEase,
  typedResult,
  unavailable,
} from './TogetherListeningToolRuntime';

export const definition = {
  name: 'invite_listening_together',
  description: [
    'RavenCat 已有的 Together Listening 能力：向用户发起一起听网易云音乐的邀请。',
    '当前网易云不可用时，工具会明确报告不可用。',
    '网易云一起听功能是当前软件特有的能力，通过安卓的原生功能实现。',
    '想跟用户一起听歌的时候即可发起。',
    '邀请成功后只是等待用户回应，不要声称已经开始一起听。',
  ].join(''),
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

export async function execute(_args: Record<string, never>, context: ToolContext) {
  throwIfAbortSignalAborted(context.abortSignal);
  if (!context.sessionId) {
    return unavailable('no_chat_session', '当前 run 没有关联真实聊天会话，不能创建 Together Listening 邀请。');
  }
  const authority = await readCurrentHostAuthority(context);
  if ('result' in authority) return authority.result;

  const current = await readCurrentActivity();
  if (current) {
    return typedResult({
      status: 'activity_in_progress',
      activityId: current.id,
      phase: current.phase,
    }, '已有进行中的 Together Listening Activity，本次没有创建第二条邀请。');
  }

  const availability = await observeLatestNetEase();
  if (!availability.available) return mapMediaUnavailable(availability);
  throwIfAbortSignalAborted(context.abortSignal);
  const result = await createAITogetherListeningInvitation({
    hostAiId: authority.hostAiId,
    chatSessionId: context.sessionId,
    groupSpeechTaskId: (context.sharedState?.groupChat as { taskId?: string } | undefined)?.taskId,
    // Chat 把当前 Agent run 标识放在 sharedState.replyRunId；首张邀请卡借此
    // 获得 run 内排序身份。非 Chat run（无该标识）退化为普通历史键排序。
    timelineRunId: typeof context.sharedState?.replyRunId === 'string'
      ? context.sharedState.replyRunId
      : undefined,
  });
  if (result.status === 'projection_failed') {
    return unavailable(
      'chat_unavailable',
      'Together Listening 邀请卡无法写入当前聊天，邀请未发送且 Activity 已结束。',
      {
        activityId: result.activity.id,
        phase: result.activity.phase,
        endReason: result.activity.endReason,
        projectionStatus: result.projectionStatus,
      },
    );
  }
  if (result.status === 'non_terminal_activity_exists') {
    return typedResult({
      status: 'activity_in_progress',
      activityId: result.activity.id,
      phase: result.activity.phase,
    }, '另一路操作已先创建 Together Listening Activity，本次没有创建第二条邀请。');
  }
  return typedResult({
    status: 'invitation_created',
    activityId: result.activity.id,
    phase: result.activity.phase,
    projectionStatus: result.projectionStatus,
  }, 'Together Listening 邀请已创建，正在等待用户回应。');
}

export const InviteListeningTogetherTool = { name: definition.name, definition, execute };
