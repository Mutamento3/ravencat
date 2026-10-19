/** 绘制不承载业务 children、也不参与触摸命中的原生玻璃效果层。 */
import { requireNativeViewManager } from 'expo-modules-core';
import { forwardRef } from 'react';
import type { RefAttributes } from 'react';
import type { View, ViewProps } from 'react-native';
import type { LiquidGlassEffectProps, LiquidGlassMaterial } from './types';

const NativeLiquidGlassEffect =
  requireNativeViewManager<ViewProps & RefAttributes<View> & LiquidGlassMaterial & { sceneId: string; fluidShape?: number[] }>(
    'LiquidGlass',
    'LiquidGlassEffectView',
  );

export const DEFAULT_LIQUID_GLASS_MATERIAL: Readonly<LiquidGlassMaterial> = {
  blurRadius: 12,
  cornerRadius: 32,
  refractionHeight: 22,
  refractionOffset: 68,
  dispersion: 0.55,
  tintColor: '#FFFFFF',
  tintAlpha: 0.16,
};

export const LiquidGlassEffect = forwardRef<View, LiquidGlassEffectProps>(function LiquidGlassEffect({
  material,
  sceneId,
  ...viewProps
}, ref) {
  return (
    <NativeLiquidGlassEffect
      ref={ref}
      {...viewProps}
      {...DEFAULT_LIQUID_GLASS_MATERIAL}
      {...material}
      accessibilityElementsHidden
      collapsable={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      sceneId={sceneId}
    />
  );
});
