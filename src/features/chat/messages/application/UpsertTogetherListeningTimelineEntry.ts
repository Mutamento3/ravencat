/** Chat 对 Together Listening 暴露的窄投影命令。 */

import type { AIReplyConfig } from '../../reply/application/ChatReplyTypes';
import { databaseCoordinator } from '@platform/persistence';
import type { ChatMessage, CreateMessageInput } from '../domain/ChatMessage';
import {
  buildTogetherListeningMessageMetadata,
  getTogetherListeningPreviewText,
  type TogetherListeningMessageEndReason,
  type TogetherListeningMessagePhase,
  type TogetherListeningEndedMessageMetadata,
} from '../domain/chatMessageMetadata';
import { emitChatMessagesPatched, emitChatMessagesUpdated } from '../events/ChatEvents';
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import { commitAndDispatchCanonicalUserMessage } from './CommitAndDispatchCanonicalUserMessage';
import { upsertStatefulTimelineEntry } from './UpsertStatefulTimelineEntry';
import { getChatGroupRuntimeDependencies } from '../../group/application/ChatGroupRuntime';
import { ChatReplyRunCancelledError } from '../../reply/application/ChatReplyAbort';

interface TogetherListeningTimelineActivityBase {
  id: string;
  chatSessionId: string;
  hostAiId: string;
  initiator: 'user' | 'ai';
  phase: TogetherListeningMessagePhase;
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
  /** canonical Activity 进入 active 的时间；pending 与 declined 为 null。 */
  activatedAtEpochMs: number | null;
  /** canonical Activity 进入终态的时间；非终态为 null。 */
  endedAtEpochMs: number | null;
}

/** AI 主动退出时，Host 负责提供已经解析的显示名字；Chat 不重新查询助手身份。 */
export type TogetherListeningTimelineActivity = TogetherListeningTimelineActivityBase & (
  | { endReason: 'ai_left'; hostAiName: string }
  | { endReason: Exclude<TogetherListeningMessageEndReason, 'ai_left'> | null }
);

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
  groupSpeechTaskId?: string;
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
  const repository = getChatMessageRuntimeDependencies().messages;
  const groups = getChatGroupRuntimeDependencies().groups;
  const group = await groups.getById(activity.chatSessionId);
  if (group) {
    const actor = group.members.find((member) => member.aiAssistantId === activity.hostAiId);
    message.agentId = actor?.agentId ?? null;
    message.metadataJson = JSON.stringify({ ...JSON.parse(message.metadataJson!), actorAIId: activity.hostAiId,
      actorAgentId: actor?.agentId ?? null, actorName: actor?.name ?? 'AI', groupChat: { groupId: group.group.id, groupName: group.group.name } });
  }
  if (group && activity.phase !== 'ended') {
    const result = await databaseCoordinator.transaction({ name: 'chat.project-group-listening-invitation', feature: 'chat', priority: 'interactive' }, async (transaction) => {
      if (hint?.groupSpeechTaskId && !await groups.isSpeechTaskRunCurrentInTransaction(transaction, hint.groupSpeechTaskId)) throw new ChatReplyRunCancelledError('superseded');
      const result = await repository.upsertStatefulTimelineEntryInTransaction(transaction, { message, previewText: getTogetherListeningPreviewText(activity.phase) });
      await groups.updatePreviewInTransaction(transaction, activity.chatSessionId, result.message.id, getTogetherListeningPreviewText(activity.phase), result.message.createdAt);
      return result;
    });
    emitChatMessagesUpdated(activity.chatSessionId);
    return result;
  }
  if (activity.phase === 'ended') {
    const endedDate = new Date(activity.updatedAtEpochMs);
    const text = activity.endReason === 'user_left'
      ? '你已退出一起听，本次一起听已结束。'
      : activity.endReason === 'ai_left'
        ? `${activity.hostAiName}已退出一起听，本次一起听已结束。`
        : '本次一起听活动已结束。';
    const metadata: TogetherListeningEndedMessageMetadata = {
      type: 'togetherListeningEnded', source: 'togetherListening', phase: 'ended',
      activityId: activity.id, initiator: activity.initiator, endReason: activity.endReason,
      activatedAtEpochMs: activity.activatedAtEpochMs, endedAtEpochMs: activity.endedAtEpochMs,
    };
    const endedMessage: CreateMessageInput = {
      ...message, text, senderType: 'system', isMe: false,
      clientMessageId: `together-listening-ended:${activity.id}`,
      createdAt: endedDate.toISOString(), updatedAt: endedDate.toISOString(), time: formatMessageTime(endedDate),
      metadataJson: JSON.stringify(metadata), turnRunId: null, turnItemIndex: null,
    };
    const database = databaseCoordinator.openTaskExecutor({
      name: 'chat.projectTogetherListeningEnd', feature: 'chat', priority: 'interactive',
    });
    // 旧卡更新与新结束事件必须一起提交；稳定事件键保证重复投影不追加第二条退出记录。
    const [card, event] = await database.withExclusiveTransactionAsync(async (transaction) => {
      const card = await repository.upsertStatefulTimelineEntryInTransaction(transaction, {
        message, previewText: getTogetherListeningPreviewText(activity.phase),
      });
      const event = await repository.upsertStatefulTimelineEntryInTransaction(transaction, {
        message: endedMessage, previewText: null,
      });
      if (group) await groups.updatePreviewInTransaction(transaction, activity.chatSessionId, event.message.id, getTogetherListeningPreviewText(activity.phase), event.message.createdAt);
      return [card, event];
    });
    const patchedMessageIds = [card, event].filter((entry) => !entry.inserted).map((entry) => entry.message.id);
    if (patchedMessageIds.length > 0) {
      emitChatMessagesPatched({ sessionId: activity.chatSessionId, updatedMessageIds: patchedMessageIds });
    }
    if (card.inserted || event.inserted) {
      emitChatMessagesUpdated(activity.chatSessionId);
    }
    return card;
  }
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
