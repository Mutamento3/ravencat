/**
 * Host 为 Chat 注入的 Together Listening 网关。
 *
 * Chat 只携带稳定的 Activity DTO；最新 Host、Activity 与网易云事实均在
 * 这里重新读取。Activity 真值仍由 Together Listening 持有，Chat 仅负责
 * canonical 用户卡片提交与生命周期 projection。
 */

import type {
  AIAssistantConfig,
} from '@features/chat';
import {
  commitTogetherListeningUserInvitation,
  upsertTogetherListeningTimelineEntry,
} from '@features/chat/composition';
import type {
  ChatTogetherListeningActivity,
  ChatTogetherListeningGateway,
  ChatTogetherListeningResult,
  ChatTogetherListeningResultStatus,
  TogetherListeningTimelineActivity,
  TogetherListeningTimelineProjectionHint,
} from '@features/chat/composition';
import {
  acceptTogetherListeningInvitationByUser,
  captureTogetherListeningRuntimeSnapshot,
  createUserTogetherListeningInvitation,
  declineTogetherListeningInvitationByUser,
  endTogetherListeningActivity,
  isExplicitTogetherListeningMediaLoss,
  leaveTogetherListeningByUser,
  runPostUserDeclineFollowUp,
  type TogetherListeningActivity,
  type TogetherListeningRuntimeSnapshot,
} from '@features/togetherListening';

function toChatActivity(activity: TogetherListeningActivity): ChatTogetherListeningActivity {
  return {
    id: activity.id,
    chatSessionId: activity.chatSessionId,
    hostAiId: activity.hostAiId,
    initiator: activity.initiator,
    phase: activity.phase,
    endReason: activity.endReason,
  };
}

function toTimelineActivity(activity: TogetherListeningActivity): TogetherListeningTimelineActivity {
  return {
    id: activity.id,
    chatSessionId: activity.chatSessionId,
    hostAiId: activity.hostAiId,
    initiator: activity.initiator,
    phase: activity.phase,
    createdAtEpochMs: activity.createdAtEpochMs,
    updatedAtEpochMs: activity.updatedAtEpochMs,
    endReason: activity.endReason,
    activatedAtEpochMs: activity.activatedAtEpochMs,
    endedAtEpochMs: activity.endedAtEpochMs,
  };
}

function resultWithActivity(
  status: ChatTogetherListeningResultStatus,
  activity: TogetherListeningActivity | null,
  message: string,
  reason?: string,
): ChatTogetherListeningResult {
  return {
    status,
    activity: activity ? toChatActivity(activity) : null,
    ...(reason ? { reason } : {}),
    message,
  };
}

function describeActivityInProgress(activity: TogetherListeningActivity): string {
  switch (activity.phase) {
    case 'pending_user_response':
      return '已有一起听邀请正在等待你的回应。';
    case 'pending_ai_response':
      return '一起听邀请已发出，对方正在回应。';
    case 'active':
      return '已经在一起听中。';
    case 'declined_by_user':
    case 'declined_by_ai':
    case 'ended':
      throw new Error(`终态 Activity 不能作为 current 返回：${activity.phase}`);
  }
}

function mapUnavailableReason(snapshot: TogetherListeningRuntimeSnapshot): string {
  const netease = snapshot.netease;
  if (!('reason' in netease)) {
    throw new Error('可用的网易云 observation 不能映射为 unavailable');
  }
  return netease.reason === 'no_active_session'
    || netease.reason === 'playback_stopped'
    || netease.reason === 'playback_none'
    || netease.reason === 'playback_error'
    ? 'no_active_netease_playback'
    : netease.reason === 'permission_not_granted'
      || netease.reason === 'protected_app'
      || netease.reason === 'observation_failed'
      ? 'observation_unavailable'
      : 'playback_not_eligible';
}

function unavailableFromSnapshot(
  snapshot: TogetherListeningRuntimeSnapshot,
  activity: TogetherListeningActivity | null,
): ChatTogetherListeningResult {
  const netease = snapshot.netease;
  const reason = mapUnavailableReason(snapshot);
  const message = reason === 'no_active_netease_playback'
    ? '请先在网易云音乐播放一首歌，再来邀请一起听。'
    : reason === 'observation_unavailable'
      ? 'reason' in netease && netease.reason === 'permission_not_granted'
        ? 'RavenCat 需要通知使用权才能读取网易云当前播放状态。'
        : '暂时无法读取网易云播放状态，请稍后重试。'
      : '当前网易云播放不满足 Together Listening 条件。';
  return resultWithActivity('unavailable', activity, message, reason);
}

