/** 仅迁移当前安装的旧壁纸设置，不解析旧备份包。 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WallpaperSelection, StoredWallpaperState } from '@shared/theme';
import { DEFAULT_WALLPAPER_SELECTION, DEFAULT_WALLPAPER_STATE } from '@shared/theme/wallpaper';

export async function loadStoredWallpaperStateStrict(): Promise<StoredWallpaperState> {
  const stored = await AsyncStorage.getItem('presentation.wallpaper.v2');
  if (stored === null) return DEFAULT_WALLPAPER_STATE;
  const parsed: unknown = JSON.parse(stored);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('壁纸设置无效');
  const state = parsed as Record<string, unknown>;
  const overrides = state.chatWallpaperOverrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('会话壁纸设置无效');
  return {
    appWallpaper: parseSelection(state.appWallpaper),
    chatWallpaper: parseSelection(state.chatWallpaper),
    chatWallpaperOverrides: Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, parseSelection(value)])),
  };
}

function parseSelection(value: unknown): WallpaperSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('壁纸项无效');
  const selection = value as Partial<WallpaperSelection>;
  if (selection.mode === 'default' && selection.uri === null) return DEFAULT_WALLPAPER_SELECTION;
  if (selection.mode === 'custom' && typeof selection.uri === 'string' && selection.uri.trim()) return { mode: 'custom', uri: selection.uri };
  throw new Error('壁纸项无效');
}
