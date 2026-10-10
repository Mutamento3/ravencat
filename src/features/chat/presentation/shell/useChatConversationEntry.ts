/**
 * 管理聊天 Shell 的 canonical conversation 进入流程。
 *
 * 进入正确性只依赖「canonical 会话身份」，不依赖 timeline 预热/缓存：
 * 只要身份已知（preparedSession 或一次索引读）就立即进入 ChatDetail，
 * 消息由 ChatDetail 自己的首屏加载负责。预热只影响消息出现快慢。
 */

import { showAppDialog } from '@shared/ui';
import { useCallback, useRef } from 'react';

import type { AIProfile } from '@features/assistants';
import type { ChatSession } from '../../conversation/domain/SessionRepository';
import type { ChatSubScreen } from './chatScreenTypes';

interface UseChatConversationEntryParams {
  currentAI: AIProfile | null;
  setCurrentAI: (ai: AIProfile | null) => void;
  setCurrentSession: (session: ChatSession | null) => void;
  setCurrentSubScreen: (screen: ChatSubScreen | null) => void;
  loadAIAssistants: () => Promise<AIProfile[]>;
  removeAIAssistant: (aiId: string) => Promise<void>;
  resolveConversation: (ai: AIProfile) => Promise<ChatSession | null>;
  onConversationViewed?: ((aiId: string) => void) | null;
}

interface SelectAIOptions {
  preparedSession?: ChatSession;
  requestId?: number;
}

type ChatEntryResult = 'completed' | 'superseded';

export function useChatConversationEntry({
  currentAI,
  setCurrentAI,
  setCurrentSession,
  setCurrentSubScreen,
  loadAIAssistants,
  removeAIAssistant,
  resolveConversation,
  onConversationViewed,
}: UseChatConversationEntryParams) {
  const chatEntryRequestRef = useRef(0);

  const beginChatEntryRequest = useCallback(() => {
    chatEntryRequestRef.current += 1;
    return chatEntryRequestRef.current;
  }, []);

  const handleSelectAI = useCallback(async (
    ai: AIProfile,
    options: SelectAIOptions = {},
  ): Promise<ChatEntryResult> => {
    const requestId = options.requestId ?? beginChatEntryRequest();
    if (chatEntryRequestRef.current !== requestId) {
      return 'superseded';
    }
    if (ai.isBlocked) {
      showAppDialog({ title: '已被拉黑', message: `${ai.name} 当前已被主理 AI 拉黑，暂时无法进入对话`, tone: 'warning' });
      return 'completed';
    }

    setCurrentSubScreen(null);
    onConversationViewed?.(ai.id);

    // 身份解析（resolve/create canonical conversation）与时间线预热严格分离：
    // 已准备的会话直接用；否则只做一次 canonical 身份解析，不等任何 timeline 读取。
    const session = options.preparedSession || await resolveConversation(ai);
    if (chatEntryRequestRef.current !== requestId) {
      return 'superseded';
    }
    if (!session) {
      throw new Error(`无法解析 AI ${ai.id} 的 canonical conversation`);
    }

    setCurrentAI({ ...ai, canonicalConversationId: session.id });
    setCurrentSession(session);
    return 'completed';
  }, [
    beginChatEntryRequest,
    onConversationViewed,
    resolveConversation,
    setCurrentAI,
    setCurrentSession,
    setCurrentSubScreen,
  ]);

  const handleBackToList = useCallback(async () => {
    chatEntryRequestRef.current += 1;
    setCurrentAI(null);
    setCurrentSession(null);
    setCurrentSubScreen(null);
    await loadAIAssistants();
  }, [loadAIAssistants, setCurrentAI, setCurrentSession, setCurrentSubScreen]);

  const handleDeleteAI = useCallback(async () => {
    if (!currentAI) {
      throw new Error('currentAI must exist when deleting an AI');
    }
    await removeAIAssistant(currentAI.id);
    setCurrentSubScreen(null);
    setCurrentAI(null);
    setCurrentSession(null);
  }, [currentAI, removeAIAssistant, setCurrentAI, setCurrentSession, setCurrentSubScreen]);

  return {
    beginChatEntryRequest,
    handleSelectAI,
    handleBackToList,
    handleDeleteAI,
  };
}
