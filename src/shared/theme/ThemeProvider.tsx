import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ChatColorOverrides,
  ChatColorToken,
  PresentationTheme,
  PresentationThemeId,
  ThemeContextValue,
} from './types';
import { DEFAULT_THEME_ID, getThemeById, getThemeSelectionDisabledReason, AVAILABLE_THEMES } from './themeRegistry';
import {
  loadChatColorOverrides,
  loadStoredThemeId,
  loadGlassBlurRadius,
  saveChatColorOverrides,
  saveThemeId,
  saveGlassBlurRadius,
} from './themeStorage';
import {
  DEFAULT_CHAT_FOOTER_SETTINGS,
  loadChatFooterSettings,
  saveChatFooterSettings,
  type ChatFooterImageRef,
  type ChatFooterSettings,
} from './chatFooterSettings';

export const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
}

/** 将覆盖层合并到主题的 chat 颜色上，返回新的主题对象。 */
function applyChatColorOverrides(
  base: PresentationTheme,
  overrides: ChatColorOverrides
): PresentationTheme {
  if (!overrides.userText && !overrides.aiText) {
    return base;
  }
  return {
    ...base,
    colors: {
      ...base.colors,
      chat: {
        ...base.colors.chat,
        userText: overrides.userText ?? base.colors.chat.userText,
        aiText: overrides.aiText ?? base.colors.chat.aiText,
      },
    },
  };
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [themeId, setThemeIdState] = useState<PresentationThemeId>(DEFAULT_THEME_ID);
  const [baseTheme, setBaseTheme] = useState<PresentationTheme>(getThemeById(DEFAULT_THEME_ID));
  const [chatColorOverrides, setChatColorOverridesState] = useState<ChatColorOverrides>({});
  const [glassBlurRadius, setGlassBlurRadiusState] = useState<number>();
  const [chatFooter, setChatFooterState] = useState<ChatFooterSettings>(DEFAULT_CHAT_FOOTER_SETTINGS);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      const [storedId, storedBlurRadius, storedChatFooter] = await Promise.all([
        loadStoredThemeId(), loadGlassBlurRadius(), loadChatFooterSettings(),
      ]);
      const storedOverrides = await loadChatColorOverrides(storedId);
      if (isMounted) {
        setThemeIdState(storedId);
        setBaseTheme(applyChatColorOverrides(getThemeById(storedId), storedOverrides));
        setChatColorOverridesState(storedOverrides);
        setGlassBlurRadiusState(storedBlurRadius);
        setChatFooterState(storedChatFooter);
      }
    };

    void init();

    return () => {
      isMounted = false;
    };
  }, []);

  const setThemeId = useCallback(async (nextId: PresentationThemeId) => {
    const disabledReason = getThemeSelectionDisabledReason(nextId);
    if (disabledReason) {
      throw new Error(disabledReason);
    }
    setThemeIdState(nextId);
    const storedOverrides = await loadChatColorOverrides(nextId);
    setBaseTheme(applyChatColorOverrides(getThemeById(nextId), storedOverrides));
    setChatColorOverridesState(storedOverrides);
    await saveThemeId(nextId);
  }, []);

  const setChatColorOverride = useCallback(
    async (token: ChatColorToken, color: string) => {
      const nextOverrides: ChatColorOverrides = {
        ...chatColorOverrides,
        [token]: color,
      };
      setChatColorOverridesState(nextOverrides);
      setBaseTheme(applyChatColorOverrides(getThemeById(themeId), nextOverrides));
      await saveChatColorOverrides(themeId, nextOverrides);
    },
    [chatColorOverrides, themeId]
  );

  const resetChatColorOverride = useCallback(
    async (token: ChatColorToken) => {
      const nextOverrides: ChatColorOverrides = { ...chatColorOverrides };
      delete nextOverrides[token];
      setChatColorOverridesState(nextOverrides);
      setBaseTheme(applyChatColorOverrides(getThemeById(themeId), nextOverrides));
      await saveChatColorOverrides(themeId, nextOverrides);
    },
    [chatColorOverrides, themeId]
  );

  const setGlassBlurRadius = useCallback(async (radius: number) => {
    setGlassBlurRadiusState(radius);
    await saveGlassBlurRadius(radius);
  }, []);

  const setChatFooterText = useCallback(async (text: string | null) => {
    const next: ChatFooterSettings = {
      ...chatFooter,
      text: text && text.trim() ? text : null,
    };
    setChatFooterState(next);
    await saveChatFooterSettings(next);
  }, [chatFooter]);

  const setChatFooterImage = useCallback(async (image: ChatFooterImageRef | null) => {
    const next: ChatFooterSettings = { ...chatFooter, image };
    setChatFooterState(next);
    await saveChatFooterSettings(next);
  }, [chatFooter]);

  // 模糊覆盖层独立于聊天颜色，切换主题或修改文字颜色不会丢失玻璃偏好。
  const theme = useMemo<PresentationTheme>(() => {
    if (!baseTheme.effects.glass.enabled || glassBlurRadius === undefined) return baseTheme;
    return {
      ...baseTheme,
      effects: {
        ...baseTheme.effects,
        glass: { ...baseTheme.effects.glass, blurRadius: glassBlurRadius },
      },
    };
  }, [baseTheme, glassBlurRadius]);

  const value: ThemeContextValue = {
    theme,
    themeId,
    setThemeId,
    availableThemes: AVAILABLE_THEMES,
    chatColorOverrides,
    setChatColorOverride,
    resetChatColorOverride,
    setGlassBlurRadius,
    chatFooter,
    setChatFooterText,
    setChatFooterImage,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
