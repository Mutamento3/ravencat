/** 当前主理 AI 主动退出 active Together Listening Activity。 */

import type { ToolContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { leaveTogetherListeningActivityByAI } from '../application/TogetherListeningLifecycle';
import {
  endForExplicitMediaLoss,
  observeLatestNetEase,
  readCurrentActivity,
  readCurrentHostAuthority,
  typedResult,
  unavailable,
} from './TogetherListeningToolRuntime';

export const definition = {
  name: 'leave_listening_together',
  description: '主动结束你与用户当前正在进行的 Together Listening Activity。只在已经 active 且你确实想退出时调用。',
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

export async function execute(_args: Record<string, never>, context: ToolContext) {
  throwIfAbortSignalAborted(context.abortSignal);
  const authority = await readCurrentHostAuthority(context);
  if ('result' in authority) return authority.result;
  const current = await readCurrentActivity();
  if (!current || current.phase !== 'active' || current.hostAiId !== authority.hostAiId) {
    return unavailable(
      'no_active_together_listening',
      '当前没有可由该主理 AI 退出的 active Together Listening Activity。',
      current ? { activityId: current.id, phase: current.phase } : {},
    );
  }

  const availability = await observeLatestNetEase();
  const mediaEnd = await endForExplicitMediaLoss(current, availability);
  if (mediaEnd) return mediaEnd;
  throwIfAbortSignalAborted(context.abortSignal);
  const result = await leaveTogetherListeningActivityByAI(current.id);
  if (result.status !== 'transitioned') {
    return typedResult({
      status: 'transition_conflict',
      activityId: 'activity' in result ? result.activity.id : current.id,
      phase: 'activity' in result ? result.activity.phase : null,
      endReason: 'activity' in result ? result.activity.endReason : null,
    }, 'Together Listening Activity 已被其他操作更新，本次退出未覆盖现有结果。');
  }
  return typedResult({
    status: 'left',
    activityId: result.activity.id,
    phase: result.activity.phase,
    endReason: result.activity.endReason,
    projectionStatus: result.projectionStatus,
  }, '已退出 Together Listening。');
}

export const LeaveListeningTogetherTool = { name: definition.name, definition, execute };
