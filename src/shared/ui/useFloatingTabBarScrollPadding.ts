// 悬浮 TabBar 遮挡内容的滚动容器底部预留空间。
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  FLOATING_TAB_BAR_CONTENT_GAP,
  FLOATING_TAB_BAR_EDGE_GAP,
  FLOATING_TAB_BAR_HEIGHT,
} from './floatingTabBarMetrics';

/**
 * 默认与玻璃主题下底部 TabBar 为悬浮（absolute）定位，会浮在页面内容之上；
 * 滚动容器（FlatList/ScrollView）需要在 contentContainerStyle 上预留
 * 该高度的底部内边距，否则最后一条内容会被 TabBar 挡住且无法滚动露出。
 */
export function useFloatingTabBarScrollPadding(): number {
  const insets = useSafeAreaInsets();
  return (
    FLOATING_TAB_BAR_HEIGHT
    + Math.max(insets.bottom, FLOATING_TAB_BAR_EDGE_GAP)
    + FLOATING_TAB_BAR_EDGE_GAP
    + FLOATING_TAB_BAR_CONTENT_GAP
  );
}
