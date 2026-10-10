/** 重写意图提交后委派原有 Android 宿主，页面不 claim 或执行模型。 */
import { getChatMessageRuntimeDependencies } from '../../messages/application/ChatMessageRuntime';
import { emitChatRegenerationChanged } from '../../messages/events/ChatEvents';

export function getChatRegenerationState(sessionId: string) {
  return getChatMessageRuntimeDependencies().turns.getRegenerationState(sessionId);
}

export async function regenerateChatReply(sessionId: string, messageId: number): Promise<void> {
  const { turns, regeneration } = getChatMessageRuntimeDependencies();
  if (!regeneration) throw new Error('聊天重写执行宿主尚未装配');
  const requestRevision = await turns.requestRegeneration(sessionId, messageId);
  emitChatRegenerationChanged(sessionId);
  try {
    if (!await regeneration.onRequested(sessionId)) throw new Error('无法启动重写，请重试');
  } catch (error) {
    await turns.cancelRegeneration(sessionId, requestRevision);
    await regeneration.onInvalidated(sessionId);
    emitChatRegenerationChanged(sessionId);
    throw error;
  }
}