function isCurrentHost(snapshot: TogetherListeningRuntimeSnapshot, aiConfig: AIAssistantConfig): boolean {
  return snapshot.currentHostAiId !== null
    && snapshot.currentHostAiId === aiConfig.id;
}

async function endForMediaLoss(
  activity: TogetherListeningActivity,
): Promise<ChatTogetherListeningResult> {
  const result = await endTogetherListeningActivity({
    activityId: activity.id,
    reason: 'media_unavailable',
  });
  if (result.status === 'transitioned') {
    return resultWithActivity(
      'unavailable',
      result.activity,
      '网易云播放已结束，本次 Together Listening Activity 已结束。',
      'media_unavailable',
    );
  }
  return resultWithActivity(
    'transition_conflict',
    'activity' in result ? result.activity : activity,
    'Together Listening Activity 已被其他操作更新，本次操作未覆盖现有结果。',
    'transition_conflict',
  );
}

function transitionResult(
  result: Awaited<ReturnType<typeof acceptTogetherListeningInvitationByUser>>,
  status: 'invitation_accepted' | 'invitation_declined' | 'left',
  message: string,
): ChatTogetherListeningResult {
  if (result.status === 'transitioned') {
    return resultWithActivity(
      status,
      result.activity,
      result.projectionStatus === 'failed'
        ? `${message}（卡片稍后可按同一 Activity 重试同步。）`
        : message,
      result.projectionStatus === 'failed' ? 'chat_projection_failed' : undefined,
    );
  }
  return resultWithActivity(
    'transition_conflict',
    'activity' in result ? result.activity : null,
    'Together Listening Activity 已被其他操作更新，本次操作未覆盖现有结果。',
    'transition_conflict',
  );
}

async function readSnapshotForAction(
  params: Parameters<ChatTogetherListeningGateway['accept']>[0],
): Promise<
  | { snapshot: TogetherListeningRuntimeSnapshot; activity: TogetherListeningActivity }
  | { result: ChatTogetherListeningResult }
> {
  const snapshot = await captureTogetherListeningRuntimeSnapshot();
  if (!isCurrentHost(snapshot, params.aiConfig)) {
    return {
      result: resultWithActivity(
        'unavailable',
        snapshot.activity,
        '当前 AI 已不再是主理 AI，Together Listening 操作未执行。',
        'stale_host_authority',
      ),
    };
  }
  const activity = snapshot.activity;
  if (
    !activity
    || activity.id !== params.activityId
    || activity.chatSessionId !== params.chatSessionId
    || activity.hostAiId !== params.aiConfig.id
  ) {
    return {
      result: resultWithActivity(
        'transition_conflict',
        activity,
        '当前聊天没有这条可操作的 Together Listening Activity。',
        'activity_not_current',
      ),
    };
  }
  return { snapshot, activity };
}

