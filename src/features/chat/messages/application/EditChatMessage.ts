/** 消息正文与单聊／群聊预览原子改写，提交后沿用现有时间线 patch。 */
import { databaseCoordinator } from '@platform/persistence';
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import { getChatGroupRuntimeDependencies } from '../../group/application/ChatGroupRuntime';
import { buildSessionPreviewTextFromMessage } from '../domain/chatMessageMetadata';
import { emitChatMessagesPatched } from '../events/ChatEvents';
import type { ChatMessage } from '../domain/ChatMessage';
import { canEditChatMessage } from '../domain/ChatMessageEditing';

export async function editChatMessage(input: {
  messageId: number;
  expectedText: string;
  text: string;
}): Promise<ChatMessage> {
  const text = input.text.trim();
  if (!text) throw new Error('消息正文不能为空');
  const database = databaseCoordinator.openTaskExecutor({
    name: 'chat.editMessage', feature: 'chat', priority: 'interactive',
  });
  const edited = await database.withExclusiveTransactionAsync(async (transaction) => {
    const messages = getChatMessageRuntimeDependencies().messages;
    const current = await messages.getMessageByIdInTransaction(transaction, input.messageId);
    if (!current) throw new Error('这条消息已被删除');
    if (!canEditChatMessage(current)) throw new Error('这条消息不能改写');
    if (current.text !== input.expectedText) throw new Error('消息正文已发生变化，请重新打开改写');
    const previewText = buildSessionPreviewTextFromMessage({ ...current, text });
    const message = await messages.editMessageTextInTransaction(
      transaction, { messageId: current.id, text, previewText },
    );
    await getChatGroupRuntimeDependencies().groups.updateEditedMessagePreviewInTransaction(
      transaction, message.sessionId, message.id, previewText,
    );
    return message;
  });
  await getChatMessageRuntimeDependencies().regeneration?.onInvalidated(edited.sessionId);
  emitChatMessagesPatched({ sessionId: edited.sessionId, updatedMessageIds: [edited.id] });
  return edited;
}
