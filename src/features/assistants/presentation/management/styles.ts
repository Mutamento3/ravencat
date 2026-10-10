import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    contentContainer: {
      paddingBottom: theme.spacing.xl,
    },
    section: {
      padding: theme.spacing.lg,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.light,
    },
    selectedModelContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.colors.brand.primary + '10',
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
    },
    selectedModelText: {
      fontSize: 16,
      color: theme.colors.brand.primary,
      fontWeight: '500',
      flex: 1,
      marginRight: theme.spacing.md,
    },
    changeModelBtn: {
      backgroundColor: theme.colors.surface.default,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    changeModelText: {
      color: theme.colors.brand.primary,
      fontSize: 13,
      fontWeight: '500',
    },
    testButton: {
      backgroundColor: theme.colors.text.secondary,
      borderRadius: theme.radius.md,
      paddingVertical: 12,
      alignItems: 'center',
    },
    testButtonSuccess: {
      backgroundColor: theme.colors.feedback.success,
    },
    testButtonError: {
      backgroundColor: theme.colors.feedback.error,
    },
    testButtonText: {
      color: theme.colors.surface.default,
      fontSize: 15,
      fontWeight: '500',
    },
    // 步骤指示器样式
    stepIndicatorContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.lg,
      paddingHorizontal: theme.spacing.xl,
    },
    stepItem: {
      alignItems: 'center',
    },
    stepCircle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.colors.surface.muted,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: theme.colors.border.default,
    },
    stepCircleActive: {
      backgroundColor: theme.colors.brand.primary,
      borderColor: theme.colors.brand.primary,
    },
    stepCircleCompleted: {
      backgroundColor: theme.colors.brand.primary + '20',
      borderColor: theme.colors.brand.primary,
    },
    stepNumber: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text.secondary,
    },
    stepNumberActive: {
      color: theme.colors.surface.default,
    },
    stepNumberCompleted: {
      color: theme.colors.brand.primary,
    },
    stepLabel: {
      fontSize: 12,
      color: theme.colors.text.tertiary,
      marginTop: theme.spacing.xs,
    },
    stepLabelActive: {
      color: theme.colors.brand.primary,
      fontWeight: '500',
    },
    stepConnector: {
      flex: 1,
      height: 2,
      backgroundColor: theme.colors.border.default,
      marginHorizontal: theme.spacing.sm,
    },
    stepConnectorCompleted: {
      backgroundColor: theme.colors.brand.primary,
    },
  });
