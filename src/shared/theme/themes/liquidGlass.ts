import type { PresentationTheme } from '../types';

export const liquidGlassTheme: PresentationTheme = {
  id: 'liquid-glass',
  name: 'Liquid',
  mode: 'light',
  colors: {
    brand: {
      primary: '#3A9BEF',
      primaryPressed: '#2E8AD9',
      onPrimary: '#FFFFFF',
    },
    background: {
      app: 'transparent',
      screen: 'transparent',
      elevated: 'rgba(185, 220, 255, 0.14)',
    },
    surface: {
      // 列表与玻璃内的小控件只用轻量染色，避免白底堆叠和逐项运行模糊。
      default: 'rgba(185, 220, 255, 0.10)',
      muted: 'rgba(69, 112, 156, 0.08)',
      raised: 'rgba(185, 220, 255, 0.16)',
      input: 'rgba(69, 112, 156, 0.06)',
      overlay: 'rgba(0, 0, 0, 0.2)',
    },
    text: {
      primary: '#1C1C1E',
      secondary: '#52677C',
      tertiary: '#64788C',
      inverse: '#FFFFFF',
      link: '#3A9BEF',
    },
    border: {
      default: 'rgba(255, 255, 255, 0.4)',
      light: 'rgba(255, 255, 255, 0.25)',
      strong: 'rgba(255, 255, 255, 0.6)',
    },
    feedback: {
      success: '#34C759',
      warning: '#FF9500',
      error: '#FF3B30',
    },
    chat: {
      screen: 'transparent',
      bubbleUser: 'rgba(31, 127, 216, 0.72)',
      bubbleAI: 'rgba(255, 255, 255, 0.72)',
      bubbleSystem: 'rgba(255, 255, 255, 0.72)',
      inputBar: 'rgba(255, 255, 255, 0.78)',
      // 输入控件位于原生玻璃输入栏之上，不再额外叠加白色伪玻璃底。
      input: 'transparent',
      quote: 'rgba(255, 255, 255, 0.72)',
      timePill: 'rgba(255, 255, 255, 0.62)',
      userText: '#1C1C1E',
      aiText: '#1C1C1E',
    },
    icon: {
      primary: '#1C1C1E',
      secondary: '#52677C',
      disabled: '#64788C',
      inverse: '#FFFFFF',
    },
  },
  typography: {
    titleLarge: { fontSize: 20, fontWeight: '600' },
    title: { fontSize: 17, fontWeight: '600' },
    titleSmall: { fontSize: 15, fontWeight: '600' },
    body: { fontSize: 16, fontWeight: '400' },
    bodySmall: { fontSize: 14, fontWeight: '400' },
    caption: { fontSize: 12, fontWeight: '400' },
    label: { fontSize: 13, fontWeight: '500' },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },
  radius: {
    mini: 2,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    round: 999,
  },
  shadow: {
    sm: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    md: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 4,
    },
  },
  effects: {
    glass: {
      enabled: true,
      blurRadius: 6,
      cornerRadius: 32,
      refractionHeight: 22,
      refractionOffset: 68,
      dispersion: 0.55,
      tintColor: '#FFFFFF',
      tintAlpha: 0,
      backgroundColor: 'transparent',
      borderColor: 'rgba(255, 255, 255, 0.5)',
    },
    overlay: {
      dim: 'rgba(0, 0, 0, 0.2)',
      strong: 'rgba(0, 0, 0, 0.4)',
      toast: 'rgba(0, 0, 0, 0.65)',
    },
  },
  components: {
    toggle: {
      trackOff: '#B7C7D6',
      borderOff: '#879EB3',
      thumb: '#FFFFFF',
    },
    button: {
      height: {
        sm: 32,
        md: 44,
        lg: 56,
      },
      radius: 12,
    },
    modalSheet: {
      backgroundColor: 'rgba(255, 255, 255, 0.75)',
      radius: 24,
      maxHeight: '80%',
    },
    navigation: {
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      borderColor: 'rgba(255, 255, 255, 0.45)',
      iconColor: '#1C1C1E',
      titleColor: '#1C1C1E',
    },
    tabBar: {
      backgroundColor: 'rgba(255, 255, 255, 0.6)',
      borderColor: 'rgba(255, 255, 255, 0.4)',
      activeColor: '#3A9BEF',
      inactiveColor: '#8E8E93',
    },
    notification: {
      backgroundColor: 'rgba(255, 255, 255, 0.6)',
      borderRadius: 24,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 24,
      elevation: 4,
    },
  },
};
