/** 绘制不承载业务 children、也不参与触摸命中的原生玻璃效果层。 */
import { requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';
import type { LiquidGlassEffectProps, LiquidGlassMaterial } from './types';

const NativeLiquidGlassEffect =
  requireNativeViewManager<ViewProps & LiquidGlassMaterial & { sceneId: string }>(
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

export function LiquidGlassEffect({
  material,
  sceneId,
  ...viewProps
}: LiquidGlassEffectProps) {
  return (
    <NativeLiquidGlassEffect
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
}
