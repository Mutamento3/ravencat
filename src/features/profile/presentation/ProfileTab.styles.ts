import { StyleSheet } from 'react-native';

import type { PresentationTheme } from '@shared/theme';

export function createProfileStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    tabContainer: {
      flex: 1,
      backgroundColor: theme.colors.background.app,
    },
    settingsContainer: {
      flex: 1,
      backgroundColor: theme.colors.background.screen,
    },
    userInfoSection: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: theme.spacing.lg,
      backgroundColor: theme.colors.surface.default,
      marginBottom: theme.spacing.md,
      marginTop: theme.spacing.md,
      ...(theme.effects.glass.enabled ? {
        marginHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        overflow: 'hidden',
      } : {}),
    },
    userAvatarContainer: {
      position: 'relative',
      marginRight: theme.spacing.lg,
    },
    userAvatar: {
      marginRight: 0,
    },
    userAvatarSkeleton: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface.muted,
    },
    userInfo: {
      flex: 1,
    },
    userName: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text.primary,
      marginBottom: 4,
    },
    userNameSkeleton: {
      width: 96,
      height: 20,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surface.muted,
    },
    menuSection: {
      backgroundColor: theme.colors.surface.default,
      marginBottom: theme.spacing.md,
      ...(theme.effects.glass.enabled ? {
        marginHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        overflow: 'hidden',
      } : {}),
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: 16,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.light,
    },
    menuItemIcon: {
      marginRight: 10,
    },
    menuItemText: {
      flex: 1,
      fontSize: 16,
      color: theme.colors.text.primary,
    },
    versionSection: {
      padding: theme.spacing.xl,
      alignItems: 'center',
    },
    versionText: {
      fontSize: 12,
      color: theme.colors.text.tertiary,
    },
  });
}
