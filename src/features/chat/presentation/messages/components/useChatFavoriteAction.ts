import { useCallback, useRef } from 'react';
import { ToastAndroid } from 'react-native';
import { showAppDialog } from '@shared/ui';
import { createChatFavorite } from '../../../favorites/application/ChatFavorites';
import type { ChatMessage } from '../../../messages/domain/ChatMessage';

export function useChatFavoriteAction(message: ChatMessage | null, sourceName: string, assistantId?: string) {
  const saving = useRef(false);
  return useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      await createChatFavorite({ messageId: message!.id, sourceName, assistantId });
      ToastAndroid.show('已收藏', ToastAndroid.SHORT);
    } catch (error) {
      showAppDialog({ title: '收藏失败', message: error instanceof Error ? error.message : '无法收藏这条消息', tone: 'error' });
    } finally { saving.current = false; }
  }, [message, sourceName, assistantId]);
}
