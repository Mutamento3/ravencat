import { getChatMessageRuntimeDependencies } from '../../messages/application/ChatMessageRuntime';
import { emitChatMessagesReloadRequested, emitChatRegenerationChanged, emitChatTurnExecutionChanged } from '../../messages/events/ChatEvents';

export function getChatReplyVersionHistory(sessionId: string, runId: string) {
  return getChatMessageRuntimeDependencies().turns.getReplyVersionHistory(sessionId, runId);
}

/** 采用不触发消息交付或通知，UI 与下一轮上下文重读同一份 canonical 消息。 */
export async function adoptChatReplyVersion(sessionId: string, runId: string, versionId: string, expectedVersionId: string) {
  await getChatMessageRuntimeDependencies().turns.adoptReplyVersion(sessionId, runId, versionId, expectedVersionId);
  emitChatMessagesReloadRequested(sessionId);
  emitChatRegenerationChanged(sessionId);
  emitChatTurnExecutionChanged(sessionId);
}
