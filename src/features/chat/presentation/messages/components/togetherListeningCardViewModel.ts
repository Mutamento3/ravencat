/** 将 Together Listening Chat metadata 转换为稳定、可测试的卡片展示模型。 */

import {
  isTogetherListeningMessageMetadata,
  type ParsedChatMessageMetadata,
  type TogetherListeningMessageMetadata,
  type TogetherListeningMessageEndReason,
  type TogetherListeningMessagePhase,
} from '@features/chat/messages/domain/chatMessageMetadata';

export type TogetherListeningCardAction = 'accept' | 'decline' | 'leave';

export interface TogetherListeningActivityCardViewModel {
  activityId: string;
  initiator: TogetherListeningMessageMetadata['initiator'];
  phase: TogetherListeningMessagePhase;
  endReason: TogetherListeningMessageEndReason | null;
  isMe: boolean;
  title: string;
  body: string;
  /** 历史 Activity 持续时长；只有 ended 且两个 lifecycle timestamp 合法时才有值。 */
  durationText: string | null;
  actions: readonly TogetherListeningCardAction[];
}

export interface TogetherListeningCardPresentationIdentity {
  role: 'user' | 'ai';
  isMe: boolean;
  avatarContent: string | null;
  name: string | null;
}

export function resolveTogetherListeningCardPresentationIdentity(
  initiator: TogetherListeningMessageMetadata['initiator'],
  identities: {
    user: { avatar?: string | null; name?: string | null };
    ai: { avatar?: string | null; name?: string | null };
  },
): TogetherListeningCardPresentationIdentity {
  const isUser = initiator === 'user';
  const identity = isUser ? identities.user : identities.ai;
  return {
    role: isUser ? 'user' : 'ai',
    isMe: isUser,
    avatarContent: identity.avatar ?? null,
    name: identity.name ?? null,
  };
}

/**
 * Chat metadata 来自 SQLite JSON；这里只识别 Together card 所需的稳定字段，
 * 不把未知字段带入 presentation，也不把媒体播放事实放进 card。
 */
export function parseTogetherListeningMessageMetadata(
  metadata: ParsedChatMessageMetadata | null | undefined,
): TogetherListeningMessageMetadata | null {
  return isTogetherListeningMessageMetadata(metadata) ? metadata : null;
}

/** 与 LISTEN-6.1 indicator 一致的时钟格式：小于 1h 为 MM:SS，1h 起为 H:MM:SS。 */
function formatTogetherListeningClock(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(totalMinutes)}:${pad(seconds)}`;
}

/**
 * 历史 Together duration 只由 canonical Activity 的两个 lifecycle timestamp 推导。
 *
 * 暂停、缓冲与网易云切换都计入 duration，因为这里表达的是 Activity 维持了多久，
 * 而不是真实音频播放了多久。数据不足或非法时返回 null：历史展示宁缺勿错，
 * 不允许伪造 `00:00`。
 */
export function formatTogetherListeningHistoricalDuration(
  activatedAtEpochMs: number | null | undefined,
  endedAtEpochMs: number | null | undefined,
): string | null {
  if (
    typeof activatedAtEpochMs !== 'number'
    || typeof endedAtEpochMs !== 'number'
    || !Number.isFinite(activatedAtEpochMs)
    || !Number.isFinite(endedAtEpochMs)
    || endedAtEpochMs < activatedAtEpochMs
  ) {
    return null;
  }
  return formatTogetherListeningClock(endedAtEpochMs - activatedAtEpochMs);
}

/** 只有 ended 卡显示历史时长；declined 没有真正的 Activity，不显示 duration。 */
function resolveHistoricalDurationText(
  metadata: TogetherListeningMessageMetadata,
): string | null {
  if (metadata.phase !== 'ended') {
    return null;
  }
  return formatTogetherListeningHistoricalDuration(
    metadata.activatedAtEpochMs,
    metadata.endedAtEpochMs,
  );
}

function resolveEndedBody(reason: TogetherListeningMessageEndReason | null): string {
  switch (reason) {
    case 'user_left':
      return '你已退出一起听';
    case 'ai_left':
      return 'TA 已退出一起听';
    case 'media_unavailable':
      return '网易云音乐播放已结束，本次一起听已结束';
    case 'chat_unavailable':
      return '一起听邀请未能显示';
    case 'host_authority_lost':
    case 'runtime_reconciliation':
    case 'unknown':
    case null:
      return '本次一起听已结束';
  }
}

export function buildTogetherListeningActivityCardViewModel(
  metadata: TogetherListeningMessageMetadata,
): TogetherListeningActivityCardViewModel {
  const isMe = metadata.initiator === 'user';
  const durationText = resolveHistoricalDurationText(metadata);
  switch (metadata.phase) {
    case 'pending_user_response':
      return {
        activityId: metadata.activityId,
        initiator: metadata.initiator,
        phase: metadata.phase,
        endReason: metadata.endReason,
        isMe,
        title: '🎧 一起听',
        body: 'TA 邀请你一起听网易云音乐',
        durationText,
        actions: ['decline', 'accept'],
      };
    case 'pending_ai_response':
      return {
        activityId: metadata.activityId,
        initiator: metadata.initiator,
        phase: metadata.phase,
        endReason: metadata.endReason,
        isMe,
        title: '🎧 一起听',
        body: '已向 TA 发出邀请\n等待回应…',
        durationText,
        actions: [],
      };
    case 'active':
      return {
        activityId: metadata.activityId,
        initiator: metadata.initiator,
        phase: metadata.phase,
        endReason: metadata.endReason,
        isMe,
        title: '🎧 正在一起听',
        body: '正在一起听',
        durationText,
        actions: ['leave'],
      };
    case 'declined_by_user':
      return {
        activityId: metadata.activityId,
        initiator: metadata.initiator,
        phase: metadata.phase,
        endReason: metadata.endReason,
        isMe,
        title: '🎧 一起听邀请已拒绝',
        body: '你已拒绝一起听邀请',
        durationText,
        actions: [],
      };
    case 'declined_by_ai':
      return {
        activityId: metadata.activityId,
        initiator: metadata.initiator,
        phase: metadata.phase,
        endReason: metadata.endReason,
        isMe,
        title: '🎧 一起听邀请已拒绝',
        body: 'TA 已拒绝一起听邀请',
        durationText,
        actions: [],
      };
    case 'ended':
      return {
        activityId: metadata.activityId,
        initiator: metadata.initiator,
        phase: metadata.phase,
        endReason: metadata.endReason,
        isMe,
        title: '🎧 一起听已结束',
        body: resolveEndedBody(metadata.endReason),
        durationText,
        actions: [],
      };
  }
}
