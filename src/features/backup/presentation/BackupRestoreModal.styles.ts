import { StyleSheet } from 'react-native';

import type { PresentationTheme } from '@shared/theme';

export function createBackupRestoreModalStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    scroll: {
      flexShrink: 1,
    },
    content: {
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    fileName: {
      ...theme.typography.caption,
      color: theme.colors.text.secondary,
    },
    warning: {
      ...theme.typography.bodySmall,
      color: theme.colors.feedback.warning,
      lineHeight: 20,
    },
    description: {
      ...theme.typography.bodySmall,
      color: theme.colors.text.primary,
      lineHeight: 20,
    },
    actions: {
      paddingHorizontal: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    progress: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    progressText: {
      ...theme.typography.bodySmall,
      color: theme.colors.text.secondary,
      flex: 1,
    },
  });
}
