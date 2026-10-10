/** 星空只拥有视觉坐标与交互；空间事实和导航由上层提供。 */
import React, { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue,
  withRepeat, withSequence, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme, useThemedStyles } from '@shared/theme';
import type { MemorySpaceDescriptor } from '../domain/Memory';
import { createMemoryGalaxyStyles } from './memoryGalaxyStyles';
import { NEAR_STAR_LAYERS, type GalaxyStar } from './galaxyStarField';

const SPACES_PER_PAGE = 6;
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.8;

function BackgroundStar({ star, width, height, touchX, touchY, pulse, color }: {
  star: GalaxyStar; width: number; height: number; color: string;
  touchX: SharedValue<number>; touchY: SharedValue<number>; pulse: SharedValue<number>;
}) {
  const animated = useAnimatedStyle<ViewStyle>(() => {
    let x = 0, y = 0;
    // 避让只在轻触脉冲期间计算，日常闪烁不计算距离。
    if (pulse.value > 0) {
      const dx = star.x * width - touchX.value;
      const dy = star.y * height - touchY.value;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < 150) {
        const force = (1 - distance / 150) ** 2 * 35 * pulse.value;
        x = dx / distance * force;
        y = dy / distance * force;
      }
    }
    return {
      transform: [{ translateX: x }, { translateY: y }] as const,
    };
  });
  return <Animated.View style={[
    { position: 'absolute', left: star.x * width, top: star.y * height, width: star.size, height: star.size, borderRadius: star.size / 2, backgroundColor: color, opacity: 0.4 + star.brightness * 0.6 }, animated,
  ]} />;
}

function StarLayer({ stars, layer, width, height, phase, touchX, touchY, pulse, color }: {
  stars: GalaxyStar[]; layer: number; width: number; height: number; color: string;
  phase: SharedValue<number>; touchX: SharedValue<number>; touchY: SharedValue<number>; pulse: SharedValue<number>;
}) {
  // 闪烁只更新三个层的透明度，28 个星点仅在触摸期间更新位置。
  const twinkle = useAnimatedStyle(() => ({ opacity: 0.5 + Math.sin(phase.value * Math.PI * 2 + layer * 2.4) * 0.25 }));
  return <Animated.View style={[StyleSheet.absoluteFill, twinkle]}>
    {stars.map((star, i) => <BackgroundStar key={i} star={star} width={width} height={height} color={color} touchX={touchX} touchY={touchY} pulse={pulse} />)}
  </Animated.View>;
}

function SpaceStar({ space, index, count, width, height, rotation, phase, onSelect, disabled }: {
  space: MemorySpaceDescriptor; index: number; count: number; width: number; height: number;
  rotation: SharedValue<number>; phase: SharedValue<number>; onSelect(assistantId: string): void; disabled: boolean;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createMemoryGalaxyStyles);
  const starlight = theme.mode === 'dark' ? theme.colors.text.primary : theme.colors.text.inverse;
  const position = useAnimatedStyle<ViewStyle>(() => {
    const angle = index / count * Math.PI * 2 - Math.PI / 2 + rotation.value * Math.PI / 180;
    // 轨道直接定义在视口内，文字保持正向，不创建巨型世界或反向旋转层。
    const x = count === 1 ? 0 : Math.cos(angle) * Math.max(0, width / 2 - 70);
    const y = count === 1 ? 0 : Math.sin(angle) * Math.max(0, height / 2 - 90);
    return { transform: [{ translateX: x }, { translateY: y }] as const };
  });
  const glow = useAnimatedStyle(() => ({ opacity: 0.7 + Math.sin(phase.value * Math.PI * 2 + index) * 0.2 }));
  const orbit = useAnimatedStyle<ViewStyle>(() => ({ transform: [{ rotate: `${phase.value * 360}deg` }] as const }));

  return <Animated.View style={[styles.spaceStar, { left: width / 2 - 56, top: height / 2 - 44 }, position]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`打开${space.assistantName}的记忆空间`} disabled={disabled} onPress={() => onSelect(space.assistantId)} style={({ pressed }) => [styles.spaceButton, pressed && styles.pressedStar]}>
      <View style={styles.starBody}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glow]}>
          <Svg width={88} height={88} viewBox="0 0 88 88">
            <Defs>
              <RadialGradient id={`glow-${space.poolId}`} gradientUnits="userSpaceOnUse" cx={44} cy={44} rx={44} ry={44}>
                <Stop offset="0" stopColor={theme.colors.brand.primary} stopOpacity={0.5} />
                <Stop offset="1" stopColor={theme.colors.brand.primary} stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id={`core-${space.poolId}`} gradientUnits="userSpaceOnUse" cx={37} cy={37} rx={34} ry={34}>
                <Stop offset="0" stopColor={starlight} />
                <Stop offset="1" stopColor={theme.colors.brand.primary} />
              </RadialGradient>
            </Defs>
            <Circle cx={44} cy={44} r={44} fill={`url(#glow-${space.poolId})`} />
            <Circle cx={44} cy={44} r={35} fill="none" stroke={starlight} strokeOpacity={0.16} />
            <Circle cx={44} cy={44} r={41} fill="none" stroke={starlight} strokeOpacity={0.08} />
            <Circle cx={44} cy={44} r={22} fill={`url(#core-${space.poolId})`} />
          </Svg>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, orbit]}>
          <Svg width={88} height={88}><Circle cx={44} cy={9} r={1.5} fill={starlight} /><Circle cx={79} cy={44} r={2} fill={starlight} /></Svg>
        </Animated.View>
        <Text style={styles.starShort}>{space.assistantName.slice(0, 1)}</Text>
      </View>
      <Text style={styles.starName} numberOfLines={1}>{space.assistantName}</Text>
      {space.isHost && <Text style={styles.starCount}>主理空间</Text>}
    </Pressable>
  </Animated.View>;
}

