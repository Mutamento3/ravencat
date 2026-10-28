import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createSearchSettingsStyles = (theme: PresentationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background.screen },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 40 },
  card: { borderRadius: theme.radius.lg, overflow: 'hidden' },
  body: { padding: theme.spacing.lg, gap: theme.spacing.md },
  proxyToggle: { paddingHorizontal: theme.spacing.lg },
  hint: { fontSize: 13, lineHeight: 20, color: theme.colors.text.secondary },
  lastItem: { borderBottomWidth: 0 },
  danger: { color: theme.colors.feedback.error },
  status: { color: theme.colors.text.secondary, fontSize: 13 },
});
