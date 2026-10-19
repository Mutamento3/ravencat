import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import { ThemedSurface, useTheme, type PresentationTheme } from '@shared/theme';

interface ChatVoiceRecordingFeedbackProps {
  /** 实际录音电平 0–1；preparing 阶段还没有音频，忽略此值。 */
  level: number;
  isPreparing: boolean;
  isCancelling: boolean;
  isProcessing: boolean;
}

const BAR_HEIGHTS = [0.35, 0.55, 0.75, 0.9, 1, 0.9, 0.75, 0.55, 0.35];
/** 静音也要有可见高度：0 会让波形看起来根本没渲染。 */
const MIN_BAR_SCALE = 0.18;
/** 准备阶段复用同一个驱动值，用不同峰值位置造出依次起伏的波。 */
const PULSE_PHASE_BASE = 0.2;
const PULSE_PHASE_STEP = 0.085;
const CARD_CORNER_RADIUS = 32;

/** 只投影录音状态，不接管输入条的手势或麦克风生命周期。 */
export function ChatVoiceRecordingFeedback({
  level,
  isPreparing,
  isCancelling,
  isProcessing,
}: ChatVoiceRecordingFeedbackProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const enter = useRef(new Animated.Value(0)).current;
  const levelValue = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  // 卡片随按键立即挂载，入场动画只做视觉过渡，不参与任何状态判定。
  useEffect(() => {
    const animation = Animated.spring(enter, {
      toValue: 1,
      speed: 20,
      bounciness: 4,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [enter]);

  // 真实电平只在有音频时更新；preparing 由独立呼吸动画接管，避免两条动画抢同一节点。
  useEffect(() => {
    if (isPreparing) return;
    const animation = Animated.timing(levelValue, {
      toValue: level,
      duration: 140,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [isPreparing, level, levelValue]);

  useEffect(() => {
    if (!isPreparing) return;
    pulse.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 520, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isPreparing, pulse]);

  const barScaleY = (index: number) => {
    if (isPreparing) {
      return pulse.interpolate({
        inputRange: [0, PULSE_PHASE_BASE + index * PULSE_PHASE_STEP, 1],
        outputRange: [MIN_BAR_SCALE, MIN_BAR_SCALE + BAR_HEIGHTS[index] * 0.82, MIN_BAR_SCALE],
      });
    }
    return levelValue.interpolate({
      inputRange: [0, 1],
      // 取消态压低波形：颜色之外再给一个“要丢弃”的形状信号。
      outputRange: [MIN_BAR_SCALE, isCancelling ? Math.min(BAR_HEIGHTS[index], 0.3) : BAR_HEIGHTS[index]],
    });
  };

  const accent = isCancelling ? theme.colors.feedback.error : theme.colors.brand.primary;

  return (
    <View pointerEvents="none" style={styles.anchor}>
      <Animated.View
        style={{
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
            { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        }}
      >
        <ThemedSurface
          nativeGlass
          variant="card"
          cornerRadius={CARD_CORNER_RADIUS}
          backgroundColor={theme.colors.background.elevated}
          style={styles.card}
        >
          <View style={styles.waveform} importantForAccessibility="no-hide-descendants">
            {isProcessing ? (
              <ActivityIndicator color={theme.colors.brand.primary} />
            ) : (
              BAR_HEIGHTS.map((_, index) => (
                <Animated.View
                  key={index}
                  style={[styles.bar, { backgroundColor: accent, transform: [{ scaleY: barScaleY(index) }] }]}
                />
              ))
            )}
          </View>
        </ThemedSurface>
      </Animated.View>
    </View>
  );
}

function createStyles(theme: PresentationTheme) {
  const usesNativeGlass = theme.effects.glass.enabled;
  return StyleSheet.create({
    anchor: {
      position: 'absolute',
      bottom: '100%',
      left: 0,
      right: 0,
      marginBottom: 14,
      alignItems: 'center',
    },
    card: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: CARD_CORNER_RADIUS,
      // 玻璃自带描边与折射；普通主题靠抬升背景和阴影表达悬浮。
      ...(usesNativeGlass ? {} : theme.shadow.md),
    },
    // 波形固定最小宽度：识别中换成 indicator 时卡片不得收缩跳动。
    waveform: {
      height: 40,
      minWidth: 96,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    bar: { width: 4, height: 36, borderRadius: 2 },
  });
}
