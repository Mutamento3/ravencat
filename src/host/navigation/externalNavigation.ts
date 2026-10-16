/** 在宿主边界规范化设备通知目标，再交给内部路由处理。 */
import { CommonActions, type NavigationContainerRef, type ParamListBase } from '@react-navigation/native';

export type ExternalNavigationTarget =
  | {
      type: 'ai-message' | 'ai-message-summary';
      aiId: string;
      sessionId: string | null;
      notificationId?: string | null;
    }
  | {
      type: 'group-message';
      groupId: string;
      notificationId?: string | null;
    }
  | {
      type: 'ai-incoming-call';
      aiId: string;
      sessionId: string;
      callId: string;
      notificationAction: 'open' | 'accept' | 'reject';
      notificationId?: string | null;
    }
  | {
      type: 'together-listening';
      activityId: string;
      aiId: string;
      sessionId: string;
      notificationAction: 'open' | 'leave';
      notificationId?: string | null;
    };

function normalizeRequiredId(value: string | null | undefined): string | null {
  const normalized = value?.trim() || '';
  return normalized || null;
}

export function createMessageNavigationTarget(input: {
  type?: 'ai-message' | 'ai-message-summary';
  aiId?: string | null;
  sessionId?: string | null;
  notificationId?: string | null;
  conversationKind?: 'direct' | 'group' | null;
  groupId?: string | null;
}): ExternalNavigationTarget | null {
  // 群聊通知按 groupId 建群会话目标，不走 aiId 私聊路由。
  const groupId = normalizeRequiredId(input.groupId);
  if (input.conversationKind === 'group' && groupId) {
    return {
      type: 'group-message',
      groupId,
      notificationId: normalizeRequiredId(input.notificationId),
    };
  }

  const aiId = normalizeRequiredId(input.aiId);
  if (!aiId) {
    return null;
  }

  return {
    type: input.type || 'ai-message',
    aiId,
    sessionId: normalizeRequiredId(input.sessionId),
    notificationId: normalizeRequiredId(input.notificationId),
  };
}

export function createCallNavigationTarget(input: {
  aiId?: string | null;
  sessionId?: string | null;
  callId?: string | null;
  notificationAction?: 'open' | 'accept' | 'reject';
  notificationId?: string | null;
}): ExternalNavigationTarget | null {
  const aiId = normalizeRequiredId(input.aiId);
  const sessionId = normalizeRequiredId(input.sessionId);
  const callId = normalizeRequiredId(input.callId);
  if (!aiId || !sessionId || !callId) {
    return null;
  }

  return {
    type: 'ai-incoming-call',
    aiId,
    sessionId,
    callId,
    notificationAction: input.notificationAction || 'open',
    notificationId: normalizeRequiredId(input.notificationId),
  };
}

/**
 * Together Listening ongoing surface 的打开/退出目标。
 * 它不是一次性 message event：同一条 ongoing notification 的重复点击必须始终允许，
 * 因此调用方不得把它加入一次性 dedupe 集合（见 isOneShotExternalNavigationTarget）。
 */
export function createTogetherListeningNavigationTarget(input: {
  activityId?: string | null;
  aiId?: string | null;
  sessionId?: string | null;
  notificationAction?: 'open' | 'leave';
  notificationId?: string | null;
}): ExternalNavigationTarget | null {
  const activityId = normalizeRequiredId(input.activityId);
  const aiId = normalizeRequiredId(input.aiId);
  const sessionId = normalizeRequiredId(input.sessionId);
  if (!activityId || !aiId || !sessionId) {
    return null;
  }

  return {
    type: 'together-listening',
    activityId,
    aiId,
    sessionId,
    notificationAction: input.notificationAction === 'leave' ? 'leave' : 'open',
    notificationId: normalizeRequiredId(input.notificationId),
  };
}

/**
 * 是否按一次性事件去重。message / call 通知是离散事件，重复投递只处理一次；
 * Together ongoing surface 的 notificationId 是稳定 identity 而非事件 ID，
 * 重复点击与后续新 Activity 都必须允许再次执行。
 */
export function isOneShotExternalNavigationTarget(target: ExternalNavigationTarget): boolean {
  if (target.type === 'together-listening') {
    return false;
  }
  return Boolean(target.notificationId) || target.type === 'ai-incoming-call';
}

export function getExternalNavigationKey(target: ExternalNavigationTarget): string {
  if (target.type === 'ai-incoming-call') {
    return [
      target.type,
      target.notificationId || '',
      target.callId,
      target.notificationAction,
    ].join(':');
  }

  if (target.type === 'together-listening') {
    return [
      target.type,
      target.activityId,
      target.notificationAction,
    ].join(':');
  }

  if (target.type === 'group-message') {
    return [
      target.type,
      target.notificationId || '',
      target.groupId,
    ].join(':');
  }

  return [
    target.type,
    target.notificationId || '',
    target.aiId,
    target.sessionId || '',
  ].join(':');
}

/** 已有会话只弹出上层页面；新会话压栈，保留列表与原生 Screen 的顺序。 */
export function openMessageConversation(
  navigation: Pick<NavigationContainerRef<ParamListBase>, 'dispatch'>,
  target: Extract<ExternalNavigationTarget, { type: 'ai-message' | 'ai-message-summary' | 'group-message' }>,
): void {
  const group = target.type === 'group-message';
  // pop 只在目标已存在时回退；dismissTo 在目标不存在时会替换当前页，丢掉列表。
  navigation.dispatch(CommonActions.navigate(
    group ? 'chat/groups/[groupId]' : 'chat/[aiId]/index',
    group
      ? { groupId: target.groupId }
      : { aiId: target.aiId, ...(target.sessionId ? { sessionId: target.sessionId } : {}) },
    { pop: true },
  ));
}
