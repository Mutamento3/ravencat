/** Android 只读文字选择的焦点释放与专用滚动适配。 */
import React, { forwardRef } from 'react';
import { ScrollView, requireNativeComponent, type ScrollViewProps } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

const nativeSelection = requireNativeModule<{ releaseFocus(): Promise<void> }>('NativeTextSelection');
// 必须使用 Fabric 的 ScrollView 身份，否则 measure 不会扣除祖先滚动偏移。
const NativeScrollView = requireNativeComponent<ScrollViewProps>('ScrollView');
// 插槽由 postinstall 扩展 RN 实现；此处拥有扩展属性的 TypeScript 契约。
const AdaptedScrollView = ScrollView as unknown as React.ComponentType<ScrollViewProps & {
  nativeScrollViewComponent: typeof NativeScrollView;
  textSelectionEnabled?: boolean;
  ref?: React.Ref<ScrollView>;
}>;

export const TextSelectionScrollView = forwardRef<ScrollView, ScrollViewProps>(function TextSelectionScrollView(props, ref) {
  return <AdaptedScrollView {...props} ref={ref} nativeScrollViewComponent={NativeScrollView} textSelectionEnabled />;
});

export function releaseTextSelectionFocus(): Promise<void> {
  return nativeSelection.releaseFocus();
}
