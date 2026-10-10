/** Prompt Pack 即时检查器样式。 */

import { StyleSheet } from 'react-native';
import type { PresentationTheme } from '@shared/theme';

export const createPromptPackInspectorStyles = (theme: PresentationTheme) => StyleSheet.create({
  content: { paddingBottom: theme.spacing.xxl },
  section: { marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.lg },
  title: { color: theme.colors.text.primary, fontSize: 16, fontWeight: '700' },
  description: { marginTop: 5, color: theme.colors.text.tertiary, fontSize: 12, lineHeight: 18 },
  card: {
    marginTop: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface.default, borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  label: { marginTop: theme.spacing.md, color: theme.colors.text.primary, fontSize: 12, fontWeight: '600' },
  row: { marginTop: theme.spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: {
    minHeight: 32, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center',
    borderRadius: theme.radius.round, backgroundColor: theme.colors.background.app,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light,
  },
  chipSelected: { backgroundColor: theme.colors.brand.primary, borderColor: theme.colors.brand.primary },
  chipText: { color: theme.colors.text.secondary, fontSize: 10 },
  chipTextSelected: { color: theme.colors.brand.onPrimary, fontWeight: '600' },
  input: {
    minHeight: 88, marginTop: theme.spacing.sm, padding: theme.spacing.md,
    color: theme.colors.text.primary, textAlignVertical: 'top', borderRadius: theme.radius.md,
    backgroundColor: theme.colors.background.app, borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  toggleRow: { marginTop: theme.spacing.md, flexDirection: 'row', alignItems: 'center' },
  toggleCopy: { flex: 1, marginRight: theme.spacing.md },
  toggleTitle: { color: theme.colors.text.primary, fontSize: 12, fontWeight: '600' },
  toggleText: { marginTop: 3, color: theme.colors.text.tertiary, fontSize: 10, lineHeight: 15 },
  previewButton: {
    marginTop: theme.spacing.md, minHeight: 42, alignItems: 'center', justifyContent: 'center',
    borderRadius: theme.radius.md, backgroundColor: theme.colors.brand.primary,
  },
  previewButtonDisabled: { opacity: 0.5 },
  previewButtonText: { color: theme.colors.brand.onPrimary, fontSize: 13, fontWeight: '700' },
  privacy: { color: theme.colors.feedback.warning, fontSize: 11, lineHeight: 17 },
  metricRow: { marginTop: theme.spacing.sm, flexDirection: 'row', gap: theme.spacing.sm },
  metric: { flex: 1, padding: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.background.app },
  metricValue: { color: theme.colors.text.primary, fontSize: 15, fontWeight: '700' },
  metricLabel: { marginTop: 2, color: theme.colors.text.tertiary, fontSize: 9 },
  meta: { marginTop: 5, color: theme.colors.text.secondary, fontSize: 11, lineHeight: 17 },
  block: { marginTop: theme.spacing.sm, padding: theme.spacing.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.background.app },
  blockTitle: { color: theme.colors.text.primary, fontSize: 12, fontWeight: '600' },
  blockMeta: { marginTop: 3, color: theme.colors.text.tertiary, fontSize: 9 },
  blockBody: { marginTop: 6, color: theme.colors.text.secondary, fontSize: 10, lineHeight: 16 },
  codeBox: { marginTop: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radius.md, backgroundColor: theme.colors.background.app },
  code: { color: theme.colors.text.secondary, fontSize: 10, lineHeight: 16 },
  empty: { marginTop: theme.spacing.lg, color: theme.colors.text.tertiary, fontSize: 12, textAlign: 'center' },
});
