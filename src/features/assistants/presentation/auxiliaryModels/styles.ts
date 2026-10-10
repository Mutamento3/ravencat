
import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export function createStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    screenContainer: {
      flex: 1,
      backgroundColor: theme.colors.background.app,
    },
    scrollView: {
      flex: 1,
      backgroundColor: theme.colors.background.screen,
    },
    bottomGap: {
      height: theme.spacing.xxl,
    },
    stateCard: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xl,
      backgroundColor: theme.colors.background.screen,
    },
    stateText: {
      marginTop: theme.spacing.md,
      fontSize: 14,
      color: theme.colors.text.secondary,
    },
    card: {
      borderRadius: theme.radius.lg,
      marginHorizontal: theme.spacing.lg,
      overflow: 'hidden',
    },
    emptyCard: {
      backgroundColor: theme.colors.background.app,
      borderRadius: theme.radius.lg,
      marginHorizontal: theme.spacing.lg,
      minHeight: 260,
    },
    itemLast: {
      borderBottomWidth: 0,
    },
    sectionBlock: {
      marginTop: theme.spacing.lg,
    },
    sectionHint: {
      fontSize: 13,
      color: theme.colors.text.secondary,
      marginHorizontal: theme.spacing.lg,
      lineHeight: 20,
    },
    headerIconBtn: {
      padding: theme.spacing.sm,
      marginRight: -theme.spacing.sm,
    },
    poolItemTitleDisabled: {
      color: theme.colors.text.tertiary,
    },
    editContentContainer: {
      paddingBottom: theme.spacing.xl,
    },
    editSection: {
      backgroundColor: theme.colors.background.app,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.md,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.light,
    },
    editSectionLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text.primary,
      marginBottom: theme.spacing.md,
    },
  });
}
