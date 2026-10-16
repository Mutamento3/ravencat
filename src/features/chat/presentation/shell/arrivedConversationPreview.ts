/** 列表经统一可见读取边界排除未交付正文，进程重建后仍然生效。 */
import { getChatMessageRuntimeDependencies } from '../../messages/application/ChatMessageRuntime';
import { buildSessionPreviewTextFromMessage } from '../../messages/domain';
import { getAssistantMessageArrivalSnapshot } from '../../reply/delivery/AssistantMessageArrival';

export async function withArrivedConversationPreview<T extends { lastMessage?: string | null; lastTime?: string | null }>(
  item: T,
  sessionId: string | null,
): Promise<T> {
  const { pendingMessageIds } = getAssistantMessageArrivalSnapshot();
  if (!sessionId) return item;
  const message = await getChatMessageRuntimeDependencies().messages.getLatestArrivedPreviewMessage(sessionId, pendingMessageIds);
  return {
    ...item,
    lastMessage: message ? buildSessionPreviewTextFromMessage(message) : '',
    lastTime: message?.createdAt ?? undefined,
  };
}
