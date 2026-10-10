import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createProfileDetailsStyles = (theme: PresentationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background.screen },
  content: { paddingTop: theme.spacing.md, paddingBottom: theme.spacing.xl },
  section: {
    backgroundColor: theme.colors.surface.default,
    ...(theme.effects.glass.enabled ? { marginHorizontal: theme.spacing.lg, borderRadius: theme.radius.lg, overflow: 'hidden' as const } : {}),
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 62, paddingVertical: 16, paddingHorizontal: theme.spacing.lg },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border.light, marginLeft: theme.spacing.lg },
  label: { color: theme.colors.text.primary, fontSize: 16, minWidth: 76 },
  value: { flex: 1, color: theme.colors.text.secondary, fontSize: 16, textAlign: 'right', marginLeft: theme.spacing.md, marginRight: theme.spacing.sm },
  emptyValue: { color: theme.colors.text.tertiary },
  avatar: { flex: 1, alignItems: 'flex-end', marginRight: theme.spacing.sm },
  note: { color: theme.colors.text.tertiary, fontSize: 12, lineHeight: 19, paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.md },
  editor: { padding: theme.spacing.lg },
  loading: { padding: theme.spacing.xl },
  loadingError: { color: theme.colors.feedback.error, marginBottom: theme.spacing.md },
});
