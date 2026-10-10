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