function MemoryGalaxy({ spaces, paused, disabled, onSelect }: {
  spaces: MemorySpaceDescriptor[]; paused: boolean; disabled: boolean; onSelect(assistantId: string): void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createMemoryGalaxyStyles);
  const starlight = theme.mode === 'dark' ? theme.colors.text.primary : theme.colors.text.inverse;
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(spaces.length / SPACES_PER_PAGE);
  const currentPage = Math.min(page, pageCount - 1);
  const visibleSpaces = useMemo(() => spaces.slice(currentPage * SPACES_PER_PAGE, (currentPage + 1) * SPACES_PER_PAGE), [spaces, currentPage]);
  const reducedMotion = useReducedMotion();
  const phase = useSharedValue(0);
  const rotation = useSharedValue(0);
  const pulse = useSharedValue(0);
  const touchX = useSharedValue(-1000);
  const touchY = useSharedValue(-1000);
  const scale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const pinchStartX = useSharedValue(0);
  const pinchStartY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const active = !paused && !reducedMotion;

  const reset = () => { scale.value = 1; offsetX.value = 0; offsetY.value = 0; };
  useEffect(() => {
    scale.value = 1;
    offsetX.value = 0;
    offsetY.value = 0;
  }, [viewport.width, viewport.height, currentPage, scale, offsetX, offsetY]);

  useEffect(() => {
    if (active) {
      phase.value = withRepeat(withTiming(phase.value + 1, { duration: 12000, easing: Easing.linear }), -1);
      rotation.value = withRepeat(withTiming(rotation.value + 360, { duration: 180000, easing: Easing.linear }), -1);
    }
    return () => {
      cancelAnimation(phase);
      cancelAnimation(rotation);
      cancelAnimation(pulse);
      pulse.value = 0;
    };
  }, [active, phase, rotation, pulse]);

  const pan = Gesture.Pan().enabled(!paused && !disabled).maxPointers(1).minDistance(8)
    .onStart(() => { panStartX.value = offsetX.value; panStartY.value = offsetY.value; })
    .onUpdate(e => {
      offsetX.value = Math.max(-viewport.width * 0.6, Math.min(viewport.width * 0.6, panStartX.value + e.translationX));
      offsetY.value = Math.max(-viewport.height * 0.6, Math.min(viewport.height * 0.6, panStartY.value + e.translationY));
    });
  const pinch = Gesture.Pinch().enabled(!paused && !disabled)
    .onStart(e => {
      pinchStartScale.value = scale.value;
      pinchStartX.value = offsetX.value;
      pinchStartY.value = offsetY.value;
      focalX.value = e.focalX - viewport.width / 2;
      focalY.value = e.focalY - viewport.height / 2;
    })
    .onUpdate(e => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScale.value * e.scale));
      const ratio = next / pinchStartScale.value;
      offsetX.value = Math.max(-viewport.width * 0.6, Math.min(viewport.width * 0.6, e.focalX - viewport.width / 2 - (focalX.value - pinchStartX.value) * ratio));
      offsetY.value = Math.max(-viewport.height * 0.6, Math.min(viewport.height * 0.6, e.focalY - viewport.height / 2 - (focalY.value - pinchStartY.value) * ratio));
      scale.value = next;
    });
  const worldTransform = useAnimatedStyle<ViewStyle>(() => ({ transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }, { scale: scale.value }] as const }));

  return <View style={styles.sky}>
    <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
      <View collapsable={false} style={styles.sky} onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} disabled={!active || disabled} onPress={e => {
          touchX.value = e.nativeEvent.locationX;
          touchY.value = e.nativeEvent.locationY;
          pulse.value = withSequence(withTiming(1, { duration: 180 }), withSpring(0, { damping: 12, stiffness: 65 }));
        }} />
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {NEAR_STAR_LAYERS.map((stars, i) => <StarLayer key={i} stars={stars} layer={i} width={viewport.width} height={viewport.height} color={starlight} phase={phase} touchX={touchX} touchY={touchY} pulse={pulse} />)}
        </View>
        <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, worldTransform]}>
          {visibleSpaces.map((space, i) => <SpaceStar key={space.poolId} space={space} index={i} count={visibleSpaces.length} width={viewport.width} height={viewport.height} rotation={rotation} phase={phase} onSelect={onSelect} disabled={disabled || paused} />)}
        </Animated.View>
      </View>
    </GestureDetector>
    <View style={styles.galaxyControls}>
      {pageCount > 1 && <Pressable accessibilityRole="button" accessibilityLabel="上一组记忆空间" disabled={disabled || paused || currentPage === 0} onPress={() => setPage(currentPage - 1)}><Text style={styles.subtitle}>上一组</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="复位记忆星空" disabled={disabled || paused} onPress={reset}><Text style={styles.galaxyHint}>{pageCount > 1 ? `${currentPage + 1} / ${pageCount} · ` : ''}拖动 · 双指缩放 · 点此复位</Text></Pressable>
      {pageCount > 1 && <Pressable accessibilityRole="button" accessibilityLabel="下一组记忆空间" disabled={disabled || paused || currentPage === pageCount - 1} onPress={() => setPage(currentPage + 1)}><Text style={styles.subtitle}>下一组</Text></Pressable>}
    </View>
  </View>;
}

export default memo(MemoryGalaxy);
