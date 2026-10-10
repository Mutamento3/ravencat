/** Sticker 管理弹窗的主题样式。 */

import type { PresentationTheme } from '@shared/theme';

export const createStickerManagementModalStyles = (theme: PresentationTheme) => ({
  overlay: {
    flex: 1,
    justifyContent: 'center' as const,
    padding: 20,
    backgroundColor: theme.effects.overlay.strong,
  },
  card: {
    borderRadius: 14,
    padding: 16,
    backgroundColor: theme.colors.surface.default,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: theme.colors.text.primary,
  },
  input: {
    minHeight: 40,
    marginBottom: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 0.5,
    borderColor: theme.colors.border.default,
    borderRadius: 8,
    color: theme.colors.text.primary,
    backgroundColor: theme.colors.chat.input,
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 64,
    textAlignVertical: 'top' as const,
  },
  sectionLabel: {
    marginBottom: 5,
    fontSize: 12,
    color: theme.colors.text.secondary,
  },
  chipList: {
    gap: 6,
    paddingBottom: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: theme.colors.surface.muted,
  },
  activeChip: {
    backgroundColor: theme.colors.brand.primary,
  },
  chipText: {
    fontSize: 12,
    color: theme.colors.text.secondary,
  },
  activeChipText: {
    color: theme.colors.brand.onPrimary,
  },
  actions: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    gap: 8,
    marginTop: 4,
  },
  secondaryButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: theme.colors.surface.muted,
  },
  secondaryButtonText: {
    color: theme.colors.text.secondary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: theme.colors.surface.muted,
  },
  deleteButtonText: {
    color: theme.colors.feedback.error,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  primaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: theme.colors.brand.primary,
  },
  primaryButtonText: {
    color: theme.colors.brand.onPrimary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  groupList: {
    maxHeight: 150,
    marginBottom: 8,
  },
  groupRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border.light,
  },
  groupSelect: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginRight: 12,
  },
  groupName: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.text.primary,
  },
});
