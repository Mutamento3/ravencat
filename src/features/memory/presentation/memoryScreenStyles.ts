/** 正文编辑、设置与触发关系界面的主题布局。 */
import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';
export const createMemoryScreenStyles = (theme: PresentationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background.screen },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  grow: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  subtitle: { fontSize: 13, lineHeight: 21, color: theme.colors.text.secondary },
  label: { fontSize: 15, fontWeight: '600', color: theme.colors.text.primary },
  body: { fontSize: 15, lineHeight: 24, color: theme.colors.text.primary },
  meta: { fontSize: 12, lineHeight: 18, color: theme.colors.text.tertiary },
  action: { fontSize: 14, fontWeight: '600', color: theme.colors.brand.primary },
  danger: { fontSize: 14, color: theme.colors.feedback.error },
  chip: { borderWidth: 1, borderColor: theme.colors.border.light, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20 },
  selectedChip: { borderColor: theme.colors.brand.primary, backgroundColor: theme.colors.surface.raised },
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, backgroundColor: theme.colors.surface.raised, borderRadius: theme.radius.lg, padding: 18, gap: 12 },
  input: { borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: theme.radius.lg, padding: 14, fontSize: 15, color: theme.colors.text.primary },
  editor: { minHeight: 240, maxHeight: 440, textAlignVertical: 'top', lineHeight: 24 },
  button: { backgroundColor: theme.colors.brand.primary, padding: 15, borderRadius: theme.radius.lg, alignItems: 'center' },
  buttonText: { color: theme.colors.text.inverse, fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.45 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border.light },
  triggerHeader: { gap: 12 },
  triggerTitle: { fontSize: 19, lineHeight: 28, fontWeight: '600', color: theme.colors.text.primary },
  triggerAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 2, alignSelf: 'flex-start' },
  triggerFooter: { alignItems: 'center', paddingVertical: 12 },
});
