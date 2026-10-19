import type { TextStyle } from 'react-native';

export type PresentationThemeId =
  | 'default-light'
  | 'default-dark'
  | 'liquid-glass'
  | 'moon-kimi'
  | 'paper-note';

export type PresentationThemeMode = 'light' | 'dark';

export interface ThemeColors {
  brand: {
    primary: string;
    primaryPressed: string;
    onPrimary: string;
  };
  background: {
    app: string;
    screen: string;
    elevated: string;
  };
  surface: {
    default: string;
    muted: string;
    raised: string;
    input: string;
    overlay: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string;
    link: string;
  };
  border: {
    default: string;
    light: string;
    strong: string;
  };
  feedback: {
    success: string;
    warning: string;
    error: string;
  };
  chat: {
    screen: string;
    bubbleUser: string;
    bubbleAI: string;
    bubbleSystem: string;
    inputBar: string;
    input: string;
    quote: string;
    timePill: string;
    /** 用户消息正文文字颜色 */
    userText: string;
    /** AI 消息正文文字颜色 */
    aiText: string;
  };
  icon: {
    primary: string;
    secondary: string;
    disabled: string;
    inverse: string;
  };
}

export interface ThemeTypography {
  titleLarge: { fontSize: number; fontWeight: TextStyle['fontWeight'] };
  title: { fontSize: number; fontWeight: TextStyle['fontWeight'] };
  titleSmall: { fontSize: number; fontWeight: TextStyle['fontWeight'] };
  body: { fontSize: number; fontWeight: TextStyle['fontWeight'] };
  bodySmall: { fontSize: number; fontWeight: TextStyle['fontWeight'] };
  caption: { fontSize: number; fontWeight: TextStyle['fontWeight'] };
  label: { fontSize: number; fontWeight: TextStyle['fontWeight'] };
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface ThemeRadius {
  mini: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  round: number;
}

export interface ThemeShadow {
  sm: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
  md: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
}

export interface ThemeGlassMaterial {
  blurRadius: number;
  cornerRadius: number;
  refractionHeight: number;
  refractionOffset: number;
  dispersion: number;
  tintColor: string;
  tintAlpha: number;
}

export interface ThemeEffects {
  glass: ThemeGlassMaterial & {
    enabled: boolean;
    backgroundColor: string;
    borderColor: string;
  };
  overlay: {
    dim: string;
    strong: string;
    toast: string;
  };
}

export interface ThemeComponentTokens {
  /** 开关保持不透明，不能复用玻璃页面的透明背景或边框。 */
  toggle: {
    trackOff: string;
    borderOff: string;
    thumb: string;
  };
  button: {
    height: {
      sm: number;
      md: number;
      lg: number;
    };
    radius: number;
  };
  modalSheet: {
    backgroundColor: string;
    radius: number;
    maxHeight: `${number}%` | number;
  };
  navigation: {
    backgroundColor: string;
    borderColor: string;
    iconColor: string;
    titleColor: string;
  };
  tabBar: {
    backgroundColor: string;
    borderColor: string;
    activeColor: string;
    inactiveColor: string;
  };
  notification: {
    backgroundColor: string;
    borderRadius: number;
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
}

export interface PresentationTheme {
  id: PresentationThemeId;
  name: string;
  mode: PresentationThemeMode;
  colors: ThemeColors;
  typography: ThemeTypography;
  spacing: ThemeSpacing;
  radius: ThemeRadius;
  shadow: ThemeShadow;
  effects: ThemeEffects;
  components: ThemeComponentTokens;
}

/** 用户对聊天文字颜色的自定义覆盖（按主题独立存储）。 */
export interface ChatColorOverrides {
  userText?: string;
  aiText?: string;
}

export type ChatColorToken = keyof ChatColorOverrides;

export interface ThemeContextValue {
  theme: PresentationTheme;
  themeId: PresentationThemeId;
  setThemeId: (themeId: PresentationThemeId) => Promise<void>;
  availableThemes: {
    id: PresentationThemeId;
    name: string;
    mode: PresentationThemeMode;
    disabledReason?: string;
  }[];
  /** 当前主题的聊天文字颜色覆盖层 */
  chatColorOverrides: ChatColorOverrides;
  /** 设置某个聊天文字颜色令牌的覆盖值 */
  setChatColorOverride: (token: ChatColorToken, color: string) => Promise<void>;
  /** 恢复某个聊天文字颜色令牌为主题默认值 */
  resetChatColorOverride: (token: ChatColorToken) => Promise<void>;
  /** 统一调整玻璃材质并保存；数值由设置控件的范围契约保证。 */
  setGlassBlurRadius: (radius: number) => Promise<void>;
}
