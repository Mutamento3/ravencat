/** 开关只展示调用方确认的状态；异步保存或确认弹窗期间不自行翻转业务值。 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useThemedStyles, type PresentationTheme } from '@shared/theme';

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  touchArea: { width: 48, height: 44, justifyContent: 'center', flexShrink: 0 },
  track: {
    width: 48, height: 28, borderRadius: 14,
    backgroundColor: theme.components.toggle.trackOff,
    borderColor: theme.components.toggle.borderOff, borderWidth: 1,
  },
  activeTrack: {
    ...StyleSheet.absoluteFillObject, borderRadius: 14,
    backgroundColor: theme.colors.brand.primary,
  },
  thumb: {
    position: 'absolute', left: 3, top: 3,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme.components.toggle.thumb,
  },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.8 },
});

export default function Toggle({ value, onValueChange, accessibilityLabel, disabled = false, style }: ToggleProps) {
  const styles = useThemedStyles(createStyles);
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    // 位移和轨道淡入由原生动画执行，页面刷新不逐帧占用 JS；旧动画在新值到来时取消。
    const animation = Animated.timing(progress, { toValue: value ? 1 : 0, duration: 160, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, value]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [styles.touchArea, disabled && styles.disabled, pressed && styles.pressed, style]}
    >
      <View pointerEvents="none">
        <View style={styles.track} />
        <Animated.View style={[styles.activeTrack, { opacity: progress }]} />
        <Animated.View style={[styles.thumb, {
          transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }],
        }]} />
      </View>
    </Pressable>
  );
}
