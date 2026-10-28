import React, { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from 'react';
import { AppState } from 'react-native';
import { showAppDialog } from '@shared/ui';
import { ChatTextDraftStore } from '../../conversation/application/ChatTextDraftStore';
import { getChatTextDraftRepository } from '../../conversation/application/ChatTextDraftRuntime';

const Context = createContext<ChatTextDraftStore | null>(null);
const reportError = (error: unknown) => {
  console.error('[Chat] 文字草稿保存失败', error);
  showAppDialog({ title: '草稿未能保存', message: '当前文字仍保留在应用中，但未能保存到本地。', tone: 'error' });
};

/** 缓存随宿主重建而释放，恢复出厂不会把旧进程草稿带回新数据库。 */
export function ChatTextDraftProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [store] = useState(() => new ChatTextDraftStore({
    list: () => getChatTextDraftRepository().list(),
    save: drafts => getChatTextDraftRepository().save(drafts),
  }, reportError));
  useEffect(() => {
    if (!enabled) return;
    void store.load().catch(error => {
      console.error('[Chat] 文字草稿读取失败', error);
      showAppDialog({ title: '草稿读取失败', message: '未能读取本地文字草稿，请重新打开应用。', tone: 'error' });
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') void store.flush().catch(reportError);
    });
    return () => { subscription.remove(); void store.flush().catch(reportError); };
  }, [enabled, store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useChatTextDraftStore() {
  const store = useContext(Context);
  if (!store) throw new Error('文字草稿必须位于 ChatTextDraftProvider 内');
  return store;
}

export function useChatTextDrafts() {
  const store = useChatTextDraftStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useChatTextDraft(conversationId: string | undefined, active: boolean) {
  const store = useChatTextDraftStore();
  const draft = useSyncExternalStore(store.subscribe, useCallback(() => conversationId ? store.read(conversationId) : undefined, [conversationId, store]));
  const ready = useSyncExternalStore(store.subscribe, () => store.getSnapshot().ready);
  const text = draft?.text ?? '';
  const setText = useCallback((next: SetStateAction<string>) => {
    if (!conversationId) return;
    store.change(conversationId, typeof next === 'function' ? next(store.read(conversationId)?.text ?? '') : next);
  }, [conversationId, store]);
  useEffect(() => {
    if (!active) void store.flush().catch(reportError);
    return () => { void store.flush().catch(reportError); };
  }, [active, conversationId, store]);
  return { text, setText, ready, store };
}
