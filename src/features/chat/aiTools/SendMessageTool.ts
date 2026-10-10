/** AI 主动向当前运行绑定的聊天会话提交一条普通 assistant 消息的 Feature Tool。 */

import type { ToolContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import {
  appendExternalAssistantMessages,
} from '../messages/application/AppendExternalAssistantMessages';
import { segmentAssistantReplyText } from '../reply/application/AssistantReplySegmentation';
import { buildLogicalMessageId } from '../reply/application/ChatReplyUtils';
import type { AIMessageDeliveryStatus } from '../reply/delivery/AIMessageEvents';

export interface SendMessageArgs {
  text: string;
}

export interface SendMessageResultData {
  sessionId: string;
  committedMessageId: number;
  deliveryStatus: AIMessageDeliveryStatus | null;
  deliveryErrorCategory: string | null;
}

export const definition = {
  name: 'send_message',
  description: [
    '向本次运行绑定的用户聊天会话发送一条真实可见的普通消息。',
    '调用成功就表示消息已经提交进聊天记录；不要把相同正文再作为最终输出重复发送一次。',
    '一次调用发送一条消息；正文里的空行会自动分成多条气泡，不要把同一段话拆成多次调用。',
    '不想联系用户时不要调用它。会话、身份和发送来源都由当前运行上下文决定，不能由你指定。',
  ].join(''),
  parameters: {
    type: 'object' as const,
    properties: {
      text: {
        type: 'string' as const,
        description: '要发送给用户的消息正文，必须是非空自然语言文本',
      },
    },
    required: ['text'],
    additionalProperties: false,
  },
};

export async function execute(
  args: SendMessageArgs,
  context: ToolContext
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  errorCode?: string;
  data?: SendMessageResultData;
}> {
  const text = typeof args?.text === 'string' ? args.text.trim() : '';
  if (!text) {
    return {
      success: false,
      errorCode: 'EMPTY_MESSAGE_CONTENT',
      error: '消息正文为空，因此本次没有发送任何消息。如果确实要联系用户，请提供非空正文后重新调用。',
    };
  }

  const sessionId = context.sessionId;
  if (!sessionId) {
    return {
      success: false,
      errorCode: 'CHAT_SESSION_UNAVAILABLE',
      error: '当前 autonomous run 没有可发送普通消息的有效聊天会话，本次没有发送消息。系统不会自动创建新会话。',
    };
  }

  const aiId = context.getAIId();
  const aiName = context.getAIName();
  if (!aiId || !aiName) {
    return {
      success: false,
      errorCode: 'AI_IDENTITY_UNAVAILABLE',
      error: '当前运行缺少可提交 assistant 消息的 AI 身份，本次没有发送消息。',
    };
  }

  throwIfAbortSignalAborted(context.abortSignal);

  const timelineRunId = context.sharedState.replyRunId;
  // 与正常聊天回复共用同一套确定性分段：正文的空行即气泡边界，不依赖模型输出格式标记。
  const segments = segmentAssistantReplyText(
    text,
    context.aiConfig.allowMultipleBubbles === false ? 'single-bubble' : 'multi-bubble',
  );

  const result = await appendExternalAssistantMessages({
    sessionId,
    segments,
    aiId,
    agentId: context.getAgentId() ?? null,
    aiName,
    aiAvatar: typeof context.aiConfig.avatar === 'string' ? context.aiConfig.avatar : null,
    delivery: 'default',
    triggerSource: context.getTriggerSource(),
    relatedEntityType: context.getRelatedEntityType(),
    relatedEntityId: context.getRelatedEntityId(),
    ...(typeof timelineRunId === 'string' ? { timelineRunId } : {}),
    // 多段属于同一条消息：UI 分组与通知去重都依赖它。
    logicalMessageId: segments.length > 1 ? buildLogicalMessageId() : null,
  });

  const [firstMessage] = result.messages;
  if (!firstMessage) {
    throw new Error('send_message 已提交分段但未返回可审计的落库消息');
  }
  const [firstReceipt] = result.deliveryReceipts;
  const deliveryStatus = firstReceipt?.status ?? null;
  const data: SendMessageResultData = {
    sessionId,
    committedMessageId: firstMessage.id,
    deliveryStatus,
    deliveryErrorCategory: firstReceipt?.errorCategory ?? null,
  };

  return {
    success: true,
    message: describeDelivery(deliveryStatus),
    data,
  };
}

export const SendMessageTool = {
  name: definition.name,
  definition,
  execute,
};

function describeDelivery(deliveryStatus: AIMessageDeliveryStatus | null): string {
  if (deliveryStatus === 'shown') {
    return '消息已发送并提交到 Chat，系统通知已显示。不要重复发送相同消息。';
  }
  if (deliveryStatus === 'suppressed_foreground') {
    return '消息已发送并提交到 Chat；目标会话正在前台，因此没有额外显示系统通知。不要重复发送相同消息。';
  }
  if (deliveryStatus === 'handled_by_consumer') {
    return '消息已发送并提交到 Chat；当前展示层已经处理用户可见交付。不要重复发送相同消息。';
  }
  if (deliveryStatus === 'failed') {
    return '消息已经成功写入 Chat，但系统通知交付失败。不要因为通知失败重复发送相同消息。';
  }
  return '消息已发送并提交到 Chat。不要重复发送相同消息。';
}
