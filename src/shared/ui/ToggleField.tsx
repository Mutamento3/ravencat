/** 通用开关设置项组件。 */

import type { ReactNode } from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import Toggle from './Toggle';

export interface ToggleFieldProps {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  layout?: 'stacked' | 'inline';
  accessibilityLabel?: string;
  /** 页面提供完整行布局时直接渲染该行；未提供时保留公共表单容器。 */
  rowStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  hintStyle?: StyleProp<TextStyle>;
  toggleStyle?: StyleProp<ViewStyle>;
  leading?: ReactNode;
  /** 复杂条目保留自己的内容结构，开关仍由本组件统一管理。 */
  children?: ReactNode;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    container: {
      paddingVertical: theme.spacing.md,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    label: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text.primary,
      flex: 1,
      marginRight: theme.spacing.md,
    },
    copy: {
      flex: 1,
      minWidth: 0,
      marginRight: theme.spacing.md,
    },
    inlineLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    inlineHint: {
      fontSize: 12,
      color: theme.colors.text.tertiary,
      marginTop: theme.spacing.xs,
      lineHeight: 18,
    },
    hint: {
      fontSize: 13,
      color: theme.colors.text.secondary,
      marginTop: theme.spacing.sm,
      lineHeight: 18,
    },
  });

export default function ToggleField({
  label,
  hint,
  value,
  onValueChange,
  disabled = false,
  style,
  layout = 'stacked',
  accessibilityLabel = label,
  rowStyle,
  contentStyle,
  labelStyle,
  hintStyle,
  toggleStyle,
  leading,
  children,
}: ToggleFieldProps) {
  const styles = useThemedStyles(createStyles);
  const content = <>
    {leading}
    {children ?? (layout === 'inline' ? <View style={contentStyle ?? styles.copy}>
      <Text style={labelStyle ?? styles.inlineLabel}>{label}</Text>
      {hint ? <Text style={hintStyle ?? styles.inlineHint}>{hint}</Text> : null}
    </View> : <Text style={labelStyle ?? styles.label}>{label}</Text>)}
    <Toggle accessibilityLabel={accessibilityLabel} value={value} onValueChange={onValueChange}
      disabled={disabled} style={toggleStyle} />
  </>;

  if (layout === 'inline') {
    return rowStyle !== undefined
      ? <View style={[rowStyle, style]}>{content}</View>
      : <View style={[styles.container, style]}><View style={styles.header}>{content}</View></View>;
  }
  return <View style={[styles.container, style]}>
    <View style={[styles.header, rowStyle]}>{content}</View>
    {hint ? <Text style={hintStyle ?? styles.hint}>{hint}</Text> : null}
  </View>;
}
