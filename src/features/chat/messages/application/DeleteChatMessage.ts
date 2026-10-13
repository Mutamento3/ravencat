/** 提供聊天消息删除用例，联动删除相关推理片段并修复会话或群聊预览。 */
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import { buildSessionPreviewTextFromMessage } from '../domain/chatMessageMetadata';
import { releaseMediaAssetCandidates } from '@features/media';
import { emitChatMessagesDeleted } from '../events/ChatEvents';
import { databaseCoordinator } from '@platform/persistence';
import { getChatGroupRuntimeDependencies } from '../../group/application/ChatGroupRuntime';

export async function deleteChatMessage(messageId: number): Promise<number[]> {
  const dependencies = getChatMessageRuntimeDependencies();
  const result = await databaseCoordinator.transaction(
    { name: 'chat.delete-message', feature: 'chat', priority: 'interactive' },
    async (transaction) => {
      const target = await dependencies.messages.getMessageByIdInTransaction(transaction, messageId);
      if (!target) {
        return null;
      }

      // 思维链不允许单独删除
      if (target.senderType === 'reasoning') {
        return null;
      }

      const idsToDelete = new Set<number>([messageId]);

      // 如果删除的是正文消息且有 logicalMessageId，检查是否是该批次最后一条正文
      if (target.logicalMessageId && target.senderType === 'assistant') {
        const related = await dependencies.messages.getMessagesByLogicalMessageId(
          target.sessionId,
          target.logicalMessageId,
          transaction,
        );

        // 该批次下除当前消息外，是否还有其他正文消息
        const remainingSegments = related.filter(
          (m) => m.id !== target.id && m.senderType === 'assistant'
        );

        // 如果这是最后一条正文，连带删除思维链
        if (remainingSegments.length === 0) {
          const reasoning = related.find((m) => m.senderType === 'reasoning');
          if (reasoning) {
            idsToDelete.add(reasoning.id);
          }
        }
      }

      // 引用候选由删除原语从同一事务的实际 rows 收集，联删 reasoning 也不能漏掉引用。
      const deleted = await dependencies.messages.deleteMessagesWithMediaCandidatesInTransaction(
        transaction,
        [...idsToDelete]
      );
      const latest = await dependencies.messages.getLatestPreviewMessageInTransaction(transaction, target.sessionId);
      const preview = latest ? buildSessionPreviewTextFromMessage(latest) : '';
      const time = latest?.createdAt ?? null;
      // 删除、latest 与 preview 共用事实快照，新提交不能插入读取和回写之间。
      await dependencies.messages.updateSessionPreviewInTransaction(transaction, target.sessionId, preview, time);
      await getChatGroupRuntimeDependencies().groups.updatePreviewInTransaction(
        transaction, target.sessionId, latest?.id ?? null, preview, time,
      );
      return { ...deleted, sessionId: target.sessionId };
    },
  );
  if (!result) return [];
  await dependencies.regeneration?.onInvalidated(result.sessionId);
  emitChatMessagesDeleted(result.sessionId, result.deletedMessageIds);
  // 纯文本消息没有任何媒体引用，候选为空时不得触发任何全库 GC。
  await releaseMediaAssetCandidates(result.mediaAssetCandidates);

  return [...result.deletedMessageIds];
}
