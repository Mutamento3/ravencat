/** 定义单聊设置页面的主题化布局与表单样式。 */

import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    // AI 信息卡片
    aiCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: theme.spacing.lg,
      backgroundColor: theme.colors.surface.default,
      borderBottomWidth: 8,
      borderBottomColor: theme.colors.background.screen,
    },
    // 表单区域
    formSection: {
      backgroundColor: theme.colors.surface.default,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
    },
    settingsSection: {
      backgroundColor: theme.colors.surface.default,
      padding: theme.spacing.lg,
      marginTop: theme.spacing.md,
    },
    sectionLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text.primary,
      marginBottom: theme.spacing.md,
    },
    paramDescription: {
      fontSize: 13,
      color: theme.colors.text.secondary,
      lineHeight: 18,
      marginBottom: theme.spacing.md,
    },
    contextLimitField: {
      marginBottom: theme.spacing.md,
    },
    contextLimitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    contextLimitLabel: {
      flex: 1,
      minWidth: 0,
      fontSize: 15,
      color: theme.colors.text.primary,
    },
    contextLimitInput: {
      backgroundColor: theme.colors.background.app,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 6,
      fontSize: 16,
      color: theme.colors.brand.primary,
      fontWeight: '600',
      textAlign: 'center',
      width: 80,
      flexShrink: 0,
      minHeight: 44,
      textAlignVertical: 'center',
    },
    contextLimitError: {
      color: theme.colors.feedback.error,
      fontSize: 13,
      marginTop: theme.spacing.xs,
    },
    fixedPreview: {
      fontSize: 15, color: theme.colors.text.primary, lineHeight: 22, marginBottom: theme.spacing.md,
    },
    fixedActions: {
      flexDirection: 'row', gap: theme.spacing.lg, marginBottom: theme.spacing.md,
    },
    fixedAction: {
      color: theme.colors.brand.primary, fontSize: 15, paddingVertical: theme.spacing.sm,
    },
    // 通话背景区域（容器节奏；内部预览与按钮统一走 shared BackgroundPickerCard）
    callBackgroundSection: {
      backgroundColor: theme.colors.surface.default,
      marginTop: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      borderTopWidth: 8,
      borderBottomWidth: 8,
      borderColor: theme.colors.background.screen,
      borderRadius: 0,
    },
  });
