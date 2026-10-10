import { useContext } from 'react';
import { ThemeContext } from './ThemeProvider';
import { defaultLightTheme } from './themes/defaultLight';
import type { PresentationTheme, ThemeContextValue } from './types';

export function useTheme(): PresentationTheme {
  const context = useContext(ThemeContext);
  if (!context) {
    // Fallback for usage outside provider during early initialization
    return defaultLightTheme;
  }
  return context.theme;
}

export function useThemeContext(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error(
      'useThemeContext must be used within a ThemeProvider'
    );
  }
  return context;
}
