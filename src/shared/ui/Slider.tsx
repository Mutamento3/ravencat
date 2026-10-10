/** 原生手势滑杆：调用方持有当前值和保存节奏，组件只负责把手势量化为数值。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useThemedStyles, type PresentationTheme } from '@shared/theme';

export interface SliderProps {
  value: number | null;
  min: number;
  max: number;
  step: number;
  onValueChange(value: number): void;
  /** 松手或已激活的手势中断时通知最终值，不在组件内执行持久化。 */
  onSlidingComplete?: (value: number) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  touchArea: { height: 44, justifyContent: 'center', marginHorizontal: 12 },
  track: { height: 4, borderRadius: 2, backgroundColor: theme.colors.border.light, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: theme.colors.brand.primary },
  thumb: { position: 'absolute', top: 10, width: 24, height: 24, borderRadius: 12, marginLeft: -12, backgroundColor: theme.colors.brand.primary },
  disabled: { opacity: 0.45 },
});

export default function Slider({ value, min, max, step, onValueChange, onSlidingComplete,
  accessibilityLabel, disabled = false, style,
}: SliderProps) {
  const styles = useThemedStyles(createStyles);
  const [trackWidth, setTrackWidth] = useState(0);
  const lastValue = useRef(value ?? min);
  useEffect(() => { lastValue.current = value ?? min; }, [value, min]);

  const quantize = useCallback((next: number) => {
    // 去掉步长计算产生的浮点尾数，避免 0.1 的倍数显示成 0.30000000000000004。
    const snapped = Number((min + Math.round((next - min) / step) * step).toPrecision(12));
    return Math.max(min, Math.min(max, snapped));
  }, [min, max, step]);
  const update = useCallback((next: number) => {
    lastValue.current = next;
    onValueChange(next);
    return next;
  }, [onValueChange]);
  const move = useCallback((x: number) => {
    const position = Math.max(0, Math.min(1, x / trackWidth));
    return update(quantize(min + position * (max - min)));
  }, [trackWidth, min, max, quantize, update]);
  // 原生层从按下就接管轨道；只在布局就绪后启用，避免首次测量前参与手势。
  // 松手采样终点；系统中断保留最后有效值，不回退到调整前的数值。
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled && trackWidth > 0)
    .minDistance(0)
    .runOnJS(true)
    .onStart((event) => { move(event.x); })
    .onUpdate((event) => { move(event.x); })
    .onEnd((event, success) => {
      const finalValue = success ? move(event.x) : lastValue.current;
      onSlidingComplete?.(finalValue);
    }), [disabled, trackWidth, move, onSlidingComplete]);
  const percentage = value === null ? null : (value - min) / (max - min) * 100;

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[styles.touchArea, disabled && styles.disabled, style]}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={value === null ? { min, max, text: '未设置' } : { min, max, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityState={{ disabled }}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          const next = update(quantize(lastValue.current + (event.nativeEvent.actionName === 'increment' ? step : -step)));
          onSlidingComplete?.(next);
        }}
      >
        <View pointerEvents="none" style={styles.track}>
          {value !== null && <View style={[styles.fill, { width: `${percentage}%` }]} />}
        </View>
        {value !== null && <View pointerEvents="none" style={[styles.thumb, { left: `${percentage}%` }]} />}
      </View>
    </GestureDetector>
  );
}
