/** 日程诊断弹窗的有限文本与操作区。 */
import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  actions: { flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.lg },
  scroll: { flexShrink: 1 },
  content: { padding: theme.spacing.lg, paddingTop: 0 },
  report: { color: theme.colors.text.primary, fontSize: 13, lineHeight: 20 },
  error: { color: theme.colors.feedback.error, lineHeight: 20 },
});
