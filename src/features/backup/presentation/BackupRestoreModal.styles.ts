import { StyleSheet } from 'react-native';

import type { PresentationTheme } from '@shared/theme';

export function createBackupRestoreModalStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'center',
      padding: theme.spacing.xl,
      backgroundColor: 'rgba(0, 0, 0, 0.48)',
    },
    card: {
      borderRadius: theme.radius.lg,
      padding: theme.spacing.xl,
      backgroundColor: theme.colors.surface.default,
    },
    title: {
      color: theme.colors.text.primary,
      fontSize: 18,
      fontWeight: '700',
    },
    fileName: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      marginTop: theme.spacing.sm,
    },
    warning: {
      color: theme.colors.feedback.warning,
      fontSize: 13,
      lineHeight: 20,
      marginTop: theme.spacing.lg,
    },
    actionRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    button: {
      minHeight: 42,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    cancelButton: {
      backgroundColor: theme.colors.surface.muted,
    },
    restoreButton: {
      backgroundColor: theme.colors.feedback.error,
    },
    disabled: {
      opacity: 0.55,
    },
    cancelText: {
      color: theme.colors.text.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    restoreText: {
      color: theme.colors.text.inverse,
      fontSize: 14,
      fontWeight: '600',
    },
  });
}
