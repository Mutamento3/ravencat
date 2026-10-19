/** 底部导航分发：主题决定视觉，三个变体共用原有的导航回调。 */

import React from 'react';
import { useTheme } from '@shared/theme';
import FloatingBallTabBar from './bottomTabBar/FloatingBallTabBar';
import InkCircleTabBar from './bottomTabBar/InkCircleTabBar';
import MeltingGlassTabBar from './bottomTabBar/MeltingGlassTabBar';
import type { BottomTabBarVariantProps } from './bottomTabBar/tabBarShared';

export type BottomTabBarProps = BottomTabBarVariantProps;

export default function BottomTabBar(props: BottomTabBarProps) {
  const theme = useTheme();

  if (theme.id === 'paper-note') {
    return <InkCircleTabBar {...props} />;
  }

  if (theme.effects.glass.enabled) {
    return <MeltingGlassTabBar {...props} />;
  }

  return <FloatingBallTabBar {...props} />;
}
