import type { ChatWallpaperOverrides, WallpaperSelection } from './types';

export const DEFAULT_WALLPAPER_SELECTION: WallpaperSelection = {
  mode: 'default',
  uri: null,
};

export interface StoredWallpaperState {
  appWallpaper: WallpaperSelection;
  chatWallpaper: WallpaperSelection;
  chatWallpaperOverrides: ChatWallpaperOverrides;
}

export const DEFAULT_WALLPAPER_STATE: StoredWallpaperState = {
  appWallpaper: DEFAULT_WALLPAPER_SELECTION,
  chatWallpaper: DEFAULT_WALLPAPER_SELECTION,
  chatWallpaperOverrides: {},
};
