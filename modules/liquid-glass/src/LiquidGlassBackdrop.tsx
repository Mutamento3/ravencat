/** 注册一棵只包含可采样背景内容的原生视图树。 */
import { requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';
import type { LiquidGlassBackdropProps } from './types';

const NativeLiquidGlassBackdrop =
  requireNativeViewManager<ViewProps & { sceneId: string }>(
    'LiquidGlass',
    'LiquidGlassBackdropView',
  );

export function LiquidGlassBackdrop({
  children,
  sceneId,
  ...viewProps
}: LiquidGlassBackdropProps) {
  return (
    <NativeLiquidGlassBackdrop
      {...viewProps}
      collapsable={false}
      sceneId={sceneId}
    >
      {children}
    </NativeLiquidGlassBackdrop>
  );
}
