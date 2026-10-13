import {
  createTogetherListeningActivity,
  isTogetherListeningTerminalPhase,
  type TogetherListeningActivity,
  type TogetherListeningEndReason,
  type TogetherListeningInitiator,
  type TogetherListeningPhase,
} from '../domain/TogetherListeningActivity';
import type { TogetherListeningTransitionPatch } from '../domain/TogetherListeningRepository';
import type {
  TogetherListeningChatProjectionHint,
} from './TogetherListeningRuntime';
import { getTogetherListeningRuntimeDependencies } from './TogetherListeningRuntime';
import { emitTogetherListeningChanged } from './TogetherListeningChangedSignal';
import { projectTogetherListeningSystemPresentation } from './TogetherListeningSystemPresentation';

export type CreateTogetherListeningInvitationResult =
  | {
      status: 'created';
      activity: TogetherListeningActivity;
      /** 用户邀请的首张卡由 Chat canonical commit 完成，因此这里标记为 deferred。 */
      projectionStatus: 'projected' | 'deferred';
    }
  /** AI 邀请已经创建，但首张卡无法投影；Activity 已补偿收口。 */
  | {
      status: 'projection_failed';
      activity: TogetherListeningActivity;
      projectionStatus: 'failed';
    }
  | { status: 'non_terminal_activity_exists'; activity: TogetherListeningActivity };

export type TogetherListeningTransitionResult =
  | {
      status: 'transitioned';
      activity: TogetherListeningActivity;
      /** Activity truth 已提交；projection failure 不回滚或改写该 truth。 */
      projectionStatus: 'projected' | 'failed' | 'skipped';
    }
  | { status: 'activity_not_found' }
  | { status: 'invalid_phase'; activity: TogetherListeningActivity }
  | { status: 'already_terminal'; activity: TogetherListeningActivity }
  | { status: 'transition_conflict'; activity: TogetherListeningActivity };

async function createInvitation(
  initiator: TogetherListeningInitiator,
  input: { hostAiId: string; chatSessionId: string; timelineRunId?: string; groupSpeechTaskId?: string },
  options: { projectActivity: boolean },
): Promise<CreateTogetherListeningInvitationResult> {
  const runtime = getTogetherListeningRuntimeDependencies();
  const activity = createTogetherListeningActivity({
    id: runtime.generateId(),
    hostAiId: input.hostAiId,
    chatSessionId: input.chatSessionId,
    initiator,
    createdAtEpochMs: runtime.nowEpochMs(),
  });
  const result = await runtime.repository.createIfNoCurrent(activity);
  if (result.outcome !== 'created') {
    return { status: 'non_terminal_activity_exists', activity: result.activity };
  }
  emitTogetherListeningChanged();
  await projectActivityToSystemPresentation(result.activity);

  if (!options.projectActivity) {
    return {
      status: 'created',
      activity: result.activity,
      projectionStatus: 'deferred',
    };
  }

  // 首张卡的 run 排序身份只在插入时生效；后续 lifecycle 投影都是同一行的 patch。
  const projectionStatus = await projectActivityToChat(result.activity, {
    timelineRunId: input.timelineRunId,
    groupSpeechTaskId: input.groupSpeechTaskId,
  });
  if (projectionStatus === 'projected') {
    return {
      status: 'created',
      activity: result.activity,
      projectionStatus,
    };
  }

  // AI invite 已经把 Activity 写入真值，但用户完全看不到首张卡时，
  // 必须明确收口为 chat_unavailable，不能让 Tool 声称邀请已发送。
  const compensation = await transitionActivity(
    {
      activityId: result.activity.id,
      expectedPhases: ['pending_user_response'],
      patch: (nowEpochMs) => ({
        phase: 'ended',
        updatedAtEpochMs: nowEpochMs,
        endedAtEpochMs: nowEpochMs,
        endReason: 'chat_unavailable',
      }),
    },
    { projectActivity: false },
  );
  const compensatedActivity = compensation.status === 'transitioned'
    ? compensation.activity
    : 'activity' in compensation
      ? compensation.activity
      : result.activity;
  return {
    status: 'projection_failed',
    activity: compensatedActivity,
    projectionStatus: 'failed',
  };
}

export function createUserTogetherListeningInvitation(input: {
  hostAiId: string;
  chatSessionId: string;
}): Promise<CreateTogetherListeningInvitationResult> {
  return createInvitation('user', input, { projectActivity: false });
}

export function createAITogetherListeningInvitation(input: {
  hostAiId: string;
  chatSessionId: string;
  /** 发起邀请的 Chat Agent run 标识；只用于首张卡的时间线排序身份。 */
  timelineRunId?: string;
  groupSpeechTaskId?: string;
}): Promise<CreateTogetherListeningInvitationResult> {
  return createInvitation('ai', input, { projectActivity: true });
}

interface TransitionCommand {
  activityId: string;
  expectedPhases: [TogetherListeningPhase, ...TogetherListeningPhase[]];
  patch: (nowEpochMs: number) => TogetherListeningTransitionPatch;
}

