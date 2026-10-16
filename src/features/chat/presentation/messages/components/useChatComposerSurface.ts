/** 统一管理聊天键盘、表情包与功能面板的互斥状态和占位高度。 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, type KeyboardEvent } from 'react-native';

export type ChatComposerSurface = 'none' | 'keyboard' | 'stickers' | 'tools';

const DEFAULT_COMPOSER_SURFACE_HEIGHT = 300;

export function useChatComposerSurface() {
  const [activeSurface, setActiveSurface] = useState<ChatComposerSurface>('none');
  const [surfaceHeight, setSurfaceHeight] = useState(DEFAULT_COMPOSER_SURFACE_HEIGHT);
  // 避让偏移走 Animated：Did* 事件在键盘动画结束后才到达，直接 setState 会让输入条
  // 悬在半空再瞬间回落（肉眼可见的“闪”）；Will* 事件与键盘动画同帧起跑。
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const activeSurfaceRef = useRef(activeSurface);
  activeSurfaceRef.current = activeSurface;

  useEffect(() => {
    const animateOffset = (toValue: number, event: KeyboardEvent) => {
      Animated.timing(keyboardOffset, {
        toValue,
        duration: event.duration || 250,
        easing: Easing.out(Easing.cubic),
        // marginBottom 是布局属性，不能走原生驱动。
        useNativeDriver: false,
      }).start();
    };

    const willShowSubscription = Keyboard.addListener('keyboardWillShow', (event) => {
      // 焦点可能来自 Android 的自动转移；只有键盘真实拥有避让时才动画偏移。
      if (activeSurfaceRef.current === 'none' || activeSurfaceRef.current === 'keyboard') {
        animateOffset(Math.round(event.endCoordinates.height), event);
      }
    });
    const willHideSubscription = Keyboard.addListener('keyboardWillHide', (event) => {
      if (activeSurfaceRef.current === 'keyboard') {
        animateOffset(0, event);
      }
    });
    // Did* 是事实归宿：Will* 预测漏了（如面板→键盘直切）在这里无条件对齐。
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event: KeyboardEvent) => {
      const nextHeight = Math.round(event.endCoordinates.height);
      setSurfaceHeight(nextHeight);
      const ownsAvoidance = activeSurfaceRef.current === 'none' || activeSurfaceRef.current === 'keyboard';
      if (activeSurfaceRef.current === 'none') setActiveSurface('keyboard');
      keyboardOffset.setValue(ownsAvoidance ? nextHeight : 0);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardOffset.setValue(0);
      if (activeSurfaceRef.current === 'keyboard') setActiveSurface('none');
    });

    return () => {
      Keyboard.dismiss();
      willShowSubscription.remove();
      willHideSubscription.remove();
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardOffset]);

  const dismiss = useCallback(() => {
    Keyboard.dismiss();
    setActiveSurface('none');
  }, []);

  return {
    activeSurface,
    setActiveSurface,
    dismiss,
    keyboardOffset,
    surfaceHeight,
  };
}
