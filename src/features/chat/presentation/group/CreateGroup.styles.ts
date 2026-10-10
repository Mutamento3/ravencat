/** 定义创建群聊页面的主题化布局、头像与表单样式。 */

import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    contentContainer: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: 40,
    },
    avatarSection: {
      alignItems: 'center',
      marginTop: theme.spacing.xl,
      marginBottom: theme.spacing.xxl,
    },
    avatarWrapper: {
      position: 'relative',
    },
    avatarImage: {
      width: 80,
      height: 80,
      borderRadius: theme.radius.lg,
    },
    avatarEditBadge: {
      position: 'absolute',
      bottom: -4,
      right: -4,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.colors.brand.primary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: theme.colors.surface.default,
    },
    emptyHint: {
      fontSize: 14,
      color: theme.colors.text.secondary,
      textAlign: 'center',
      paddingVertical: theme.spacing.xl,
    },
    aiRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border.light,
    },
    aiName: {
      flex: 1,
      marginLeft: theme.spacing.md,
      fontSize: 16,
      color: theme.colors.text.primary,
      fontWeight: '500',
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: theme.colors.border.default,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxChecked: {
      backgroundColor: theme.colors.brand.primary,
      borderColor: theme.colors.brand.primary,
    },
    section: {
      paddingTop: theme.spacing.lg,
    },
    fullWidthButton: {
      width: '100%',
      marginTop: theme.spacing.sm,
    },
    selectedModelContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface.muted,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    selectedModelText: {
      flex: 1,
      fontSize: 14,
      color: theme.colors.text.primary,
      fontWeight: '500',
    },
    changeModelBtn: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    changeModelText: {
      fontSize: 14,
      color: theme.colors.brand.primary,
      fontWeight: '600',
    },
    modelHint: {
      marginTop: theme.spacing.sm,
      fontSize: 13,
      color: theme.colors.text.secondary,
    },
  });