async function transitionActivity(
  command: TransitionCommand,
  options: { projectActivity?: boolean } = {},
): Promise<TogetherListeningTransitionResult> {
  const runtime = getTogetherListeningRuntimeDependencies();
  const updated = await runtime.repository.transitionActivityIfPhase(
    command.activityId,
    command.expectedPhases,
    command.patch(runtime.nowEpochMs()),
  );
  if (updated) {
    emitTogetherListeningChanged();
    const [projectionStatus] = await Promise.all([
      options.projectActivity === false
        ? Promise.resolve<'skipped'>('skipped')
        : projectActivityToChat(updated),
      projectActivityToSystemPresentation(updated),
    ]);
    return { status: 'transitioned', activity: updated, projectionStatus };
  }

  // 这里只分类失败结果；真正的 phase 裁决已经由上面的 CAS UPDATE 完成。
  const current = await runtime.repository.getById(command.activityId);
  if (!current) {
    return { status: 'activity_not_found' };
  }
  if (isTogetherListeningTerminalPhase(current.phase)) {
    return { status: 'already_terminal', activity: current };
  }
  if (current.phase === 'active' && !command.expectedPhases.includes('active')) {
    return { status: 'transition_conflict', activity: current };
  }
  return { status: 'invalid_phase', activity: current };
}

async function projectActivityToSystemPresentation(
  activity: TogetherListeningActivity,
): Promise<void> {
  try {
    await projectTogetherListeningSystemPresentation(activity);
  } catch (error) {
    console.warn('[TogetherListening] Android 系统 presentation 投影失败：', {
      activityId: activity.id,
      phase: activity.phase,
      error,
    });
  }
}

async function projectActivityToChat(
  activity: TogetherListeningActivity,
  hint?: TogetherListeningChatProjectionHint,
): Promise<'projected' | 'failed'> {
  const runtime = getTogetherListeningRuntimeDependencies();
  try {
    await runtime.chat.projectActivityToChat(activity, hint);
    return 'projected';
  } catch (error) {
    // Activity 已经由上一事务提交；projection 是 commit 后副作用，失败不能
    // 回滚或伪装成没有发生。相同 activityId 可由后续调用幂等重试。
    console.warn('[TogetherListening] Chat Activity projection 失败：', {
      activityId: activity.id,
      phase: activity.phase,
      error,
    });
    return 'failed';
  }
}

function activate(activityId: string, expectedPhase: TogetherListeningPhase) {
  return transitionActivity({
    activityId,
    expectedPhases: [expectedPhase],
    patch: (nowEpochMs) => ({
      phase: 'active',
      updatedAtEpochMs: nowEpochMs,
      activatedAtEpochMs: nowEpochMs,
    }),
  });
}

function decline(
  activityId: string,
  expectedPhase: TogetherListeningPhase,
  phase: 'declined_by_user' | 'declined_by_ai',
) {
  return transitionActivity({
    activityId,
    expectedPhases: [expectedPhase],
    patch: (nowEpochMs) => ({
      phase,
      updatedAtEpochMs: nowEpochMs,
      endedAtEpochMs: nowEpochMs,
      endReason: null,
    }),
  });
}

function leave(activityId: string, reason: 'user_left' | 'ai_left') {
  return transitionActivity({
    activityId,
    expectedPhases: ['active'],
    patch: (nowEpochMs) => ({
      phase: 'ended',
      updatedAtEpochMs: nowEpochMs,
      endedAtEpochMs: nowEpochMs,
      endReason: reason,
    }),
  });
}

export function acceptTogetherListeningInvitationByUser(activityId: string) {
  return activate(activityId, 'pending_user_response');
}

export function declineTogetherListeningInvitationByUser(activityId: string) {
  return decline(activityId, 'pending_user_response', 'declined_by_user');
}

export function acceptTogetherListeningInvitationByAI(activityId: string) {
  return activate(activityId, 'pending_ai_response');
}

export function declineTogetherListeningInvitationByAI(activityId: string) {
  return decline(activityId, 'pending_ai_response', 'declined_by_ai');
}

export function leaveTogetherListeningActivityByUser(activityId: string) {
  return leave(activityId, 'user_left');
}

export function leaveTogetherListeningActivityByAI(activityId: string) {
  return leave(activityId, 'ai_left');
}

export function endTogetherListeningActivity(input: {
  activityId: string;
  reason: Exclude<TogetherListeningEndReason, 'user_left' | 'ai_left'>;
}): Promise<TogetherListeningTransitionResult> {
  return transitionActivity({
    activityId: input.activityId,
    expectedPhases: ['pending_user_response', 'pending_ai_response', 'active'],
    patch: (nowEpochMs) => ({
      phase: 'ended',
      updatedAtEpochMs: nowEpochMs,
      endedAtEpochMs: nowEpochMs,
      endReason: input.reason,
    }),
  });
}

export function getTogetherListeningActivityById(
  id: string,
): Promise<TogetherListeningActivity | null> {
  return getTogetherListeningRuntimeDependencies().repository.getById(id);
}

export function getCurrentTogetherListeningActivity(): Promise<TogetherListeningActivity | null> {
  return getTogetherListeningRuntimeDependencies().repository.getCurrent();
}
