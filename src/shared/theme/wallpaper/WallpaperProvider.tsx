import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ImageSourcePropType } from 'react-native';
import type { ChatWallpaperOverrides, WallpaperContextValue, WallpaperSelection, WallpaperSlot } from './types';
import { DEFAULT_WALLPAPER_SELECTION, type StoredWallpaperState } from './wallpaperStorage';

export const WallpaperContext = createContext<WallpaperContextValue | null>(null);

interface WallpaperProviderProps {
  children: ReactNode;
  persistence: {
    load(): Promise<StoredWallpaperState>;
    setGlobal(slot: WallpaperSlot, uri: string | null, chatKeys: readonly string[]): Promise<void>;
    setConversation(key: string, uri: string | null): Promise<void>;
    subscribe(listener: () => void): () => void;
  };
}

function getWallpaperSource(selection: WallpaperSelection): ImageSourcePropType | null {
  if (selection.mode === 'custom' && selection.uri) {
    return { uri: selection.uri };
  }

  return null;
}

export const WallpaperProvider: React.FC<WallpaperProviderProps> = ({ children, persistence }) => {
  const readRevision = useRef(0);
  const [appWallpaper, setAppWallpaper] = useState<WallpaperSelection>(DEFAULT_WALLPAPER_SELECTION);
  const [chatWallpaper, setChatWallpaper] = useState<WallpaperSelection>(DEFAULT_WALLPAPER_SELECTION);
  const [chatWallpaperOverrides, setChatWallpaperOverrides] = useState<ChatWallpaperOverrides>({});

  const refresh = useCallback(async () => {
    const revision = ++readRevision.current;
    const state = await persistence.load();
    if (revision === readRevision.current) {
      setAppWallpaper(state.appWallpaper);
      setChatWallpaper(state.chatWallpaper);
      setChatWallpaperOverrides(state.chatWallpaperOverrides);
    }
  }, [persistence]);

  useEffect(() => {
    const update = () => { void refresh().catch((error) => console.error('[Wallpaper] 背景加载失败：', error)); };
    const unsubscribe = persistence.subscribe(update);
    update();
    return () => { unsubscribe(); readRevision.current += 1; };
  }, [persistence, refresh]);

  const changeGlobal = useCallback(async (slot: WallpaperSlot, uri: string | null, chatKeys: string[] = []) => {
    await persistence.setGlobal(slot, uri, chatKeys);
  }, [persistence]);
  const changeConversation = useCallback(async (key: string, uri: string | null) => {
    await persistence.setConversation(key, uri);
  }, [persistence]);
  const setDefaultAppWallpaper = useCallback(() => changeGlobal('app', null), [changeGlobal]);
  const setCustomAppWallpaper = useCallback((uri: string) => changeGlobal('app', uri), [changeGlobal]);
  const setDefaultChatWallpaper = useCallback((keys: string[] = []) => changeGlobal('chat', null, keys), [changeGlobal]);
  const setCustomChatWallpaper = useCallback((uri: string, keys: string[] = []) => changeGlobal('chat', uri, keys), [changeGlobal]);
  const setDefaultChatWallpaperOverride = useCallback((key: string) => changeConversation(key, null), [changeConversation]);
  const setCustomChatWallpaperOverride = useCallback((key: string, uri: string) => changeConversation(key, uri), [changeConversation]);

  const getChatWallpaper = useCallback((chatKey?: string | null) => (
    chatKey && chatWallpaperOverrides[chatKey]
      ? chatWallpaperOverrides[chatKey]
      : DEFAULT_WALLPAPER_SELECTION
  ), [chatWallpaperOverrides]);

  const getChatWallpaperSource = useCallback((chatKey?: string | null) => (
    getWallpaperSource(getChatWallpaper(chatKey))
  ), [getChatWallpaper]);

  const value = useMemo<WallpaperContextValue>(() => ({
    refreshWallpapers: refresh,
    appWallpaper,
    appWallpaperSource: getWallpaperSource(appWallpaper),
    chatWallpaper,
    chatWallpaperSource: getWallpaperSource(chatWallpaper),
    chatWallpaperOverrides,
    getChatWallpaper,
    getChatWallpaperSource,
    setDefaultAppWallpaper,
    setCustomAppWallpaper,
    setDefaultChatWallpaper,
    setCustomChatWallpaper,
    setDefaultChatWallpaperOverride,
    setCustomChatWallpaperOverride,
  }), [
    refresh,
    appWallpaper,
    chatWallpaper,
    chatWallpaperOverrides,
    getChatWallpaper,
    getChatWallpaperSource,
    setCustomAppWallpaper,
    setCustomChatWallpaper,
    setCustomChatWallpaperOverride,
    setDefaultAppWallpaper,
    setDefaultChatWallpaper,
    setDefaultChatWallpaperOverride,
  ]);

  return (
    <WallpaperContext.Provider value={value}>
      {children}
    </WallpaperContext.Provider>
  );
};
