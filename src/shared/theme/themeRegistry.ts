import { defaultLightTheme } from './themes/defaultLight';
import { defaultDarkTheme } from './themes/defaultDark';
import { liquidGlassTheme } from './themes/liquidGlass';
import { moonKimiTheme } from './themes/moonKimi';
import { paperNoteTheme } from './themes/paperNote';
import type { PresentationTheme, PresentationThemeId } from './types';

export const THEME_REGISTRY: Record<PresentationThemeId, PresentationTheme> = {
  'default-light': defaultLightTheme,
  'default-dark': defaultDarkTheme,
  'liquid-glass': liquidGlassTheme,
  'moon-kimi': moonKimiTheme,
  'paper-note': paperNoteTheme,
};

export const DEFAULT_THEME_ID: PresentationThemeId = 'default-light';

// 未完成主题保留实现和备份标识，但不开放给用户选择。
const THEME_SELECTION_DISABLED_REASONS: Partial<Record<PresentationThemeId, string>> = {
  'moon-kimi': '完善中，暂不可用',
};

export function getThemeSelectionDisabledReason(themeId: PresentationThemeId): string | undefined {
  return THEME_SELECTION_DISABLED_REASONS[themeId];
}

export function getThemeById(themeId: PresentationThemeId): PresentationTheme {
  return THEME_REGISTRY[themeId];
}

export function isValidThemeId(themeId: string): themeId is PresentationThemeId {
  return themeId in THEME_REGISTRY;
}

export const AVAILABLE_THEMES = Object.values(THEME_REGISTRY).map((theme) => ({
  id: theme.id,
  name: theme.name,
  mode: theme.mode,
  disabledReason: getThemeSelectionDisabledReason(theme.id),
}));
