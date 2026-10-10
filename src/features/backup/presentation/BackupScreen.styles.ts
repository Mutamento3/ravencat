import { StyleSheet } from 'react-native';

import type { PresentationTheme } from '@shared/theme';

export function createBackupScreenStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background.app,
    },
    scroll: {
      flex: 1,
      backgroundColor: theme.colors.background.screen,
    },
    content: {
      padding: theme.spacing.lg,
      paddingBottom: theme.spacing.xxl,
    },
    securityCard: {
      flexDirection: 'row',
      padding: theme.spacing.lg,
      borderRadius: theme.radius.lg,
      marginBottom: theme.spacing.xl,
      backgroundColor: theme.colors.surface.default,
    },
    securityIcon: {
      marginRight: theme.spacing.md,
      marginTop: 2,
    },
    securityTextBlock: {
      flex: 1,
    },
    securityTitle: {
      color: theme.colors.text.primary,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: theme.spacing.xs,
    },
    securityDescription: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      lineHeight: 20,
    },
    sectionTitle: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: theme.spacing.sm,
      marginLeft: theme.spacing.xs,
    },
    targetCard: {
      padding: theme.spacing.lg,
      borderRadius: theme.radius.lg,
      marginBottom: theme.spacing.xl,
      backgroundColor: theme.colors.surface.default,
    },
    targetHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    targetIcon: {
      width: 42,
      height: 42,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.md,
      backgroundColor: theme.colors.surface.muted,
    },
    targetTextBlock: {
      flex: 1,
      minWidth: 0,
    },
    targetTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    targetTitle: {
      color: theme.colors.text.primary,
      fontSize: 16,
      fontWeight: '600',
      flexShrink: 1,
    },
    targetDescription: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      lineHeight: 19,
      marginTop: theme.spacing.xs,
    },
    locationBox: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      marginTop: theme.spacing.lg,
      backgroundColor: theme.colors.background.screen,
    },
    locationLabel: {
      color: theme.colors.text.tertiary,
      fontSize: 12,
      marginRight: theme.spacing.sm,
    },
    locationValue: {
      color: theme.colors.text.primary,
      fontSize: 13,
      fontWeight: '500',
      flex: 1,
    },
    primaryButton: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.brand.primary,
      marginTop: theme.spacing.xs,
    },
    primaryButtonPressed: {
      opacity: 0.85,
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    primaryButtonText: {
      color: theme.colors.text.inverse,
      fontSize: 14,
      fontWeight: '600',
    },
    emptyText: {
      color: theme.colors.text.tertiary,
      fontSize: 13,
      textAlign: 'center',
      paddingVertical: theme.spacing.sm,
    },
    backupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
    },
    backupTextBlock: {
      flex: 1,
      minWidth: 0,
      marginRight: theme.spacing.md,
    },
    backupName: {
      color: theme.colors.text.primary,
      fontSize: 13,
      fontWeight: '500',
    },
    backupMeta: {
      color: theme.colors.text.tertiary,
      fontSize: 11,
      marginTop: theme.spacing.xs,
    },
    restoreButton: {
      minHeight: 34,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface.muted,
    },
    restoreButtonText: {
      color: theme.colors.brand.primary,
      fontSize: 12,
      fontWeight: '600',
    },
    deleteButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: theme.spacing.xs,
    },
    externalButton: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border.default,
      marginTop: theme.spacing.sm,
      paddingTop: theme.spacing.md,
    },
    externalButtonText: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      fontWeight: '500',
    },
  });
}
