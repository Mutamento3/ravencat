/** 同一个原生窗口内只由一处容器负责避让；输入控件不移动页面。 */
import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, type ViewProps } from 'react-native';

export interface KeyboardAvoidingContainerProps extends ViewProps {
  enabled?: boolean;
  keyboardVerticalOffset?: number;
}

export default function KeyboardAvoidingContainer({
  enabled = true,
  keyboardVerticalOffset = 0,
  ...props
}: KeyboardAvoidingContainerProps) {
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    if (!enabled) return;
    setKeyboardVisible(Keyboard.isVisible());
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, [enabled]);

  // 隐藏事件坐标不一定等于窗口底部，禁用避让才能明确清掉残留留白。
  // 不用 height 模式让容器自身的高度再次参与键盘位移计算。
  return <KeyboardAvoidingView {...props} behavior="padding"
    enabled={enabled && keyboardVisible} keyboardVerticalOffset={keyboardVerticalOffset} />;
}
