import type { PresentationTheme } from '../types';

/**
 * Moon Kimi theme — old-style Kimi chat UI.
 * - Pure white canvas, content-first layout.
 * - User messages use the classic Fengdu blue bubble.
 * - AI messages are rendered as flat text on the white background (no bubble, no avatar).
 */
export const moonKimiTheme: PresentationTheme = {
  id: 'moon-kimi',
  name: 'Moon Kimi',
  mode: 'light',
  colors: {
    brand: {
      primary: '#3A9BEF',
      primaryPressed: '#2E8AD9',
      onPrimary: '#FFFFFF',
    },
    background: {
      app: '#FFFFFF',
      screen: '#FFFFFF',
      elevated: '#FFFFFF',
    },
    surface: {
      default: '#FFFFFF',
      muted: '#F5F5F5',
      raised: '#FFFFFF',
      input: '#F5F5F5',
      overlay: 'rgba(0, 0, 0, 0.4)',
    },
    text: {
      primary: '#1A1A1A',
      secondary: '#666666',
      tertiary: '#999999',
      inverse: '#FFFFFF',
      link: '#3A9BEF',
    },
    border: {
      default: '#E5E5E5',
      light: '#F5F5F5',
      strong: '#666666',
    },
    feedback: {
      success: '#34C759',
      warning: '#FF9500',
      error: '#FF3B30',
    },
    chat: {
      screen: '#FFFFFF',
      bubbleUser: '#3A9BEF',
      // AI messages are intentionally frameless in Moon Kimi; the bubble
      // renderer checks theme.id and ignores this color for the ai variant.
      bubbleAI: 'transparent',
      bubbleSystem: '#F5F5F5',
      inputBar: '#FFFFFF',
      input: '#F5F5F5',
      quote: '#F5F5F5',
      timePill: '#E5E5E5',
      userText: '#FFFFFF',
      aiText: '#1A1A1A',
    },
    icon: {
      primary: '#1A1A1A',
      secondary: '#666666',
      disabled: '#999999',
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
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    md: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 2,
    },
  },
  effects: {
    glass: {
      enabled: false,
      blurRadius: 0,
      cornerRadius: 0,
      refractionHeight: 0,
      refractionOffset: 0,
      dispersion: 0,
      tintColor: '#FFFFFF',
      tintAlpha: 0,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    overlay: {
      dim: 'rgba(0, 0, 0, 0.4)',
      strong: 'rgba(0, 0, 0, 0.6)',
      toast: 'rgba(0, 0, 0, 0.8)',
    },
  },
  components: {
    toggle: {
      trackOff: '#D1D1D6',
      borderOff: '#B8B8BF',
      thumb: '#FFFFFF',
    },
    button: {
      height: {
        sm: 32,
        md: 44,
        lg: 56,
      },
      radius: 8,
    },
    modalSheet: {
      backgroundColor: '#FFFFFF',
      radius: 16,
      maxHeight: '80%',
    },
    navigation: {
      backgroundColor: '#FFFFFF',
      borderColor: '#E5E5E5',
      iconColor: '#1A1A1A',
      titleColor: '#1A1A1A',
    },
    tabBar: {
      backgroundColor: '#FFFFFF',
      borderColor: '#E5E5E5',
      activeColor: '#3A9BEF',
      inactiveColor: '#666666',
    },
    notification: {
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderRadius: 16,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 4,
    },
  },
};
