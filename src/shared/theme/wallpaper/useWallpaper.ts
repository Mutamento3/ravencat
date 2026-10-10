import { useContext } from 'react';
import { WallpaperContext } from './WallpaperProvider';
import type { WallpaperContextValue } from './types';

export function useWallpaper(): WallpaperContextValue {
  const context = useContext(WallpaperContext);
  if (!context) {
    throw new Error('useWallpaper must be used within a WallpaperProvider');
  }

  return context;
}
