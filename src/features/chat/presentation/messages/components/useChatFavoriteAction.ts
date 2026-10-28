import { useCallback, useEffect, useRef, useState } from 'react';
import { ToastAndroid } from 'react-native';
import { showAppDialog } from '@shared/ui';
import { createChatFavorite, getChatFavoriteByMessage, removeChatFavorite } from '../../../favorites/application/ChatFavorites';
import type { ChatFavorite } from '../../../favorites/domain/ChatFavorite';
import type { ChatMessage } from '../../../messages/domain/ChatMessage';

export function useChatFavoriteAction(message: ChatMessage | null, sourceName: string, assistantId?: string) {
  const saving = useRef(false);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ messageId: number; favorite: ChatFavorite | null } | null>(null);
  const messageId = message?.id;

  useEffect(() => {
    setLoaded(null);
    if (messageId == null || saving.current) return;
    let active = true;
    void getChatFavoriteByMessage(messageId).then(favorite => {
      if (active) setLoaded({ messageId, favorite });
    }).catch((error: unknown) => {
      if (active) showAppDialog({ title: '收藏状态加载失败', message: error instanceof Error ? error.message : '无法读取收藏状态', tone: 'error' });
    });
    return () => { active = false; };
  }, [messageId, revision]);

  const toggle = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setLoaded(null);
    const favorite = loaded!.favorite;
    try {
      if (favorite) await removeChatFavorite(favorite.id);
      else await createChatFavorite({ messageId: messageId!, sourceName, assistantId });
      ToastAndroid.show(favorite ? '已取消收藏' : '已收藏', ToastAndroid.SHORT);
    } catch (error) {
      showAppDialog({ title: favorite ? '取消收藏失败' : '收藏失败', message: error instanceof Error ? error.message : '无法更新收藏状态', tone: 'error' });
    } finally {
      saving.current = false;
      // 写入期间可能已关闭或切换菜单；提交后重新读取当前选择，避免回填旧消息状态。
      setRevision(value => value + 1);
    }
  }, [loaded, messageId, sourceName, assistantId]);

  const ready = loaded !== null && loaded.messageId === messageId;
  return { isFavorited: ready && loaded.favorite !== null, toggle: ready ? toggle : undefined };
}
