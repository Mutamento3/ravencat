/** 纸张主题的钢笔圈选：图标不位移，只有墨迹在 UI 线程描绘与淡出。 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  cancelAnimation, Easing, useAnimatedProps, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@shared/theme';
import { TabBarButton, TabGlyph, TABS, type BottomTabBarVariantProps } from './tabBarShared';

const AnimatedPath = Animated.createAnimatedComponent(Path);
// 普通底栏原有的 8dp 顶部留白 + 26dp 图标 + 12dp 触摸留白；墨圈不撑高布局。
const HEIGHT = 46;
// 固定坐标中的不规则开口曲线，末段重叠并回钩；长度预先计算，无需运行时测量布局。
const INK_PATH = 'M43 11 C32 6 17 10 10 21 C4 32 12 43 25 46 C39 49 52 40 53 27 C54 15 42 7 30 9 C20 10 14 15 12 21 Q10 26 14 27';
const INK_LENGTH = 173.93;

function InkCircle({ active, color }: { active: boolean; color: string }) {
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (active) {
      // 新一笔从起笔处画；被打断的旧笔停在当前位置淡出，快速改选也不排队。
      progress.value = 0;
      progress.value = withTiming(1, { duration: 460, easing: Easing.bezier(0.24, 0.05, 0.5, 1) });
      opacity.value = withTiming(1, { duration: 70 });
    } else {
      cancelAnimation(progress);
      opacity.value = withTiming(0, { duration: 100 });
    }
    return () => {
      cancelAnimation(progress);
      cancelAnimation(opacity);
    };
  }, [active, opacity, progress]);
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: INK_LENGTH * (1 - progress.value),
    opacity: opacity.value,
  }));
  return (
    <Svg width={60} height={56} viewBox="0 0 60 56" style={StyleSheet.absoluteFill}
      pointerEvents="none">
      <AnimatedPath d={INK_PATH} fill="none" stroke={color} strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[INK_LENGTH, INK_LENGTH]}
        animatedProps={animatedProps} />
    </Svg>
  );
}

export default function InkCircleTabBar({ activeTab, onTabChange, unreadCount = 0 }: BottomTabBarVariantProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tokens = theme.components.tabBar;
  return (
    <View style={[styles.bar, {
      backgroundColor: tokens.backgroundColor, borderTopColor: tokens.borderColor,
      paddingBottom: Math.max(8, insets.bottom), paddingLeft: insets.left, paddingRight: insets.right,
    }]}>
      <View style={styles.items} role="tablist">
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          const badgeCount = tab.id === 'ai' ? unreadCount : 0;
          return (
            <TabBarButton key={tab.id} tab={tab} active={active} badgeCount={badgeCount}
              onPress={() => onTabChange(tab.id)}>
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                style={styles.icon}>
                <InkCircle active={active} color={tokens.activeColor} />
                <TabGlyph tab={tab} solid={false} badgeCount={badgeCount}
                  color={active ? tokens.activeColor : tokens.inactiveColor} />
              </View>
            </TabBarButton>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  items: { height: HEIGHT, flexDirection: 'row' },
  icon: { width: 60, height: 56, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: 4 }] },
});
