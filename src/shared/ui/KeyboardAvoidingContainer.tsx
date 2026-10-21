/** 同一个原生窗口内只由一处容器负责避让；输入控件不移动页面。 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, View, type LayoutChangeEvent, type ViewProps } from 'react-native';

export interface KeyboardAvoidingContainerProps extends ViewProps {
  enabled?: boolean;
  keyboardVerticalOffset?: number;
}

export default function KeyboardAvoidingContainer({
  enabled = true,
  keyboardVerticalOffset = 0,
  style,
  onLayout,
  ...props
}: KeyboardAvoidingContainerProps) {
  const viewRef = useRef<View>(null);
  const keyboardFrameRef = useRef(Keyboard.metrics());
  const measurementState = useRef({ revision: 0 }).current;
  const [bottom, setBottom] = useState(0);

  const updateOverlap = useCallback(() => {
    const revision = ++measurementState.revision;
    const keyboard = keyboardFrameRef.current;
    if (!enabled || !keyboard) {
      setBottom(0);
      return;
    }
    // 键盘提供屏幕坐标；不能拿 onLayout 的父容器局部 y 与之相减。
    // 原生窗口可能已缩小，只补实际重叠量，避免再加一整份键盘高度。
    viewRef.current!.measureInWindow((_x, y, _width, height) => {
      if (revision !== measurementState.revision) return;
      setBottom(Math.max(0, y + height - keyboard.screenY + keyboardVerticalOffset));
    });
  }, [enabled, keyboardVerticalOffset, measurementState]);

  useEffect(() => {
    keyboardFrameRef.current = Keyboard.metrics();
    updateOverlap();
    if (!enabled) return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardFrameRef.current = event.endCoordinates;
      updateOverlap();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardFrameRef.current = undefined;
      updateOverlap();
    });
    return () => {
      // 原生测量可能晚于隐藏、窗口切换或卸载返回，旧结果不能恢复已清除的留白。
      measurementState.revision++;
      show.remove();
      hide.remove();
    };
  }, [enabled, updateOverlap, measurementState]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    updateOverlap();
    onLayout?.(event);
  }, [onLayout, updateOverlap]);

  return <View {...props} ref={viewRef} collapsable={false} onLayout={handleLayout}
    style={StyleSheet.compose(style, { paddingBottom: enabled ? bottom : 0 })} />;
}
