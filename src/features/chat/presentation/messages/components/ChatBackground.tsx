/** 为聊天内容提供主题背景、会话壁纸与玻璃场景上下文。 */

import React, { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import {
  APP_GLASS_SCENE_ID,
  GlassBackdrop,
  GlassSceneProvider,
  getChatGlassSceneId,
  useTheme,
  useWallpaper,
} from '@shared/theme';

interface ChatBackgroundProps {
  chatKey?: string | null;
  children: ReactNode;
}

export default function ChatBackground({ chatKey, children }: ChatBackgroundProps) {
  const theme = useTheme();
  const { getChatWallpaperSource, appWallpaperSource } = useWallpaper();
  const chatWallpaperSource = getChatWallpaperSource(chatKey);
  const effectiveWallpaperSource = chatWallpaperSource
    ?? (theme.id === 'liquid-glass' ? appWallpaperSource : null);
  const backgroundStyle = [styles.container, { backgroundColor: theme.colors.chat.screen }];
  const chatSceneId = getChatGlassSceneId(chatKey);
  const wallpaperKey = useMemo(
    () => chatWallpaperSource
      ? Image.resolveAssetSource(chatWallpaperSource)?.uri ?? String(chatWallpaperSource)
      : null,
    [chatWallpaperSource]
  );
  const [isChatWallpaperReady, setIsChatWallpaperReady] = useState(false);

  useEffect(() => {
    setIsChatWallpaperReady(false);
  }, [wallpaperKey]);

  const shouldUseChatScene =
    theme.effects.glass.enabled &&
    Boolean(chatWallpaperSource) &&
    isChatWallpaperReady;
  const sceneId = shouldUseChatScene ? chatSceneId : APP_GLASS_SCENE_ID;

  return (
    <View style={backgroundStyle}>
      {theme.effects.glass.enabled && chatWallpaperSource ? (
        <GlassBackdrop sceneId={chatSceneId} style={styles.backgroundSource}>
          <Image
            onLoad={() => setIsChatWallpaperReady(true)}
            resizeMode="cover"
            source={chatWallpaperSource}
            style={styles.backgroundSource}
          />
        </GlassBackdrop>
      ) : effectiveWallpaperSource ? (
        <Image
          resizeMode="cover"
          source={effectiveWallpaperSource}
          style={styles.backgroundSource}
        />
      ) : null}
      <GlassSceneProvider sceneId={sceneId}>
        <View style={styles.content}>
          {children}
        </View>
      </GlassSceneProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backgroundSource: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  content: {
    flex: 1,
    zIndex: 1,
  },
});
