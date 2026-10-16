import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createSearchSettingsStyles = (theme: PresentationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background.screen },
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: 40 },
  card: { borderRadius: theme.radius.lg, overflow: 'hidden' },
  body: { padding: theme.spacing.lg, gap: theme.spacing.md },
  title: { fontSize: 17, fontWeight: '600', color: theme.colors.text.primary },
  hint: { fontSize: 13, lineHeight: 20, color: theme.colors.text.secondary },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
  copy: { flex: 1, gap: theme.spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  action: { color: theme.colors.brand.primary, fontSize: 14, paddingVertical: 8 },
  danger: { color: theme.colors.feedback.error },
  muted: { opacity: 0.45 },
  status: { color: theme.colors.text.secondary, fontSize: 13 },
});
