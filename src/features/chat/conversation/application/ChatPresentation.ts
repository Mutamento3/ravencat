/** 为聊天界面提供会话、助手与宿主 AI 设置的展示层应用服务，并发布会话变更事件。 */
import { getChatConversationRuntimeDependencies } from './ChatConversationRuntime';
import { getChatMessageRuntimeDependencies } from '../../messages/application/ChatMessageRuntime';
import type { AIProfile } from '@features/assistants';
import type { ChatSession } from '../domain/SessionRepository';
import type { UserProfile } from '@features/profile';
import { getCurrentUserProfile } from '@features/profile';
import { emitChatMessagesReloadRequested } from '../../messages/events/ChatEvents';

export async function getCanonicalChatConversation(aiId: string): Promise<ChatSession | null> {
  return getChatConversationRuntimeDependencies().sessions.getCanonicalConversation(aiId);
}

export async function clearChatConversationHistory(sessionId: string): Promise<number | null> {
  const boundary = await getChatConversationRuntimeDependencies().sessions
    .clearConversationHistory(sessionId);
  await getChatMessageRuntimeDependencies().regeneration?.onInvalidated(sessionId);
  emitChatMessagesReloadRequested(sessionId);
  return boundary;
}

export async function getChatDetailCurrentUser(): Promise<UserProfile> {
  return getCurrentUserProfile();
}

export async function getChatDetailAvailableAssistants(
  currentAssistant?: AIProfile | null
): Promise<AIProfile[]> {
  const assistants = await getChatConversationRuntimeDependencies().assistantDirectory.list();

  if (!currentAssistant || assistants.some((item) => item.id === currentAssistant.id)) {
    return assistants;
  }

  return [...assistants, currentAssistant];
}

export async function getChatDatabaseInfo() {
  return getChatConversationRuntimeDependencies().database.getInfo();
}
