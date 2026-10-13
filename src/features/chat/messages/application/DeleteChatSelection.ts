/** 整批选择在一个事务内展开、删除并修复预览；媒体与宿主副作用留在 commit 后。 */
import { databaseCoordinator } from '@platform/persistence';
import { releaseMediaAssetCandidates } from '@features/media';
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import { getChatGroupRuntimeDependencies } from '../../group/application/ChatGroupRuntime';
import { canSelectChatMessage, getChatSelectionKey, MAX_CHAT_SELECTION_UNITS } from '../domain/ChatMessageSelection';
import { buildSessionPreviewTextFromMessage } from '../domain/chatMessageMetadata';
import { emitChatMessagesDeleted } from '../events/ChatEvents';

export async function deleteChatSelection(sessionId: string, anchorMessageIds: readonly number[]): Promise<readonly number[]> {
  if (anchorMessageIds.length === 0 || anchorMessageIds.length > MAX_CHAT_SELECTION_UNITS) {
    throw new Error(`请选择 1 至 ${MAX_CHAT_SELECTION_UNITS} 条消息`);
  }
  const dependencies = getChatMessageRuntimeDependencies();
  const database = databaseCoordinator.openTaskExecutor({ name: 'chat.deleteSelection', feature: 'chat', priority: 'interactive' });
  const result = await database.withExclusiveTransactionAsync(async (transaction) => {
    const keys = new Set<string>();
    const ids = new Set<number>();
    for (const anchorId of anchorMessageIds) {
      const anchor = await dependencies.messages.getMessageByIdInTransaction(transaction, anchorId);
      if (!anchor) continue;
      if (anchor.sessionId !== sessionId || !canSelectChatMessage(anchor)) throw new Error('所选消息已变化，请重新选择');
      const key = getChatSelectionKey(anchor);
      if (keys.has(key)) continue;
      keys.add(key);
      const messages = await dependencies.messages.getMessagesInSelectionUnitInTransaction(transaction, sessionId, key);
      for (const message of messages) ids.add(message.id);
    }
    const deleted = await dependencies.messages.deleteMessagesWithMediaCandidatesInTransaction(transaction, [...ids]);
    if (deleted.deletedMessageIds.length === 0) return deleted;
    const latest = await dependencies.messages.getLatestPreviewMessageInTransaction(transaction, sessionId);
    const preview = latest ? buildSessionPreviewTextFromMessage(latest) : '';
    const time = latest?.createdAt ?? null;
    await dependencies.messages.updateSessionPreviewInTransaction(transaction, sessionId, preview, time);
    await getChatGroupRuntimeDependencies().groups.updatePreviewInTransaction(transaction, sessionId, latest?.id ?? null, preview, time);
    return deleted;
  });
  if (result.deletedMessageIds.length > 0) {
    await dependencies.regeneration?.onInvalidated(sessionId);
    emitChatMessagesDeleted(sessionId, result.deletedMessageIds);
    await releaseMediaAssetCandidates(result.mediaAssetCandidates);
  }
  return result.deletedMessageIds;
}
