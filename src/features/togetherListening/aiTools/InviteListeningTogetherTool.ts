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
    '当前网易云暂时不可用不代表你没有一起听能力；执行时工具会返回 typed unavailable。',
    '不要仅因为当前没有播放就告诉用户“我不能一起听”。',
    '只在用户明确想一起听，或对话上下文自然适合时调用；不要为了展示功能随意发邀请。',
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
