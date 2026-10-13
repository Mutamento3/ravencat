/** Chat 对外 assistant 消息命令：批量提交时间线，并在 commit 后统一完成派生投影。 */

import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import {
  emitAIMessageReceived,
  notifyAIMessageObservers,
  resolveAIMessageDeliveryKind,
  type AIMessageDeliveryKind,
  type AIMessageDeliveryReceipt,
} from '../../reply/delivery/AIMessageEvents';
import { emitChatMessagesUpdated } from '../events/ChatEvents';
import type { ChatMessage, CreateMessageInput } from '../domain/ChatMessage';
import { beginAssistantMessageArrival, finishAssistantMessageArrival } from '../../reply/delivery/AssistantMessageArrival';
import { databaseCoordinator } from '@platform/persistence';
import { getChatGroupRuntimeDependencies } from '../../group/application/ChatGroupRuntime';

export interface AppendExternalAssistantMessageParams {
  sessionId: string;
  text: string;
  aiId?: string | null;
  aiName?: string | null;
  aiAvatar?: string | null;
  agentId?: string | null;
  apiMessageId?: string | null;
  clientMessageId?: string | null;
  deliveryKind?: AIMessageDeliveryKind;
  /** 默认交给 delivery coordinator；none 仍提交 Chat 事实但不触发用户交付。 */
  delivery?: 'default' | 'none';
  triggerSource?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  /** 关联当前 Agent run；NULL item index 表示 run-associated external item。 */
  timelineRunId?: string | null;
  /** 写入每个消息段 metadata_json 的稳定业务字段。 */
  metadata?: Record<string, unknown> | null;
  logicalMessageId?: string | null;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AppendExternalAssistantMessagesParams {
  sessionId: string;
  segments: readonly string[];
  aiId?: string | null;
  aiName?: string | null;
  aiAvatar?: string | null;
  agentId?: string | null;
  apiMessageId?: string | null;
  clientMessageId?: string | null;
  deliveryKind?: AIMessageDeliveryKind;
  /** 默认交给 delivery coordinator；none 仍提交 Chat 事实但不触发用户交付。 */
  delivery?: 'default' | 'none';
  triggerSource?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  /** 关联当前 Agent run；由公共时间线排序规则决定其在 run 内的位置。 */
  timelineRunId?: string | null;
  /** 写入每个消息段 metadata_json 的稳定业务字段。 */
  metadata?: Record<string, unknown> | null;
  /** 外部旁路消息默认不生成逻辑分段 ID；调用方需要时显式传入。 */
  logicalMessageId?: string | null;
  previewText?: string | null;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AppendExternalAssistantMessageResult {
  message: ChatMessage;
  committedMessageId: number;
  deliveryReceipt: AIMessageDeliveryReceipt | null;
}

export interface AppendExternalAssistantMessagesResult {
  messages: ChatMessage[];
  committedMessageIds: number[];
  deliveryReceipts: AIMessageDeliveryReceipt[];
  logicalMessageId: string | null;
  segmentTotal: number;
}

function formatMessageTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function buildMessageMetadata(
  params: AppendExternalAssistantMessagesParams,
  segmentIndex: number,
  segmentTotal: number,
): string | null {
  const metadata = {
    ...(params.metadata || {}),
    ...(params.triggerSource !== undefined
      ? { triggerSource: params.triggerSource }
      : {}),
    ...(params.relatedEntityType !== undefined
      ? { relatedEntityType: params.relatedEntityType }
      : {}),
    ...(params.relatedEntityId !== undefined
      ? { relatedEntityId: params.relatedEntityId }
      : {}),
    segmentIndex,
    segmentTotal,
  };

  return Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
}

function buildCreateMessages(
  params: AppendExternalAssistantMessagesParams,
  segments: string[],
): CreateMessageInput[] {
  const segmentTotal = segments.length;
  const logicalMessageId = params.logicalMessageId ?? null;

  return segments.map((text, segmentIndex) => {
    const now = new Date();
    const createdAt = now.toISOString();
    return {
      sessionId: params.sessionId,
      text,
      isMe: false,
      senderType: 'assistant' as const,
      agentId: params.agentId ?? null,
      apiMessageId: params.apiMessageId ?? null,
      clientMessageId: params.clientMessageId ?? null,
      time: formatMessageTime(now),
      createdAt,
      updatedAt: createdAt,
      replyToId: null,
      replyToText: null,
      status: 'sent' as const,
      deliveryStatus: 'delivered' as const,
      logicalMessageId,
      segmentIndex,
      segmentTotal,
      tokensUsed: segmentIndex === segmentTotal - 1 ? params.tokensUsed ?? 0 : 0,
      promptTokens: segmentIndex === segmentTotal - 1 ? params.promptTokens ?? 0 : 0,
      completionTokens: segmentIndex === segmentTotal - 1 ? params.completionTokens ?? 0 : 0,
      turnRunId: params.timelineRunId ?? null,
      turnItemIndex: null,
      metadataJson: buildMessageMetadata(params, segmentIndex, segmentTotal),
    };
  });
}

async function deliverCommittedAssistantMessage(
  params: AppendExternalAssistantMessagesParams,
  message: ChatMessage,
  deliveryKind: AIMessageDeliveryKind,
  deliver: typeof emitAIMessageReceived,
  notify: typeof notifyAIMessageObservers,
): Promise<AIMessageDeliveryReceipt | null> {
  if (!params.aiId || !params.aiName) {
    return null;
  }

  const payload = {
    aiId: params.aiId,
    agentId: params.agentId ?? null,
    aiName: params.aiName,
    aiAvatar: params.aiAvatar ?? null,
    sessionId: message.sessionId,
    message: message.text,
    logicalMessageId: message.logicalMessageId || null,
    segmentIndex: message.segmentIndex ?? 0,
    segmentTotal: message.segmentTotal ?? 1,
    committedMessageId: message.id,
    deliveryKind,
    triggerSource: params.triggerSource ?? null,
    relatedEntityType: params.relatedEntityType ?? null,
    relatedEntityId: params.relatedEntityId ?? null,
  };

  if (params.delivery === 'none') {
    // 免交付事实（如通话文本已在通话界面消费）：不触发系统交付，
    // 但仍通知 UI 观察者刷新会话列表/未读等投影。
    notify(payload);
    return null;
  }

  return deliver(payload);
}

export async function appendExternalAssistantMessage(
  params: AppendExternalAssistantMessageParams,
): Promise<AppendExternalAssistantMessageResult> {
  const result = await appendExternalAssistantMessages(
    {
      ...params,
      segments: [params.text],
    },
  );

  const [message] = result.messages;
  const [deliveryReceipt] = result.deliveryReceipts;
  if (!message) {
    throw new Error('外部 assistant 消息提交未返回 committed message');
  }

  return {
    message,
    committedMessageId: message.id,
    deliveryReceipt: deliveryReceipt ?? null,
  };
}

export async function appendExternalAssistantMessages(
  params: AppendExternalAssistantMessagesParams,
): Promise<AppendExternalAssistantMessagesResult> {
  const segments = params.segments
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!params.sessionId || segments.length === 0) {
    throw new Error('sessionId 和 segments 不能为空');
  }

  const repository = getChatMessageRuntimeDependencies().messages;
  const deliveryKind = params.deliveryKind
    ?? resolveAIMessageDeliveryKind(params.triggerSource);
  const messages = buildCreateMessages(params, segments);
  const previewText = params.previewText ?? segments[segments.length - 1]!;
  const groups = getChatGroupRuntimeDependencies().groups;
  const group = await groups.getById(params.sessionId);
  if (group) {
    const actor = group.members.find((member) => member.aiAssistantId === params.aiId);
    for (const message of messages) {
      message.metadataJson = JSON.stringify({ ...JSON.parse(message.metadataJson!),
        actorAIId: params.aiId, actorAgentId: params.agentId, actorName: actor?.name ?? params.aiName,
        groupChat: { groupId: group.group.id, groupName: group.group.name } });
    }
  }
  // 外部业务仍通过共同消息命令提交，群列表投影与正文由各自 owner 在同一事务交接。
  const insertedMessages = group
    ? await databaseCoordinator.transaction({ name: 'chat.external-group-assistant', feature: 'chat', priority: 'interactive' }, async (transaction) => {
      const committed = await repository.commitMessagesInTransaction(transaction, { messages, previewText: null });
      const last = committed[committed.length - 1];
      await groups.updatePreviewInTransaction(transaction, params.sessionId, last.id, previewText, last.createdAt);
      return committed;
    })
    : await repository.commitMessages({ messages, previewText });

  const tracksArrival = Boolean(params.aiId && params.aiName && params.delivery !== 'none');
  const messageIds = insertedMessages.map((message) => message.id);
  const deliveryReceipts: AIMessageDeliveryReceipt[] = [];
  try {
    if (tracksArrival) {
      await beginAssistantMessageArrival({
        observer: { sessionId: params.sessionId, aiId: params.aiId, aiName: params.aiName },
        messageIds,
      });
    }
    emitChatMessagesUpdated(params.sessionId);
    for (const message of insertedMessages) {
      const deliveryReceipt = await deliverCommittedAssistantMessage(
        params,
        message,
        deliveryKind,
        emitAIMessageReceived,
        notifyAIMessageObservers,
      );
      if (deliveryReceipt) deliveryReceipts.push(deliveryReceipt);
    }
  } finally {
    if (tracksArrival) await finishAssistantMessageArrival(messageIds);
  }

  return {
    messages: insertedMessages,
    committedMessageIds: insertedMessages.map((message) => message.id),
    deliveryReceipts,
    logicalMessageId: params.logicalMessageId ?? null,
    segmentTotal: insertedMessages.length,
  };
}
