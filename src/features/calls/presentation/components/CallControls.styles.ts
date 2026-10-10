import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createCallControlsStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-evenly',
    },
    controlItem: {
      width: 64,
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    controlTouch: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    controlLabel: {
      ...theme.typography.label,
      color: theme.colors.text.inverse,
    },
  });
