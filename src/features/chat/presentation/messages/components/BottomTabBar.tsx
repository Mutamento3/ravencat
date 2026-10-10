/** 按主题渲染普通贴底导航或玻璃悬浮导航。 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface, ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import { FLOATING_TAB_BAR_EDGE_GAP, FLOATING_TAB_BAR_HEIGHT } from '@shared/ui';

function formatBadgeCount(count: number): string {
  if (count > 99) {
    return '99+';
  }

  return String(count);
}

interface TabIconProps {
  name: string;
  active: boolean;
  badgeCount?: number;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    glassDock: {
      position: 'absolute',
      left: 16,
      right: 16,
    },
    glassTabBar: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      height: FLOATING_TAB_BAR_HEIGHT,
      borderRadius: 32,
      paddingHorizontal: 8,
      ...theme.shadow.md,
    },
    glassTabItem: {
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
    },
    capsule: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 44,
      minWidth: 64,
      borderRadius: 22,
      paddingHorizontal: 16,
    },
    capsuleActive: {
      backgroundColor: `${theme.colors.brand.primary}24`,
      borderColor: 'rgba(255,255,255,0.82)',
    },
    standardTabBar: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      paddingTop: 8,
      borderTopWidth: 0.5,
      borderTopColor: theme.colors.border.default,
      backgroundColor: theme.colors.background.app,
    },
    standardTabItem: {
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      paddingVertical: 6,
    },
    iconWrapper: {
      position: 'relative',
    },
    badge: {
      position: 'absolute',
      top: -6,
      right: -12,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: theme.colors.feedback.error,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    badgeText: {
      color: theme.colors.brand.onPrimary,
      fontSize: 9,
      fontWeight: '700',
    },
  });

interface BottomTabBarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  unreadCount?: number;
}

export default function BottomTabBar({ activeTab, onTabChange, unreadCount = 0 }: BottomTabBarProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();

  function TabIcon({ name, active, badgeCount = 0 }: TabIconProps) {
    const hasBadge = badgeCount > 0;

    return (
      <View style={styles.iconWrapper}>
        <Ionicons
          name={(active ? name : `${name}-outline`) as any}
          size={26}
          color={active ? theme.colors.brand.primary : theme.colors.text.secondary}
        />
        {hasBadge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{formatBadgeCount(badgeCount)}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  const tabs = [
    { id: 'ai', iconName: 'chatbubble', badgeCount: unreadCount },
    { id: 'moments', iconName: 'albums' },
    { id: 'apps', iconName: 'grid' },
    { id: 'settings', iconName: 'person' },
  ];

  if (!theme.effects.glass.enabled) {
    return (
      <View style={[styles.standardTabBar, { paddingBottom: Math.max(8, insets.bottom) }]}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;

          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.standardTabItem}
              onPress={() => onTabChange(tab.id)}
              activeOpacity={0.7}
            >
              <TabIcon
                name={tab.iconName}
                active={isActive}
                badgeCount={tab.badgeCount || 0}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.glassDock,
        {
          bottom:
            Math.max(insets.bottom, FLOATING_TAB_BAR_EDGE_GAP)
            + FLOATING_TAB_BAR_EDGE_GAP,
        },
      ]}
    >
      <ThemedSurface nativeGlass style={styles.glassTabBar} variant="tabBar">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          const icon = (
            <TabIcon
              name={tab.iconName}
              active={isActive}
              badgeCount={tab.badgeCount || 0}
            />
          );

          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.glassTabItem}
              onPress={() => onTabChange(tab.id)}
              activeOpacity={0.7}
            >
              {isActive ? (
                <GlassSurface
                  material={{
                    blurRadius: 10,
                    cornerRadius: 22,
                    refractionHeight: 16,
                    refractionOffset: 48,
                    dispersion: 0.4,
                    tintAlpha: 0.28,
                  }}
                  style={[styles.capsule, styles.capsuleActive]}
                >
                  {icon}
                </GlassSurface>
              ) : (
                <View style={styles.capsule}>{icon}</View>
              )}
            </TouchableOpacity>
          );
        })}
      </ThemedSurface>
    </View>
  );
}