export function createChatTogetherListeningGateway(): ChatTogetherListeningGateway & {
  projectActivityToChat(
    activity: TogetherListeningActivity,
    hint?: TogetherListeningTimelineProjectionHint,
  ): Promise<void>;
} {
  return {
    async projectActivityToChat(activity, hint) {
      await upsertTogetherListeningTimelineEntry(toTimelineActivity(activity), hint);
    },

    async invite(params) {
      const snapshot = await captureTogetherListeningRuntimeSnapshot();
      if (!isCurrentHost(snapshot, params.aiConfig)) {
        return resultWithActivity(
          'unavailable',
          snapshot.activity,
          '当前 AI 已不再是主理 AI，Together Listening 操作未执行。',
          'stale_host_authority',
        );
      }
      if (snapshot.activity) {
        return resultWithActivity(
          'activity_in_progress',
          snapshot.activity,
          describeActivityInProgress(snapshot.activity),
          'activity_in_progress',
        );
      }
      if (!snapshot.netease.available) {
        return unavailableFromSnapshot(snapshot, null);
      }

      const created = await createUserTogetherListeningInvitation({
        hostAiId: params.aiConfig.id,
        chatSessionId: params.chatSessionId,
      });
      if (created.status === 'non_terminal_activity_exists') {
        return resultWithActivity(
          'activity_in_progress',
          created.activity,
          describeActivityInProgress(created.activity),
          'activity_in_progress',
        );
      }
      if (created.status === 'projection_failed') {
        throw new Error('用户 Together Listening invitation 不应在 deferred projection 路径返回 projection_failed');
      }

      try {
        const committed = await commitTogetherListeningUserInvitation(
          toTimelineActivity(created.activity),
          params.aiConfig,
        );
        if (committed.userMessage) {
          return resultWithActivity(
            'invitation_created',
            created.activity,
            committed.success
              ? 'Together Listening 邀请已发出，正在等待 AI 回应。'
              : 'Together Listening 邀请卡已写入，但 AI 回应调度尚未完成。',
            committed.success ? undefined : 'execution_dispatch_failed',
          );
        }
      } catch (error) {
        console.warn('[TogetherListening] 用户邀请卡 canonical commit 失败：', error);
      }

      // 首张用户卡根本没有 commit 时，Activity 不能继续停留在 pending。
      const ended = await endTogetherListeningActivity({
        activityId: created.activity.id,
        reason: 'chat_unavailable',
      });
      return resultWithActivity(
        'failed',
        ended.status === 'transitioned'
          ? ended.activity
          : 'activity' in ended
            ? ended.activity
            : created.activity,
        '邀请卡无法写入当前聊天，Together Listening 未建立。',
        'chat_unavailable',
      );
    },

    async accept(params) {
      const loaded = await readSnapshotForAction(params);
      if ('result' in loaded) return loaded.result;
      if (loaded.activity.phase !== 'pending_user_response') {
        return resultWithActivity(
          'transition_conflict',
          loaded.activity,
          '当前 Together Listening 邀请已不在等待用户回应状态。',
          'invalid_phase',
        );
      }
      if (isExplicitTogetherListeningMediaLoss(loaded.snapshot.netease)) {
        return endForMediaLoss(loaded.activity);
      }
      if (!loaded.snapshot.netease.available) {
        return unavailableFromSnapshot(loaded.snapshot, loaded.activity);
      }
      return transitionResult(
        await acceptTogetherListeningInvitationByUser(loaded.activity.id),
        'invitation_accepted',
        '已接受 Together Listening 邀请。',
      );
    },

    async decline(params) {
      const loaded = await readSnapshotForAction(params);
      if ('result' in loaded) return loaded.result;
      if (loaded.activity.phase !== 'pending_user_response') {
        return resultWithActivity(
          'transition_conflict',
          loaded.activity,
          '当前 Together Listening 邀请已不在等待用户回应状态。',
          'invalid_phase',
        );
      }
      if (isExplicitTogetherListeningMediaLoss(loaded.snapshot.netease)) {
        return endForMediaLoss(loaded.activity);
      }
      const transition = await declineTogetherListeningInvitationByUser(loaded.activity.id);
      if (
        transition.status === 'transitioned'
        && transition.activity.phase === 'declined_by_user'
        && transition.activity.initiator === 'ai'
        // declined 卡片投影失败时用户仍看到 pending 卡，此时 post-decline
        // 普通消息会造成不一致；follow-up 必须等卡片终态投影成功后运行。
        && transition.projectionStatus === 'projected'
      ) {
        // CAS transition 是一次性触发边界；follow-up 是 commit 后可选沟通，
        // 其内部已完全隔离失败，不会改变本次拒绝结果。
        await runPostUserDeclineFollowUp(transition.activity);
      }
      return transitionResult(
        transition,
        'invitation_declined',
        '已拒绝 Together Listening 邀请。',
      );
    },

    async leave(params) {
      const result = await leaveTogetherListeningByUser({
        activityId: params.activityId,
        source: 'chat_card',
      });
      if (result.status === 'activity_not_current') {
        return resultWithActivity(
          'transition_conflict',
          result.activity,
          '当前聊天没有这条可操作的 Together Listening Activity。',
          'activity_not_current',
        );
      }
      if (result.status === 'invalid_phase') {
        return resultWithActivity(
          'transition_conflict',
          result.activity,
          '当前没有可退出的 active Together Listening Activity。',
          'invalid_phase',
        );
      }
      if (result.status === 'host_authority_lost') {
        if (result.transition.status !== 'transitioned') {
          return resultWithActivity(
            'transition_conflict',
            result.activity,
            'Together Listening Activity 已被其他操作更新，本次操作未覆盖现有结果。',
            'transition_conflict',
          );
        }
        return resultWithActivity(
          'unavailable',
          result.activity,
          '当前 AI 已不再是主理 AI，Together Listening Activity 已结束。',
          'stale_host_authority',
        );
      }
      if (result.status === 'media_unavailable') {
        if (result.transition.status !== 'transitioned') {
          return resultWithActivity(
            'transition_conflict',
            result.activity,
            'Together Listening Activity 已被其他操作更新，本次操作未覆盖现有结果。',
            'transition_conflict',
          );
        }
        return resultWithActivity(
          'unavailable',
          result.activity,
          '网易云播放已结束，本次 Together Listening Activity 已结束。',
          'media_unavailable',
        );
      }
      return transitionResult(
        result.transition,
        'left',
        '已退出 Together Listening。',
      );
    },
  };
}
