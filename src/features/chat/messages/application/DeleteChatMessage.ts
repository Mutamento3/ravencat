/** 提供聊天消息删除用例，联动删除相关推理片段并修复会话或群聊预览。 */
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import { buildSessionPreviewTextFromMessage } from '../domain/chatMessageMetadata';
import { releaseMediaAssetCandidates } from '@features/media';
import { emitChatMessagesReloadRequested } from '../events/ChatEvents';

export async function deleteChatMessage(messageId: number): Promise<number[]> {
  const target = await getChatMessageRuntimeDependencies().messages.getMessageById(messageId);
  if (!target) {
    return [];
  }

  // 思维链不允许单独删除
  if (target.senderType === 'reasoning') {
    return [];
  }

  const idsToDelete = new Set<number>([messageId]);

  // 如果删除的是正文消息且有 logicalMessageId，检查是否是该批次最后一条正文
  if (target.logicalMessageId && target.senderType === 'assistant') {
    const related = await getChatMessageRuntimeDependencies().messages.getMessagesByLogicalMessageId(
      target.sessionId,
      target.logicalMessageId
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

  // 媒体候选必须来自真正的 DELETE 事务快照。这里的 target 只用于业务判断（存在性、
  // reasoning、logicalMessageId 与 idsToDelete），不允许再按它推导媒体候选：
  // legacy attachment migration 的 metadata CAS 可以恰好发生在「读取 target」与
  // 「真正 DELETE」之间，把 legacy URI 改写成 canonical mediaAssetId；那次引用随本次删除
  // 一起消失，必须仍然进入候选集，否则会留下再也无法被引用枚举发现的 orphan。
  // 详见 IMessageRepository.deleteMessagesWithMediaCandidates。
  const result = await getChatMessageRuntimeDependencies().messages.deleteMessagesWithMediaCandidates(
    [...idsToDelete]
  );

  // 同步修复 preview：查询该 session 当前可见历史中的最新一条消息，
  // 更新 sessions / group_chats 的 preview。clear history 只是隐藏旧消息，
  // 这里必须用 visible latest，否则删除 clear 后新消息会把隐藏历史重新写回 preview。
  await syncSessionPreviewAfterDelete(target.sessionId);
  await getChatMessageRuntimeDependencies().regeneration?.onInvalidated(target.sessionId);
  emitChatMessagesReloadRequested(target.sessionId);
  // 纯文本消息没有任何媒体引用，候选为空时不得触发任何全库 GC。
  await releaseMediaAssetCandidates(result.mediaAssetCandidates);

  return [...result.deletedMessageIds];
}

async function syncSessionPreviewAfterDelete(sessionId: string): Promise<void> {
  try {
    const latestMessage = await getChatMessageRuntimeDependencies().messages.getLatestVisibleMessage(sessionId);
    const previewText = latestMessage
      ? buildSessionPreviewTextFromMessage(latestMessage)
      : '';
    // 当前可见时间线已空时，排序时间必须是 null：会话列表排序代表「当前用户
    // 可见的最近消息活动」，不允许用 now 制造一次并不存在的活动，否则删空
    // 会话会被顶到列表最前。
    const previewTime = latestMessage?.createdAt ?? null;
    // preview 必须绑定最新现存消息的身份；空会话归 null。否则晚到的 AI
    // preview 回调会按过期的 last_message_id 通过 CAS，复活已删除消息。
    const previewMessageId = latestMessage?.id ?? null;

    // 同时尝试更新单聊和群聊的 preview（sessionId 不会同时存在于两个表，只有一个会实际生效）
    await Promise.allSettled([
      getChatMessageRuntimeDependencies().messages.updateSessionPreview(sessionId, previewText, previewTime),
      getChatMessageRuntimeDependencies().groupPreview.updatePreview(
        sessionId,
        previewText,
        previewTime,
        previewMessageId,
      ),
    ]);
  } catch (error) {
    console.error('[DeleteChatMessage] Failed to sync preview:', error);
  }
}
