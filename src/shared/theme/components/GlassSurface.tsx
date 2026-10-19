import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';
import { LiquidGlassEffect } from '../../../../modules/liquid-glass';
import type { LiquidGlassEffectProps } from '../../../../modules/liquid-glass';
import type { ThemeGlassMaterial } from '../types';
import { useTheme } from '../useTheme';
import { useGlassSceneId } from './GlassScene';

interface GlassSurfaceProps extends ViewProps {
  children?: React.ReactNode;
  material?: Partial<ThemeGlassMaterial>;
  bordered?: boolean;
  /** 原生形状在 UI 线程更新，材质与形状使用同一个采样表面。 */
  animatedProps?: Partial<Pick<LiquidGlassEffectProps, 'fluidShape'>>;
}

const AnimatedGlassEffect = Animated.createAnimatedComponent(LiquidGlassEffect);

/** 低层玻璃表面：原生效果只做背景，React Native children 始终绘制在上层。 */
export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  children,
  material: materialOverride,
  bordered = true,
  animatedProps,
  style,
  ...rest
}) => {
  const theme = useTheme();
  const { glass } = theme.effects;
  const sceneId = useGlassSceneId();
  const material = {
    blurRadius: glass.blurRadius,
    cornerRadius: glass.cornerRadius,
    refractionHeight: glass.refractionHeight,
    refractionOffset: glass.refractionOffset,
    dispersion: glass.dispersion,
    tintColor: glass.tintColor,
    tintAlpha: glass.tintAlpha,
    ...materialOverride,
  };

  return (
    <View
      style={[
        styles.surface,
        { backgroundColor: glass.backgroundColor },
        bordered
          ? {
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: glass.borderColor,
            }
          : null,
        style,
      ]}
      {...rest}
    >
      {animatedProps ? (
        <AnimatedGlassEffect
          animatedProps={animatedProps}
          material={material}
          sceneId={sceneId}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <LiquidGlassEffect
          material={material}
          sceneId={sceneId}
          style={StyleSheet.absoluteFill}
        />
      )}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  surface: {
    overflow: 'hidden',
  },
});
