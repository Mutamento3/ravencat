// src/components/ListItem.tsx
// 通用列表项组件（带箭头/副文本）- 简洁风格

import type { ReactNode } from 'react';
import type { GestureResponderEvent, StyleProp, TextStyle, ViewStyle } from 'react-native';
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

export interface ListItemProps {
  title?: string | null;
  titleContent?: ReactNode;
  subtitle?: string | null;
  leftIcon?: ReactNode;
  leftContent?: ReactNode;
  titleExtra?: ReactNode;
  rightContent?: ReactNode;
  showArrow?: boolean;
  showActiveDot?: boolean;
  active?: boolean;
  onPress?: ((event: GestureResponderEvent) => void) | null;
  onLongPress?: ((event: GestureResponderEvent) => void) | null;
  delayLongPress?: number;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  leftIconStyle?: StyleProp<TextStyle>;
  arrowColor?: string;
  titleNumberOfLines?: number;
  subtitleNumberOfLines?: number;
  activeOpacity?: number;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: 14,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.light,
    },
    active: {
      backgroundColor: theme.colors.brand.primary + '08',
    },
    leftContent: {
      marginRight: theme.spacing.md,
    },
    leftIcon: {
      fontSize: 20,
      marginRight: theme.spacing.md,
      width: 24,
      textAlign: 'center',
    },
    content: {
      flex: 1,
    },
    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 2,
    },
    titleWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    title: {
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.text.primary,
    },
    titleContent: {
      flex: 1,
    },
    titleExtra: {
      marginLeft: theme.spacing.md,
    },
    subtitle: {
      fontSize: 13,
      color: theme.colors.text.secondary,
      marginTop: 2,
    },
    activeDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.feedback.success,
      marginRight: 8,
    },
  });

export default function ListItem({
  title,
  titleContent,
  subtitle,
  leftIcon,
  leftContent,
  titleExtra,
  rightContent,
  showArrow = true,
  showActiveDot = false,
  active = false,
  onPress,
  onLongPress,
  delayLongPress,
  style,
  titleStyle,
  subtitleStyle,
  leftIconStyle,
  titleNumberOfLines = 1,
  subtitleNumberOfLines = 1,
  activeOpacity = 0.7,
}: ListItemProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <TouchableOpacity
      style={[
        styles.container,
        !theme.effects.glass.enabled && { backgroundColor: theme.colors.surface.default },
        active && styles.active,
        style
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      activeOpacity={activeOpacity}
    >
      {leftContent ? (
        <View style={styles.leftContent}>{leftContent}</View>
      ) : leftIcon ? (
        <Text style={[styles.leftIcon, leftIconStyle]}>{leftIcon}</Text>
      ) : null}

      <View style={styles.content}>
        <View style={styles.titleRow}>
          {titleContent ? (
            <View style={styles.titleContent}>{titleContent}</View>
          ) : (
            <View style={styles.titleWrapper}>
              {showActiveDot && <View style={styles.activeDot} />}
              <Text
                style={[styles.title, titleStyle]}
                numberOfLines={titleNumberOfLines}
              >
                {title}
              </Text>
            </View>
          )}
          {titleExtra ? <View style={styles.titleExtra}>{titleExtra}</View> : null}
        </View>
        {subtitle ? (
          <Text
            style={[styles.subtitle, subtitleStyle]}
            numberOfLines={subtitleNumberOfLines}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {rightContent ? rightContent : null}
    </TouchableOpacity>
  );
}
