import type { ImageSourcePropType } from 'react-native';

export type WallpaperMode = 'default' | 'custom';
export type WallpaperSlot = 'app' | 'chat';

export interface WallpaperSelection {
  mode: WallpaperMode;
  uri: string | null;
}

export type ChatWallpaperOverrides = Record<string, WallpaperSelection>;

export interface WallpaperContextValue {
  refreshWallpapers: () => Promise<void>;
  appWallpaper: WallpaperSelection;
  appWallpaperSource: ImageSourcePropType | null;
  chatWallpaper: WallpaperSelection;
  chatWallpaperSource: ImageSourcePropType | null;
  chatWallpaperOverrides: ChatWallpaperOverrides;
  getChatWallpaper: (chatKey?: string | null) => WallpaperSelection;
  getChatWallpaperSource: (chatKey?: string | null) => ImageSourcePropType | null;
  setDefaultAppWallpaper: () => Promise<void>;
  setCustomAppWallpaper: (uri: string) => Promise<void>;
  setDefaultChatWallpaper: (chatKeys?: string[]) => Promise<void>;
  setCustomChatWallpaper: (uri: string, chatKeys?: string[]) => Promise<void>;
  setDefaultChatWallpaperOverride: (chatKey: string) => Promise<void>;
  setCustomChatWallpaperOverride: (chatKey: string, uri: string) => Promise<void>;
}
