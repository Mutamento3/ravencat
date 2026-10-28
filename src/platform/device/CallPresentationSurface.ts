import { requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';

/** 通话页面的绘制边界；内容就绪后在原位置淡入。 */
export const CallPresentationSurface = requireNativeViewManager<ViewProps & {
  callId: string;
  ready: boolean;
}>('CallRuntime', 'CallPresentationView');
