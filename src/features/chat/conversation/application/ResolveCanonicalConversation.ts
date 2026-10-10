/** 解析每个 AI 唯一的 canonical 单聊 conversation。 */
import type { ChatSession, ISessionRepository } from '../domain/SessionRepository';
import { getChatConversationRuntimeDependencies } from './ChatConversationRuntime';

export interface ResolveCanonicalConversationParams {
  aiId: string;
  now?: Date;
}

interface ResolveCanonicalConversationDeps {
  sessionRepo?: ISessionRepository;
}

export async function resolveCanonicalConversation(
  { aiId, now = new Date() }: ResolveCanonicalConversationParams,
  deps: ResolveCanonicalConversationDeps = {},
): Promise<ChatSession> {
  if (!aiId) {
    throw new Error('resolveCanonicalConversation requires aiId');
  }

  return (deps.sessionRepo ?? getChatConversationRuntimeDependencies().sessions)
    .resolveCanonicalConversation(aiId, now);
}
