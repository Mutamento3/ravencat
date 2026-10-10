/**
 * @fileoverview ReceiveExternalAIMessage UseCase - 接收外部触发的 AI 消息
 */

import { buildAssistantMessagePreviewText } from '@features/chat/messages/domain';
import type { ChatMessage, SenderType } from '../domain/ChatMessage';
import type { IMessageRepository } from '../domain/MessageRepository';
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import {
  emitAIMessageReceived,
  resolveAIMessageDeliveryKind,
  type AIMessageDeliveryKind,
} from '../../reply/delivery/AIMessageEvents';
import { emitChatMessagesUpdated } from '../events/ChatEvents';
import { persistChatMessage } from './MessagePersistence';
import { deliverAssistantMessage } from '../../reply/application/AssistantMessageDelivery';


function formatMessageTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export interface ReceiveExternalAIMessageParams {
  sessionId: string;
  text: string;
  aiId?: string | null;
  aiName?: string | null;
  aiAvatar?: string | null;
  agentId?: string | null;
  senderType?: Extract<SenderType, 'assistant' | 'system' | 'tool' | 'reasoning'>;
  deliveryKind?: AIMessageDeliveryKind;
  triggerSource?: string | null;
  apiMessageId?: string | null;
  clientMessageId?: string | null;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface ReceiveExternalAIMessageResult {
  success: boolean;
  message: ChatMessage | null;
  error: string | null;
}

/** Chat 内部/Host composition 与测试使用的仓储注入端口。 */
export interface ReceiveExternalAIMessageDeps {
  repository?: IMessageRepository;
}

/**
 * Chat 内部依赖注入入口；普通公共 facade 不暴露 repository 参数。
 */
export async function receiveExternalAIMessageInternal(
  params: ReceiveExternalAIMessageParams,
  deps: ReceiveExternalAIMessageDeps = {}
): Promise<ReceiveExternalAIMessageResult> {
  const {
    sessionId,
    text,
    aiId = null,
    aiName = null,
    aiAvatar = null,
    agentId = null,
    senderType = 'assistant',
    deliveryKind,
    triggerSource = null,
    apiMessageId = null,
    clientMessageId = null,
    tokensUsed = 0,
    promptTokens = 0,
    completionTokens = 0,
  } = params;

  const repo = deps.repository ?? getChatMessageRuntimeDependencies().messages;

  if (!sessionId || !text?.trim()) {
    return {
      success: false,
      message: null,
      error: 'sessionId 和 text 不能为空',
    };
  }

  const now = new Date();
  const timeStr = formatMessageTime(now);
  const createdAt = now.toISOString();

  try {
    const normalizedText = text.trim();
    const deliveryKindResolved = deliveryKind || resolveAIMessageDeliveryKind(triggerSource);
    const baseMessage = {
      sessionId,
      text: normalizedText,
      isMe: false,
      senderType,
      agentId,
      apiMessageId,
      clientMessageId,
      time: timeStr,
      createdAt,
      updatedAt: createdAt,
      replyToId: null,
      replyToText: null,
      status: 'sent' as const,
      tokensUsed,
      promptTokens,
      completionTokens,
      metadataJson: null,
    };

    const message = senderType === 'assistant'
      ? (await deliverAssistantMessage({
          repository: repo,
          message: baseMessage,
          notifyUI: emitChatMessagesUpdated,
          onSegmentDelivered: async ({
            logicalMessageId,
            segmentIndex,
            segmentTotal,
            text: segmentText,
            message: committedMessage,
          }) => {
            if (aiId && aiName) {
              await emitAIMessageReceived({
                aiId,
                agentId,
                aiName,
                aiAvatar,
                sessionId,
                message: segmentText,
                logicalMessageId,
                segmentIndex,
                segmentTotal,
                committedMessageId: committedMessage.id,
                deliveryKind: deliveryKindResolved,
                triggerSource,
                conversationKind: 'direct',
              });
            }
          },
        })).firstMessage
      : await persistChatMessage({
          repository: repo,
          message: baseMessage,
          previewText: buildAssistantMessagePreviewText(normalizedText),
          notifyUI: emitChatMessagesUpdated,
        });

    return {
      success: true,
      message,
      error: null,
    };
  } catch (error) {
    console.error('[ReceiveExternalAIMessage] Failed:', error);
    return {
      success: false,
      message: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** 普通 Chat 公共命令：只接收业务参数。 */
export async function receiveExternalAIMessage(
  params: ReceiveExternalAIMessageParams,
): Promise<ReceiveExternalAIMessageResult> {
  return receiveExternalAIMessageInternal(params);
}
