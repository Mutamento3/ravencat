/** 收口单聊路由准备，并只合并同一目标正在执行的请求。 */
import type { AIProfile } from '@features/assistants';
import type { ChatSession } from '../../conversation/domain/SessionRepository';

export type EnsureConversationResult =
  | 'ready'
  | 'assistant-not-found'
  | 'session-not-found'
  | 'superseded';

export interface ConversationPreparationSnapshot {
  currentAIId: string | null;
  currentSessionId: string | null;
  aiList: AIProfile[];
  loadAIAssistants: () => Promise<AIProfile[]>;
  beginChatEntryRequest: () => number;
  enterConversation: (
    ai: AIProfile,
    options: { preparedSession?: ChatSession; requestId: number }
  ) => Promise<'completed' | 'superseded'>;
}

interface ConversationPreparationDependencies {
  getSnapshot: () => ConversationPreparationSnapshot;
  getCanonicalConversation: (aiId: string) => Promise<ChatSession | null>;
}

export function createConversationPreparationController({
  getSnapshot,
  getCanonicalConversation,
}: ConversationPreparationDependencies) {
  const flights = new Map<string, Promise<EnsureConversationResult>>();
  const flightCountsByAI = new Map<string, number>();

  const ensureConversation = (
    aiId: string,
    sessionId?: string | null
  ): Promise<EnsureConversationResult> => {
    const normalizedAIId = aiId.trim();
    const normalizedSessionId = sessionId?.trim() || null;
    const preparationKey = JSON.stringify([normalizedAIId, normalizedSessionId]);
    const existingFlight = flights.get(preparationKey);
    if (existingFlight) {
      return existingFlight;
    }

    const preparation = (async (): Promise<EnsureConversationResult> => {
      let snapshot = getSnapshot();
      if (
        snapshot.currentAIId === normalizedAIId
        && (!normalizedSessionId || snapshot.currentSessionId === normalizedSessionId)
      ) {
        return 'ready';
      }

      // token 在任何异步验证前登记，保证不同目标仍按发起顺序决定最终 UI owner。
      const requestId = snapshot.beginChatEntryRequest();
      let ai = snapshot.aiList.find((item) => item.id === normalizedAIId);
      if (!ai) {
        const assistants = await snapshot.loadAIAssistants();
        ai = assistants.find((item) => item.id === normalizedAIId);
      }
      if (!ai) {
        return 'assistant-not-found';
      }

      const canonicalConversation = await getCanonicalConversation(normalizedAIId);
      if (
        normalizedSessionId
        && canonicalConversation?.id !== normalizedSessionId
      ) {
        return 'session-not-found';
      }

      snapshot = getSnapshot();
      const entryResult = await snapshot.enterConversation(ai, {
        ...(canonicalConversation ? { preparedSession: canonicalConversation } : {}),
        requestId,
      });
      return entryResult === 'completed' ? 'ready' : 'superseded';
    })();

    flights.set(preparationKey, preparation);
    flightCountsByAI.set(
      normalizedAIId,
      (flightCountsByAI.get(normalizedAIId) || 0) + 1
    );
    const clearPreparation = () => {
      if (flights.get(preparationKey) === preparation) {
        flights.delete(preparationKey);
        const remainingCount = (flightCountsByAI.get(normalizedAIId) || 1) - 1;
        if (remainingCount > 0) {
          flightCountsByAI.set(normalizedAIId, remainingCount);
        } else {
          flightCountsByAI.delete(normalizedAIId);
        }
      }
    };
    void preparation.then(clearPreparation, clearPreparation);
    return preparation;
  };

  const isConversationActiveOrPreparing = (aiId: string) => {
    const normalizedAIId = aiId.trim();
    return getSnapshot().currentAIId === normalizedAIId
      || flightCountsByAI.has(normalizedAIId);
  };

  return { ensureConversation, isConversationActiveOrPreparing };
}
