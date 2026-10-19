/** 普通主题的球体、凹槽与球内图标共用一个位移，主题只负责配色。 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedProps, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@shared/theme';
import { buildScoopedBarPath } from './tabBarPaths';
import { ActiveTabGlyph, TabBarItems, TABS, useTabMotion, type BottomTabBarVariantProps } from './tabBarShared';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const HEIGHT = 78;
const RADIUS = 24;

export default function FloatingBallTabBar(props: BottomTabBarVariantProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const { position } = useTabMotion(props.activeTab);
  const itemWidth = width / TABS.length;
  const height = HEIGHT + Math.max(8, insets.bottom);
  const tokens = theme.components.tabBar;
  const path = useAnimatedProps(() => ({
    d: buildScoopedBarPath((position.value + 0.5) * itemWidth, width, height, Math.min(44, itemWidth * 0.48)),
  }));
  const ballStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * itemWidth }],
  }));

  return (
    <View style={{ paddingLeft: insets.left, paddingRight: insets.right, backgroundColor: tokens.backgroundColor }}>
      <View style={[styles.container, { height, backgroundColor: theme.colors.background.screen }]}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 && (
          <>
            <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
              <AnimatedPath animatedProps={path} fill={tokens.backgroundColor}
                stroke={tokens.borderColor} strokeWidth={StyleSheet.hairlineWidth} />
            </Svg>
            <Animated.View pointerEvents="none" accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.ball, theme.shadow.sm, { left: itemWidth / 2 - RADIUS,
                backgroundColor: theme.colors.brand.primary }, ballStyle]}>
              <ActiveTabGlyph activeTab={props.activeTab} unreadCount={props.unreadCount ?? 0}
                color={theme.colors.brand.onPrimary} />
            </Animated.View>
          </>
        )}
        <TabBarItems {...props} height={HEIGHT} iconOffset={10} />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { position: 'relative' },
  ball: { position: 'absolute', top: 0, width: RADIUS * 2, height: RADIUS * 2, borderRadius: RADIUS },
});
