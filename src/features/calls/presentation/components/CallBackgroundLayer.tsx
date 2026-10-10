import React from 'react';
import { ImageBackground, View } from 'react-native';

import { useTheme, useThemedStyles } from '@shared/theme';
import { createCallStyles } from '../styles';

interface CallBackgroundLayerProps {
  backgroundUri?: string | null;
  children: React.ReactNode;
}

export default function CallBackgroundLayer({
  backgroundUri,
  children,
}: CallBackgroundLayerProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createCallStyles);

  if (backgroundUri) {
    // 用户自行设定的背景图不加 scrim 遮罩，保持原图观感；
    // 文字可读性由用户选图时自行负责（后续会做固定屏幕尺寸的裁剪）。
    return (
      <ImageBackground source={{ uri: backgroundUri }} style={styles.backgroundImage} resizeMode="cover">
        {children}
      </ImageBackground>
    );
  }

  return (
    <View style={[styles.background, { backgroundColor: theme.mode === 'dark' ? '#101820' : '#E7F2F7' }]}>
      <View style={styles.scrim} />
      {children}
    </View>
  );
}
