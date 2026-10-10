import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from './useTheme';
import type { PresentationTheme } from './types';

export type ThemedStyleFactory<T> = (theme: PresentationTheme) => T;

export function useThemedStyles<T extends Record<string, any>>(
  factory: ThemedStyleFactory<T>
): T {
  const theme = useTheme();
  return useMemo(() => StyleSheet.create(factory(theme)), [factory, theme]);
}
