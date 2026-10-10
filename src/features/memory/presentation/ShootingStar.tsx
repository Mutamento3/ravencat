/** 流星：沿线条方向飞行，亮度先增后减。 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

interface Props {
  width: number;
  height: number;
  onDone(): void;
}

export default function ShootingStar({ width, height, onDone }: Props) {
  const [config] = useState(() => {
    const startX = Math.random() * width * 0.6;
    const startY = Math.random() * height * 0.4;
    const angle = Math.random() * 25 + 25; // 25-50度
    const length = 80 + Math.random() * 100;
    const distance = 250 + Math.random() * 200;
    const rad = (angle * Math.PI) / 180;
    const endX = startX + Math.cos(rad) * distance;
    const endY = startY + Math.sin(rad) * distance;
    const duration = 900 + Math.random() * 500;
    return { startX, startY, angle, length, endX, endY, duration };
  });

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: config.duration, easing: Easing.linear }, finished => {
      if (finished) runOnJS(onDone)();
    });
    return () => cancelAnimation(progress);
  }, [config.duration, onDone, progress]);

  const style = useAnimatedStyle<ViewStyle>(() => {
    const t = progress.value;
    const ease = 1 - Math.pow(1 - t, 3);
    const x = config.startX + (config.endX - config.startX) * ease;
    const y = config.startY + (config.endY - config.startY) * ease;
    const opacity = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
    return {
      opacity: opacity * 0.8,
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${config.angle}deg` }] as const,
    };
  });

  return (
    <Animated.View
      style={[
        styles.star,
        { width: config.length },
        style,
      ]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  star: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 1.5,
    backgroundColor: 'rgba(230,240,255,0.8)',
    borderRadius: 1,
  },
});
