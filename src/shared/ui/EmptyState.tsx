// src/components/EmptyState.tsx
// 通用空状态组件 - 简洁风格

import type { StyleProp, ViewStyle } from 'react-native';
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

export interface EmptyStateProps {
  title: string;
  description?: string | null;
  actionText?: string | null;
  onAction?: (() => void) | null;
  style?: StyleProp<ViewStyle>;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 100,
      paddingHorizontal: theme.spacing.xl,
    },
    title: {
      fontSize: 16,
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing.lg,
      fontWeight: '500',
    },
    description: {
      fontSize: 13,
      color: theme.colors.text.tertiary,
      textAlign: 'center',
      marginBottom: theme.spacing.lg,
      lineHeight: 20,
    },
    actionButton: {
      backgroundColor: theme.colors.brand.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: theme.radius.md,
    },
    actionText: {
      color: theme.colors.text.inverse,
      fontSize: 15,
      fontWeight: '600',
    },
  });

export default function EmptyState({
  title,
  description,
  actionText,
  onAction,
  style,
}: EmptyStateProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionText && onAction ? (
        <TouchableOpacity
          onPress={onAction}
          style={styles.actionButton}
          activeOpacity={0.7}
        >
          <Text style={styles.actionText}>{actionText}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
