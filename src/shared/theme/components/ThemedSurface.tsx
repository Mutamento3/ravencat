import React, { createContext, useContext } from 'react';
import { View } from 'react-native';
import type { ViewProps } from 'react-native';
import { useTheme } from '../useTheme';
import { GlassSurface } from './GlassSurface';
import type { PresentationTheme, ThemeColors } from '../types';

export type SurfaceVariant =
  | 'screen'
  | 'card'
  | 'modal'
  | 'navigation'
  | 'tabBar'
  | 'inputBar'
  | 'toast';

export interface ThemedSurfaceProps extends ViewProps {
  variant?: SurfaceVariant;
  backgroundColor?: string;
  children?: React.ReactNode;
  nativeGlass?: boolean;
  /** 原生材质使用数值圆角，需与调用方的裁剪圆角一致。 */
  cornerRadius?: number;
}

const NATIVE_GLASS_VARIANTS = new Set<SurfaceVariant>([
  'card',
  'modal',
  'navigation',
  'tabBar',
  'inputBar',
  'toast',
]);

const GlassSurfaceContext = createContext(false);

function getBackgroundColor(
  variant: SurfaceVariant,
  colors: ThemeColors
): string {
  switch (variant) {
    case 'screen':
      return colors.background.screen;
    case 'card':
      return colors.surface.default;
    case 'modal':
      return colors.surface.default;
    case 'navigation':
      return colors.background.app;
    case 'tabBar':
      return colors.background.app;
    case 'inputBar':
      return colors.chat.inputBar;
    case 'toast':
      return colors.surface.overlay;
    default:
      return colors.surface.default;
  }
}

function getNativeCornerRadius(
  variant: SurfaceVariant,
  theme: PresentationTheme
): number {
  switch (variant) {
    case 'card':
      return theme.radius.lg;
    case 'inputBar':
      return theme.radius.xl;
    case 'modal':
      return theme.components.modalSheet.radius;
    case 'toast':
      return theme.components.notification.borderRadius;
    case 'navigation':
      return 0;
    case 'tabBar':
      // 底部导航是悬浮长条，原生圆角与 JS 侧 borderRadius 保持一致。
      return theme.effects.glass.cornerRadius;
    default:
      return theme.effects.glass.cornerRadius;
  }
}

/** 主要表面使用玻璃；同一表面内部的卡片只染色，独立弹窗重新拥有自己的材质。 */
export const ThemedSurface: React.FC<ThemedSurfaceProps> = ({
  variant = 'card',
  backgroundColor: overrideBackgroundColor,
  children,
  nativeGlass = true,
  cornerRadius,
  style,
  ...rest
}) => {
  const theme = useTheme();
  const insideGlassSurface = useContext(GlassSurfaceContext);
  const backgroundColor = overrideBackgroundColor ?? getBackgroundColor(variant, theme.colors);
  const shouldUseNativeGlass =
    theme.effects.glass.enabled &&
    nativeGlass &&
    (!insideGlassSurface || variant === 'modal') &&
    NATIVE_GLASS_VARIANTS.has(variant);

  if (shouldUseNativeGlass) {
    // 原生玻璃表面统一使用材质底色，避免调用方的普通表面色盖住折射结果。
    return (
      <GlassSurface
        material={{ cornerRadius: cornerRadius ?? getNativeCornerRadius(variant, theme) }}
        style={[style, { backgroundColor: theme.effects.glass.backgroundColor }]}
        {...rest}
      >
        <GlassSurfaceContext.Provider value={true}>
          {children}
        </GlassSurfaceContext.Provider>
      </GlassSurface>
    );
  }

  return (
    <View
      style={[{ backgroundColor }, style]}
      {...rest}
    >
      {children}
    </View>
  );
};
