/** Android 只读文字选择的焦点释放与专用滚动适配。 */
import React, { forwardRef } from 'react';
import { ScrollView, requireNativeComponent, type ScrollViewProps } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

const nativeSelection = requireNativeModule<{ releaseFocus(): Promise<void> }>('NativeTextSelection');
const NativeScrollView = requireNativeComponent<ScrollViewProps>('NativeTextSelectionScrollView');
// 插槽由 postinstall 扩展 RN 实现；此处拥有扩展属性的 TypeScript 契约。
const AdaptedScrollView = ScrollView as unknown as React.ComponentType<ScrollViewProps & {
  nativeScrollViewComponent: typeof NativeScrollView;
  ref?: React.Ref<ScrollView>;
}>;

export const TextSelectionScrollView = forwardRef<ScrollView, ScrollViewProps>(function TextSelectionScrollView(props, ref) {
  return <AdaptedScrollView {...props} ref={ref} nativeScrollViewComponent={NativeScrollView} />;
});

export function releaseTextSelectionFocus(): Promise<void> {
  return nativeSelection.releaseFocus();
}
