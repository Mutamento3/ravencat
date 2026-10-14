/** 统一管理聊天键盘、表情包与功能面板的互斥状态和占位高度。 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, type KeyboardEvent } from 'react-native';

export type ChatComposerSurface = 'none' | 'keyboard' | 'stickers' | 'tools';

const DEFAULT_COMPOSER_SURFACE_HEIGHT = 300;

export function useChatComposerSurface() {
  const [activeSurface, setActiveSurface] = useState<ChatComposerSurface>('none');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [surfaceHeight, setSurfaceHeight] = useState(DEFAULT_COMPOSER_SURFACE_HEIGHT);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event: KeyboardEvent) => {
      const nextHeight = Math.round(event.endCoordinates.height);
      setKeyboardHeight(nextHeight);
      setSurfaceHeight(nextHeight);
      setActiveSurface((current) => current === 'none' ? 'keyboard' : current);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      setActiveSurface((current) => current === 'keyboard' ? 'none' : current);
    });

    return () => {
      Keyboard.dismiss();
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const dismiss = useCallback(() => {
    Keyboard.dismiss();
    setActiveSurface('none');
  }, []);

  const keyboardOffset = useMemo(
    // 焦点可能来自 Android 的自动转移；只有真实键盘事件可以拥有避让高度。
    () => activeSurface === 'keyboard' ? keyboardHeight : 0,
    [activeSurface, keyboardHeight],
  );

  return {
    activeSurface,
    setActiveSurface,
    dismiss,
    keyboardOffset,
    surfaceHeight,
  };
}
