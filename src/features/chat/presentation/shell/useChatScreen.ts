/** 编排聊天 Shell 的助手列表、会话入口、预加载与子页面导航。 */

import { useCallback, useEffect, useRef, useState } from 'react';

import useAIAssistants from './useAIAssistants';
import type { AIProfile } from '@features/assistants';
import type { ChatSession } from '../../conversation/domain/SessionRepository';
import type { UseChatScreenParams } from './chatScreenTypes';
import { useChatConversationEntry } from './useChatConversationEntry';
import { useChatEntryPreload } from './useChatEntryPreload';
import { useChatNavigation } from './useChatNavigation';
import {
  markConversationListFailed,
} from '@shared/runtime/ConversationListReadySignal';

export default function useChatScreen({
  onAddAI,
  sessionRefreshTrigger = 0,
  onConversationViewed,
  dbReady = false,
  conversationListLoadEnabled = false,
  onConversationListInvalidated = null,
}: UseChatScreenParams) {
  const [currentAI, setCurrentAI] = useState<AIProfile | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);

  const { aiList, aiListReady, loadAIAssistants, removeAIAssistant } = useAIAssistants() as {
    aiList: AIProfile[];
    aiListReady: boolean;
    loadAIAssistants: () => Promise<AIProfile[]>;
    removeAIAssistant: (aiId: string) => Promise<void>;
  };
  useEffect(() => {
    setCurrentAI(current => {
      if (!current) return current;
      const updated = aiList.find(ai => ai.id === current.id);
      if (!updated) return current;
      if (current.name === updated.name && current.nickname === updated.nickname
        && current.avatar === updated.avatar && current.avatarMediaAssetId === updated.avatarMediaAssetId) return current;
      return { ...current, name: updated.name, nickname: updated.nickname, avatar: updated.avatar,
        avatarMediaAssetId: updated.avatarMediaAssetId };
    });
  }, [aiList, currentAI?.id]);
  const {
    currentSubScreen,
    filePreviewParams,
    setCurrentSubScreen,
    handleOpenMenu,
    handleCloseMenu,
    handleBackToMenu,
    openProtocol,
    openModelSettings,
    openChatSettings,
    openFilePreview,
    closeFilePreview,
  } = useChatNavigation();

  const {
    refreshCurrentSession,
    resolveConversation,
    preloadConversationTimelines,
  } = useChatEntryPreload({
    currentAI,
    setCurrentSession,
  });

  const {
    beginChatEntryRequest,
    handleSelectAI,
    handleBackToList,
    handleDeleteAI,
  } = useChatConversationEntry({
    currentAI,
    setCurrentAI,
    setCurrentSession,
    setCurrentSubScreen,
    loadAIAssistants,
    removeAIAssistant,
    resolveConversation,
    onConversationViewed,
  });

  const handleModelSettingsUpdated = useCallback((updatedAI: Partial<AIProfile> | null) => {
    if (updatedAI && currentAI) {
      setCurrentAI({ ...currentAI, ...updatedAI });
    }
  }, [currentAI]);

  const handleChatSettingsUpdated = useCallback((updatedAI: Partial<AIProfile> | null) => {
    if (!updatedAI) return;
    setCurrentAI((current) => current ? { ...current, ...updatedAI } : current);
  }, []);

  const sessionRefreshControllerRef = useRef({
    currentAIId: currentAI?.id || null,
    refreshCurrentSession,
    loadAIAssistants,
    onConversationListInvalidated,
  });
  const handledSessionRefreshTriggerRef = useRef(sessionRefreshTrigger);
  sessionRefreshControllerRef.current = {
    currentAIId: currentAI?.id || null,
    refreshCurrentSession,
    loadAIAssistants,
    onConversationListInvalidated,
  };

  useEffect(() => {
    if (!dbReady || !conversationListLoadEnabled || aiListReady) {
      return;
    }

    void loadAIAssistants().catch((error) => {
      console.error('Failed to load conversation list:', error);
      markConversationListFailed(error);
    });
  }, [
    aiListReady,
    dbReady,
    conversationListLoadEnabled,
    loadAIAssistants,
  ]);

  useEffect(() => {
    if (
      !dbReady
      || !conversationListLoadEnabled
    ) {
      return;
    }

    if (handledSessionRefreshTriggerRef.current === sessionRefreshTrigger) {
      return;
    }
    handledSessionRefreshTriggerRef.current = sessionRefreshTrigger;

    const controller = sessionRefreshControllerRef.current;
    // 前台会话自身要重读，但这不能阻止会话列表事实（AI preview / 群聊 preview
    // 与顺序）同步失效：用户停在 A 会话时 B 单聊或某群聊的新消息同样会改变列表，
    // 早退会让返回列表时看到旧 preview / 旧顺序。
    if (controller.currentAIId) {
      void controller.refreshCurrentSession();
    }

    void controller.loadAIAssistants().catch((error) => {
      console.error('Failed to refresh conversation list:', error);
      markConversationListFailed(error);
    });
    controller.onConversationListInvalidated?.();
  }, [
    sessionRefreshTrigger,
    dbReady,
    conversationListLoadEnabled,
  ]);

  return {
    aiList,
    aiListReady,
    currentAI,
    currentSession,
    currentSubScreen,
    setCurrentSubScreen,
    beginChatEntryRequest,
    loadAIAssistants,
    preloadConversationTimelines,
    handleSelectAI,
    handleOpenMenu,
    handleCloseMenu,
    handleBackToMenu,
    handleModelSettingsUpdated,
    handleChatSettingsUpdated,
    handleDeleteAI,
    handleAddAI: onAddAI,
    handleBackToList,
    openProtocol,
    openModelSettings,
    openChatSettings,
    openFilePreview,
    closeFilePreview,
    filePreviewParams,
  };
}
