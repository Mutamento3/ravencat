/** 使用 Expo 图标的通用勾选组件。 */

import type { StyleProp, ViewStyle } from 'react-native';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@shared/theme';

export interface CheckIconProps {
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * 勾选图标组件
 * @param color - 图标颜色（默认主色）
 * @param size - 图标大小（默认 18）
 * @param style - 容器额外样式
 */
export default function CheckIcon({
  color,
  size = 18,
  style,
}: CheckIconProps) {
  const theme = useTheme();
  const resolvedColor = color || theme.colors.brand.primary;

  return (
    <View style={[styles.container, { width: size, height: size }, style]}>
      <Ionicons name="checkmark" size={size} color={resolvedColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
