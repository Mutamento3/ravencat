/** 用户任命／撤销触发的有界回复；通知只作为本轮输入，不写成用户发言或系统提示条。 */
import { getAIAssistantById } from '@features/assistants';
import { requestProactiveChatReply, resolveCanonicalConversation } from '@features/chat';
import { ensureHostDatabaseReady } from '../composition/ensureHostDatabaseReady';
import { withConversationExecutionLifetime, type ConversationExecutionLifetimeData } from './ConversationExecutionLifetime';

interface HostRelationshipReplyTaskData extends ConversationExecutionLifetimeData {
  aiId: string;
  change: 'appointed' | 'revoked';
  occurredAt: string;
}

export async function runHostRelationshipReplyHeadlessTask(data: HostRelationshipReplyTaskData): Promise<void> {
  // 原生 Intent 是运行时边界，不能把缺失或非法事件解释为真实的用户动作。
  if (!data.aiId || !['appointed', 'revoked'].includes(data.change) || !Number.isFinite(Date.parse(data.occurredAt))) {
    throw new Error('主理身份变更回复任务参数非法');
  }
  await withConversationExecutionLifetime(data, async lifetime => {
    await ensureHostDatabaseReady();
    if (lifetime.signal.aborted || performance.now() >= lifetime.executionDeadlineAt) return;
    const assistant = await getAIAssistantById(data.aiId);
    if (!assistant) return;
    const conversation = await resolveCanonicalConversation({ aiId: assistant.id });
    await requestProactiveChatReply({
      abortSignal: lifetime.signal, executionDeadlineAt: lifetime.executionDeadlineAt,
      sessionId: conversation.id,
      aiConfig: { ...assistant, systemPrompt: assistant.systemPrompt ?? undefined,
        apiBaseUrl: assistant.apiBaseUrl ?? '', apiKey: assistant.apiKey ?? '' },
      currentInput: [
        `操作时间：${data.occurredAt}。`,
        data.change === 'appointed' ? '用户刚刚任命你为主理 AI。' : '用户刚刚撤销了你的主理 AI 身份。',
      ].join('\n'),
      triggerSource: 'chat', triggerReason: `host_ai_${data.change}`,
      relatedEntityType: 'host_relationship', relatedEntityId: assistant.id,
      correlationId: `host_relationship:${assistant.id}:${data.change}:${data.occurredAt}`,
      capabilities: ['chat.reply'],
    });
  });
}
