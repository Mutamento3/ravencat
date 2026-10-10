import React from 'react';
import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  APP_GLASS_SCENE_ID,
  GlassBackdrop,
  GlassSceneProvider,
} from '../components/GlassScene';
import { useTheme } from '../useTheme';
import { DefaultGlassBackdrop } from './DefaultGlassBackdrop';
import { useWallpaper } from './useWallpaper';

interface AppBackgroundProps {
  children: ReactNode;
}

export const AppBackground: React.FC<AppBackgroundProps> = ({ children }) => {
  const theme = useTheme();
  const { appWallpaperSource } = useWallpaper();
  const backgroundStyle = [styles.background, { backgroundColor: theme.colors.background.app }];

  return (
    <View style={backgroundStyle}>
      <StatusBar
        backgroundColor="transparent"
        style={theme.mode === 'dark' ? 'light' : 'dark'}
        translucent
      />
      {theme.effects.glass.enabled ? (
        <GlassBackdrop
          sceneId={APP_GLASS_SCENE_ID}
          style={styles.backdrop}
        >
          {appWallpaperSource ? (
            <Image
              resizeMode="cover"
              source={appWallpaperSource}
              style={styles.backdrop}
            />
          ) : (
            <DefaultGlassBackdrop style={styles.backdrop} />
          )}
        </GlassBackdrop>
      ) : null}
      {/* 顶部背景由页面绘制，宿主只提供底图；安全区仅由页面用于避让交互内容。 */}
      <GlassSceneProvider sceneId={APP_GLASS_SCENE_ID}>
        <View style={styles.content}>
          {children}
        </View>
      </GlassSceneProvider>
    </View>
  );
};

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  content: {
    flex: 1,
    zIndex: 1,
  },
});
