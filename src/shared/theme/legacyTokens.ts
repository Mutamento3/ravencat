import type { PresentationTheme } from './types';

/**
 * Derives legacy COLORS object from a PresentationTheme.
 * Preserves backward compatibility for old static imports.
 */
export function legacyColorsFromTheme(theme: PresentationTheme) {
  return {
    fengdu: theme.colors.brand.primary,
    fengduBlue: theme.colors.brand.primary,
    bgWhite: theme.colors.background.app,
    bgGray: theme.colors.background.screen,
    bgDark: theme.colors.text.primary,
    textPrimary: theme.colors.text.primary,
    textSecondary: theme.colors.text.secondary,
    textTertiary: theme.colors.text.tertiary,
    border: theme.colors.border.default,
    borderLight: theme.colors.border.light,
    bordergray: theme.colors.border.strong,
    bubbleUser: theme.colors.chat.bubbleUser,
    bubbleAI: theme.colors.chat.bubbleAI,
    bubbleGray: theme.colors.chat.bubbleSystem,
    success: theme.colors.feedback.success,
    warning: theme.colors.feedback.warning,
    error: theme.colors.feedback.error,
    overlay: theme.colors.surface.overlay,
  } as const;
}
