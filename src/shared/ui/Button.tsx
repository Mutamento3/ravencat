/** 通用按钮组件。 */

import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'text' | 'outline';

export interface ButtonProps {
  title: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    base: {
      borderRadius: theme.radius.md,
      paddingVertical: 12,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disabled: {
      opacity: 0.5,
    },
    textBase: {
      fontSize: 15,
      fontWeight: '600',
    },
    disabledText: {
      color: theme.colors.text.tertiary,
    },
    primary: {
      backgroundColor: theme.colors.brand.primary,
    },
    primaryText: {
      color: theme.colors.text.inverse,
    },
    secondary: {
      backgroundColor: theme.colors.surface.muted,
    },
    secondaryText: {
      color: theme.colors.text.primary,
    },
    danger: {
      backgroundColor: theme.colors.feedback.error,
    },
    dangerText: {
      color: theme.colors.text.inverse,
    },
    text: {
      backgroundColor: 'transparent',
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm,
    },
    textText: {
      color: theme.colors.brand.primary,
    },
    outline: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.colors.border.default,
    },
    outlineText: {
      color: theme.colors.text.secondary,
    },
  });

export default function Button({
  title,
  variant = 'primary',
  disabled = false,
  onPress,
  style,
  textStyle: customTextStyle,
}: ButtonProps) {
  const styles = useThemedStyles(createStyles);

  const buttonStyle = [
    styles.base,
    styles[variant],
    disabled && styles.disabled,
    style,
  ];

  const textStyle = [
    styles.textBase,
    styles[`${variant}Text` as const],
    disabled && styles.disabledText,
    customTextStyle,
  ];

  return (
    <TouchableOpacity
      onPress={onPress}
      style={buttonStyle}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <Text style={textStyle}>{title}</Text>
    </TouchableOpacity>
  );
}
