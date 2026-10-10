/** 通用开关设置项组件。 */

import type { StyleProp, ViewStyle } from 'react-native';
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
}: ToggleFieldProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Toggle
          accessibilityLabel={label}
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}
