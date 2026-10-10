/** 摘要列表与正文编辑沿用同一套主题布局。 */
import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';
export const createChatSummaryStyles = (theme: PresentationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background.screen },
  content: { padding: 20, paddingBottom: 40, gap: 18 },
  card: { backgroundColor: theme.colors.surface.raised, padding: 18, borderRadius: theme.radius.lg, gap: 12 },
  title: { color: theme.colors.text.primary, fontSize: 20, fontWeight: '600' },
  body: { color: theme.colors.text.primary, fontSize: 15, lineHeight: 24 },
  subtitle: { color: theme.colors.text.secondary, fontSize: 13, lineHeight: 21 },
  meta: { color: theme.colors.text.tertiary, fontSize: 12, lineHeight: 18 },
  action: { color: theme.colors.brand.primary, fontSize: 14, fontWeight: '600' },
  danger: { color: theme.colors.feedback.error, fontSize: 14 },
  editor: { color: theme.colors.text.primary, padding: 16, fontSize: 15, lineHeight: 24, minHeight: 300, textAlignVertical: 'top', borderRadius: theme.radius.lg, borderColor: theme.colors.border.light, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
