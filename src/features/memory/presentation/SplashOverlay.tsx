/** 开屏动效：光点爆发 + 标题浮现 + 淡出。 */
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { getThemeById } from '@shared/theme';
import Animated, {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated';

interface Props {
  active: boolean;
  onFinish(): void;
}

export default function SplashOverlay({ active, onFinish }: Props) {
  const reducedMotion = useReducedMotion();
  const coreScale = useSharedValue(1);
  const coreOpacity = useSharedValue(1);
  const titleOpacity = useSharedValue(0);
  const titleTranslateY = useSharedValue(16);
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    if (!active) return;
    if (reducedMotion) { onFinish(); return; }
    coreScale.value = 1;
    coreOpacity.value = 1;
    titleOpacity.value = 0;
    titleTranslateY.value = 16;
    overlayOpacity.value = 1;
    // 开屏光点限制尺寸，避免放大带阴影的图层覆盖整个屏幕。
    coreScale.value = withSequence(
      withTiming(2, { duration: 400, easing: Easing.out(Easing.cubic) }),
      withTiming(24, { duration: 800, easing: Easing.out(Easing.cubic) }),
      withTiming(40, { duration: 400, easing: Easing.in(Easing.cubic) })
    );
    coreOpacity.value = withSequence(
      withTiming(1, { duration: 400 }),
      withTiming(0.6, { duration: 800 }),
      withTiming(0, { duration: 400 })
    );

    // 标题
    titleOpacity.value = withSequence(
      withDelay(600, withTiming(1, { duration: 500 })),
      withDelay(800, withTiming(0, { duration: 500 }))
    );
    titleTranslateY.value = withSequence(
      withDelay(600, withTiming(0, { duration: 500 })),
      withDelay(800, withTiming(-20, { duration: 500 }))
    );

    // 整体淡出
    overlayOpacity.value = withDelay(2200, withTiming(0, { duration: 600 }, finished => {
      if (finished) runOnJS(onFinish)();
    }));
    return () => {
      cancelAnimation(coreScale);
      cancelAnimation(coreOpacity);
      cancelAnimation(titleOpacity);
      cancelAnimation(titleTranslateY);
      cancelAnimation(overlayOpacity);
    };
  }, [active, reducedMotion, onFinish, coreScale, coreOpacity, titleOpacity, titleTranslateY, overlayOpacity]);

  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: coreScale.value }],
    opacity: coreOpacity.value,
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslateY.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  return (
    <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="none">
      <Animated.View style={[styles.core, coreStyle]} />
      <Animated.Text style={[styles.title, titleStyle]}>记忆星空</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: getThemeById('default-dark').colors.background.app,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  core: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: getThemeById('default-dark').colors.text.primary,
  },
  title: {
    position: 'absolute',
    fontSize: 26,
    fontWeight: '300',
    letterSpacing: 12,
    color: getThemeById('default-dark').colors.text.primary,
  },
});
