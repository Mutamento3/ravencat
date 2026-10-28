/** 定义创建群聊页面的主题化布局、头像与表单样式。 */

import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    contentContainer: {
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
      bottom: -2,
      right: -2,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: theme.colors.brand.primary,
      justifyContent: 'center',
      alignItems: 'center',
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
      padding: theme.spacing.lg,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.light,
    },
  });
