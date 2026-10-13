/** 材质与受光保持静态，记忆星点复用页面时钟环绕球面并改变亮度。 */
import React, { memo, useId } from 'react';
import { StyleSheet, type ImageSourcePropType, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, FeColorMatrix, Filter, G, Image, Path, RadialGradient, Stop } from 'react-native-svg';
import { getThemeById, useTheme } from '@shared/theme';

/** 素材装配提供已校准的球面取景，渲染层不猜测照片的留白或月相。 */
export interface PlanetTexture {
  source: ImageSourcePropType;
  frame: { x: number; y: number; width: number; height: number };
  rotation: number;
}

function MemoryStar({ index, phase, light, materialId, unit, primary }: {
  index: number; phase: SharedValue<number>; light: string; materialId: string; unit: number; primary: boolean;
}) {
  // 固定的错落位置让新增记忆只增加星星，不洗牌已有星星。
  const angle = (index * 137.508 - 48) * Math.PI / 180;
  const radius = 54 + index % 3 * 3;
  const size = Math.max(5, (6 + index % 3) * unit) * (primary ? 1.5 : 1);
  const twinkle = useAnimatedStyle(() => ({
    opacity: 0.5 + Math.sin(phase.value * Math.PI * 2 + index * 2.1) * 0.14,
  }));
  return <Animated.View style={[{
    position: 'absolute', left: (64 + Math.cos(angle) * radius) * unit - size / 2,
    top: (64 + Math.sin(angle) * radius) * unit - size / 2, width: size, height: size,
  }, twinkle]}>
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Defs>
        <RadialGradient id={`${materialId}-star-${index}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={light} stopOpacity={0.75} />
          <Stop offset="0.18" stopColor={light} stopOpacity={0.4} />
          <Stop offset="0.45" stopColor={light} stopOpacity={0.1} />
          <Stop offset="1" stopColor={light} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={10} cy={10} r={10} fill={`url(#${materialId}-star-${index})`} />
      <Circle cx={10} cy={10} r={1.2} fill={light} />
    </Svg>
  </Animated.View>;
}

function MemoryPlanet({ memoryCount, phase, starOrbit, texture, primary, diameter }: {
  memoryCount: number; phase: SharedValue<number>; starOrbit: SharedValue<number>;
  texture: PlanetTexture; primary: boolean; diameter: number;
}) {
  const theme = useTheme();
  const light = theme.mode === 'dark' ? theme.colors.text.primary : theme.colors.text.inverse;
  const shade = getThemeById('default-dark').colors.background.app;
  const materialId = useId();
  const tint = theme.colors.brand.primary;
  const starCount = Math.max(1, Math.min(10, memoryCount));
  // 球面半径固定为 40，画布留出记忆星点的空间；diameter 表示真实球面尺寸。
  const unit = diameter / 80;
  const canvasSize = 128 * unit;
  // 只旋转星点层，球面和名称保持方向；动画生命周期仍由 MemoryGalaxy 统一拥有。
  const orbitStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ rotate: `${starOrbit.value}deg` }] as const,
  }));

  return <>
    <Svg pointerEvents="none" width={canvasSize} height={canvasSize} viewBox="0 0 128 128">
      <Defs>
        <ClipPath id={`${materialId}-surface`}><Circle cx={64} cy={64} r={40} /></ClipPath>
        <Filter id={materialId} x="0%" y="0%" width="100%" height="100%">
          <FeColorMatrix type="saturate" values={[primary ? 0.58 : 0.4]} />
          <FeColorMatrix type="matrix" values={[
            primary ? 0.95 : 0.76, 0, 0, 0, 0,
            0, primary ? 1 : 0.81, 0, 0, 0,
            0, 0, primary ? 1.06 : 0.92, 0, 0,
            0, 0, 0, 1, 0,
          ]} />
        </Filter>
        <RadialGradient id={`${materialId}-night`} gradientUnits="userSpaceOnUse" cx={42} cy={40} rx={82} ry={82}>
          <Stop offset="0" stopColor={shade} stopOpacity={0} />
          <Stop offset="0.35" stopColor={shade} stopOpacity={0.04} />
          <Stop offset="0.6" stopColor={shade} stopOpacity={0.42} />
          <Stop offset="0.83" stopColor={shade} stopOpacity={0.9} />
          <Stop offset="1" stopColor={shade} stopOpacity={0.98} />
        </RadialGradient>
      </Defs>
      <Circle cx={64} cy={64} r={40} fill={shade} />
      <G clipPath={`url(#${materialId}-surface)`}>
        <Image href={texture.source} {...texture.frame} transform={`rotate(${texture.rotation} 64 64)`} filter={`url(#${materialId})`} />
        <Circle cx={64} cy={64} r={40} fill={`url(#${materialId}-night)`} />
      </G>
      {/* 左上方的窄大气弧与所有球面的受光方向一致，不给整颗球套光圈。 */}
      <Path d="M26 51 A40 40 0 0 1 66 24" fill="none" stroke={tint} strokeWidth={4} strokeOpacity={primary ? 0.07 : 0.035} />
      <Path d="M26 51 A40 40 0 0 1 66 24" fill="none" stroke={light} strokeWidth={0.7} strokeOpacity={primary ? 0.36 : 0.16} strokeLinecap="round" />
    </Svg>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, orbitStyle]}>
      {Array.from({ length: starCount }, (_, index) => <MemoryStar key={index} index={index} phase={phase} light={light} materialId={materialId} unit={unit} primary={primary} />)}
    </Animated.View>
  </>;
}

export default memo(MemoryPlanet);
