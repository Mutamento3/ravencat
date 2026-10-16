/** 昵称修改作为用户操作留在发生时的位置；不触发 canonical 用户回合。 */
import type { DatabaseTransactionExecutor } from '@platform/persistence';
import { getChatConversationRuntimeDependencies } from '../../conversation/application/ChatConversationRuntime';
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import { emitChatMessagesUpdated } from '../events/ChatEvents';

export interface AssistantNicknameChangeRecord {
  changeId: string;
  assistantId: string;
  previousNickname: string | null;
  nickname: string | null;
  occurredAt: string;
}

/** 事务装配入口只执行 SQL；返回的通知由外层提交后调用。 */
export async function recordAssistantNicknameChangeInTransaction(
  transaction: DatabaseTransactionExecutor, change: AssistantNicknameChangeRecord,
): Promise<() => void> {
  const session = await getChatConversationRuntimeDependencies().sessions.resolveCanonicalConversationInTransaction(
    transaction, change.assistantId, new Date(change.occurredAt),
  );
  const occurred = new Date(change.occurredAt);
  const label = (value: string | null) => value === null ? '未设置昵称' : JSON.stringify(value);
  const text = `用户将你的昵称备注从${label(change.previousNickname)}修改为${label(change.nickname)}。`;
  const { inserted } = await getChatMessageRuntimeDependencies().messages.upsertStatefulTimelineEntryInTransaction(transaction, {
    message: { sessionId: session.id, text, senderType: 'system', isMe: false,
      clientMessageId: `assistant-nickname:${change.changeId}`, createdAt: change.occurredAt,
      updatedAt: change.occurredAt, time: `${String(occurred.getHours()).padStart(2, '0')}:${String(occurred.getMinutes()).padStart(2, '0')}`,
      status: 'sent', deliveryStatus: 'delivered', isRead: true,
      metadataJson: JSON.stringify({ type: 'assistantNicknameChanged', source: 'assistants',
        previousNickname: change.previousNickname, nickname: change.nickname }),
    }, previewText: null,
  });
  return () => { if (inserted) emitChatMessagesUpdated(session.id); };
}
