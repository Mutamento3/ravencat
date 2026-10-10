import type { TogetherListeningActivity } from '../domain/TogetherListeningActivity';
import {
  endTogetherListeningActivity,
  leaveTogetherListeningActivityByUser,
  type TogetherListeningTransitionResult,
} from './TogetherListeningLifecycle';
import {
  captureTogetherListeningRuntimeSnapshot,
  isExplicitTogetherListeningMediaLoss,
} from './TogetherListeningRuntimeAwareness';

export type TogetherListeningUserLeaveSource =
  | 'chat_card'
  | 'in_app_indicator'
  | 'system_capsule';

export type LeaveTogetherListeningByUserResult =
  | {
      status: 'left';
      activity: TogetherListeningActivity;
      transition: TogetherListeningTransitionResult;
    }
  | {
      status: 'media_unavailable';
      activity: TogetherListeningActivity;
      transition: TogetherListeningTransitionResult;
    }
  | {
      status: 'host_authority_lost';
      activity: TogetherListeningActivity;
      transition: TogetherListeningTransitionResult;
    }
  | {
      status: 'activity_not_current';
      activity: TogetherListeningActivity | null;
    }
  | {
      status: 'invalid_phase';
      activity: TogetherListeningActivity | null;
    };

/** 所有用户退出入口共享的 command；source 仅保留调用来源，不参与 phase。 */
export async function leaveTogetherListeningByUser(input: {
  activityId: string;
  source: TogetherListeningUserLeaveSource;
}): Promise<LeaveTogetherListeningByUserResult> {
  void input.source;
  const snapshot = await captureTogetherListeningRuntimeSnapshot();
  const activity = snapshot.activity;
  if (!activity || activity.id !== input.activityId) {
    return { status: 'activity_not_current', activity };
  }
  if (activity.hostAiId !== snapshot.currentHostAiId) {
    const transition = await endTogetherListeningActivity({
      activityId: activity.id,
      reason: 'host_authority_lost',
    });
    return {
      status: 'host_authority_lost',
      activity: 'activity' in transition ? transition.activity : activity,
      transition,
    };
  }
  if (activity.phase !== 'active') {
    return { status: 'invalid_phase', activity };
  }
  if (isExplicitTogetherListeningMediaLoss(snapshot.netease)) {
    const transition = await endTogetherListeningActivity({
      activityId: activity.id,
      reason: 'media_unavailable',
    });
    return {
      status: 'media_unavailable',
      activity: 'activity' in transition ? transition.activity : activity,
      transition,
    };
  }
  const transition = await leaveTogetherListeningActivityByUser(activity.id);
  return {
    status: 'left',
    activity: 'activity' in transition ? transition.activity : activity,
    transition,
  };
}
