/** Floating Layer 悬浮交互页面的主题样式；不依赖 Companion 页面样式。 */

import type { PresentationTheme } from '@shared/theme';
import { StyleSheet } from 'react-native';

export const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: theme.colors.background.app },
  scrollView: { flex: 1, backgroundColor: theme.colors.background.screen },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { marginTop: theme.spacing.sm, color: theme.colors.text.secondary },
  sectionTitle: { marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg, marginBottom: theme.spacing.xs, fontSize: 13, color: theme.colors.text.secondary },
  card: { marginHorizontal: theme.spacing.lg, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surface.default },
  cardContent: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  errorCard: { margin: theme.spacing.lg, marginBottom: 0, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface.default },
  errorText: { color: theme.colors.feedback.error, lineHeight: 20 },
  settingHint: { marginTop: 4, fontSize: 13, color: theme.colors.text.secondary },
  settingValue: { color: theme.colors.brand.primary, fontWeight: '600' },
  settingRow: { paddingTop: theme.spacing.md, paddingBottom: theme.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lastRow: { borderBottomWidth: 0 },
  entryCard: { marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg, padding: theme.spacing.lg, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface.default, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entryTitle: { fontSize: 16, fontWeight: '600', color: theme.colors.text.primary },
  entryHint: { marginTop: 4, fontSize: 13, color: theme.colors.text.secondary },
  bottomGap: { height: theme.spacing.xxl },
});
