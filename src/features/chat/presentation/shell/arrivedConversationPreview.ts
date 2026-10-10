/** 列表展示查询不改写持久预览，只在实时到达期间排除尚未到达的分段。 */
import { getChatMessageRuntimeDependencies } from '../../messages/application/ChatMessageRuntime';
import { buildSessionPreviewTextFromMessage } from '../../messages/domain';
import { getAssistantMessageArrivalSnapshot } from '../../reply/delivery/AssistantMessageArrival';

export async function withArrivedConversationPreview<T extends { lastMessage?: string | null; lastTime?: string | null }>(
  item: T,
  sessionId: string | null,
): Promise<T> {
  const { pendingMessageIds, pendingSessionIds } = getAssistantMessageArrivalSnapshot();
  if (!sessionId || !pendingSessionIds.includes(sessionId)) return item;
  const message = await getChatMessageRuntimeDependencies().messages.getLatestArrivedPreviewMessage(sessionId, pendingMessageIds);
  return {
    ...item,
    lastMessage: message ? buildSessionPreviewTextFromMessage(message) : '',
    lastTime: message?.createdAt ?? undefined,
  };
}
