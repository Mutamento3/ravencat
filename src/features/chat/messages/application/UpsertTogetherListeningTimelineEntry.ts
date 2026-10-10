/** Chat 对 Together Listening 暴露的窄投影命令。 */

import type { AIReplyConfig } from '../../reply/application/ChatReplyTypes';
import type { ChatMessage, CreateMessageInput } from '../domain/ChatMessage';
import {
  buildTogetherListeningMessageMetadata,
  getTogetherListeningPreviewText,
  type TogetherListeningMessageEndReason,
  type TogetherListeningMessagePhase,
} from '../domain/chatMessageMetadata';
import { commitAndDispatchCanonicalUserMessage } from './CommitAndDispatchCanonicalUserMessage';
import { upsertStatefulTimelineEntry } from './UpsertStatefulTimelineEntry';

export interface TogetherListeningTimelineActivity {
  id: string;
  chatSessionId: string;
  hostAiId: string;
  initiator: 'user' | 'ai';
  phase: TogetherListeningMessagePhase;
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
  endReason: TogetherListeningMessageEndReason | null;
  /** canonical Activity 进入 active 的时间；pending 与 declined 为 null。 */
  activatedAtEpochMs: number | null;
  /** canonical Activity 进入终态的时间；非终态为 null。 */
  endedAtEpochMs: number | null;
}

export interface UpsertTogetherListeningTimelineEntryResult {
  message: ChatMessage;
  inserted: boolean;
}

/**
 * 首张卡投影的排序 hint：AI 在 Agent run 内发起邀请时携带该 run 的标识，
 * 使卡片作为 run-associated external item 排在 tool 调用之后、后续 assistant
 * 文本之前。hint 只在首次插入生效；lifecycle patch 不改写排序身份。
 */
export interface TogetherListeningTimelineProjectionHint {
  timelineRunId?: string;
}

function formatMessageTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function buildMessage(
  activity: TogetherListeningTimelineActivity,
  hint?: TogetherListeningTimelineProjectionHint,
): CreateMessageInput {
  const createdDate = new Date(activity.createdAtEpochMs);
  const updatedDate = new Date(activity.updatedAtEpochMs);
  const isUserInitiated = activity.initiator === 'user';
  return {
    sessionId: activity.chatSessionId,
    text: isUserInitiated
      ? '用户邀请你一起听网易云音乐。'
      : 'AI 邀请用户一起听网易云音乐。',
    isMe: isUserInitiated,
    senderType: isUserInitiated ? 'user' : 'assistant',
    agentId: null,
    apiMessageId: null,
    clientMessageId: `together-listening:${activity.id}`,
    time: formatMessageTime(createdDate),
    createdAt: createdDate.toISOString(),
    updatedAt: updatedDate.toISOString(),
    replyToId: null,
    replyToText: null,
    status: 'sent',
    deliveryStatus: 'delivered',
    tokensUsed: 0,
    promptTokens: 0,
    completionTokens: 0,
    metadataJson: JSON.stringify(buildTogetherListeningMessageMetadata({
      activityId: activity.id,
      initiator: activity.initiator,
      phase: activity.phase,
      endReason: activity.endReason,
      activatedAtEpochMs: activity.activatedAtEpochMs,
      endedAtEpochMs: activity.endedAtEpochMs,
    })),
    isRead: true,
    turnRunId: hint?.timelineRunId ?? null,
    turnItemIndex: null,
  };
}

export async function upsertTogetherListeningTimelineEntry(
  activity: TogetherListeningTimelineActivity,
  hint?: TogetherListeningTimelineProjectionHint,
): Promise<UpsertTogetherListeningTimelineEntryResult> {
  const message = buildMessage(activity, hint);
  return upsertStatefulTimelineEntry({
    message,
    previewText: getTogetherListeningPreviewText(activity.phase),
  });
}

/** 用户首次邀请卡本身就是 canonical user turn，不能额外插入普通文字气泡。 */
export async function commitTogetherListeningUserInvitation(
  activity: TogetherListeningTimelineActivity,
  aiConfig: AIReplyConfig,
) {
  if (activity.initiator !== 'user' || activity.phase !== 'pending_ai_response') {
    throw new Error('只有首次用户 Together Listening 邀请可以提交 canonical card');
  }
  return commitAndDispatchCanonicalUserMessage({
    message: buildMessage(activity),
    previewText: getTogetherListeningPreviewText(activity.phase),
    aiConfig,
  });
}
