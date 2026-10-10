/** 通用卡片容器组件。 */

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { useThemedStyles, ThemedSurface } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    card: {
      borderRadius: theme.radius.lg,
      padding: 16,
    },
  });

export default function Card({ children, style }: CardProps) {
  const styles = useThemedStyles(createStyles);
  return (
    <ThemedSurface variant="card" style={[styles.card, style]}>
      {children}
    </ThemedSurface>
  );
}
