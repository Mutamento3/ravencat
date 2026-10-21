import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export function createHttpDiagnosticsStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background.screen },
    scroll: { flex: 1 },
    content: { padding: theme.spacing.lg, gap: theme.spacing.md },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    heading: { ...theme.typography.title, color: theme.colors.text.primary },
    text: { ...theme.typography.body, color: theme.colors.text.primary },
    hint: { ...theme.typography.caption, color: theme.colors.text.secondary, lineHeight: 20 },
    error: { ...theme.typography.body, color: theme.colors.feedback.error },
    record: {
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      gap: theme.spacing.xs,
    },
    detailScroll: { flexShrink: 1 },
    detailContent: { padding: theme.spacing.lg, gap: theme.spacing.md },
    detailActions: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm },
    bodyHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.md },
    bodyTitle: { flex: 1 },
    raw: {
      fontFamily: 'monospace',
      fontSize: 12,
      lineHeight: 19,
      color: theme.colors.text.primary,
      backgroundColor: theme.colors.surface.muted,
      padding: theme.spacing.md,
      borderRadius: theme.radius.sm,
    },
  });
}
