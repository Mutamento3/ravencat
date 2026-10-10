/** 将通话中的助手文本交给 Chat command；通话链路不触发系统 AI delivery。 */

import type { ChatMessage } from '@features/chat';
import type { CallAIConfig } from '../../domain/CallAIConfig';
import type { CallChatWritePort } from './CallRuntimeDependencies';

export async function createCallAssistantTextMessage(
  chat: CallChatWritePort,
  params: {
    sessionId: string;
    aiConfig: CallAIConfig;
    text: string;
    triggerReason: string;
  },
): Promise<ChatMessage> {
  const result = await chat.appendExternalAssistantMessage({
    sessionId: params.sessionId,
    text: params.text,
    aiId: params.aiConfig.id,
    aiName: params.aiConfig.name,
    aiAvatar: params.aiConfig.avatar || null,
    agentId: params.aiConfig.agentId,
    triggerSource: 'call',
    // 通话文本已经在通话界面消费，明确提交 Chat 事实但不重复触发 AI delivery。
    delivery: 'none',
    metadata: {
      actorAgentId: params.aiConfig.agentId,
      actorAIId: params.aiConfig.id,
      actorName: params.aiConfig.name,
      triggerReason: params.triggerReason,
      kind: 'reply',
    },
  });

  return result.message;
}
