/** 提供本地伴随勿扰时间滚轮。 */

import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const WHEEL_ITEM_HEIGHT = 44;
const WHEEL_VISIBLE_ITEMS = 3;

export function QuietHoursWheel({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return (
    <View style={styles.timeGroup}>
      <Text style={styles.timeLabel}>{label}</Text>
      <View style={styles.wheelRow}>
        <WheelColumn
          accessibilityLabel={`${label}小时`}
          count={24}
          value={hour}
          onChange={(nextHour) => onChange(nextHour * 60 + minute)}
        />
        <Text style={styles.timeSeparator}>:</Text>
        <WheelColumn
          accessibilityLabel={`${label}分钟`}
          count={60}
          value={minute}
          onChange={(nextMinute) => onChange(hour * 60 + nextMinute)}
        />
      </View>
    </View>
  );
}

function WheelColumn({
  accessibilityLabel,
  count,
  value,
  onChange,
}: {
  accessibilityLabel: string;
  count: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const ref = useRef<ScrollView>(null);
  const values = useMemo(() => Array.from({ length: count }, (_, index) => index), [count]);
  useEffect(() => {
    ref.current?.scrollTo({ y: value * WHEEL_ITEM_HEIGHT, animated: false });
  }, [value]);
  const selectFromOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.max(0, Math.min(count - 1, Math.round(
      event.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT
    )));
    if (next !== value) onChange(next);
  };
  return (
    <View
      style={styles.wheelColumn}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: count - 1, now: value, text: String(value).padStart(2, '0') }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => onChange(Math.max(0, Math.min(
        count - 1,
        value + (event.nativeEvent.actionName === 'increment' ? 1 : -1)
      )))}
    >
      <View pointerEvents="none" style={styles.wheelSelection} />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={styles.wheelContent}
        onMomentumScrollEnd={selectFromOffset}
        onScrollEndDrag={selectFromOffset}
      >
        {values.map((item) => (
          <View key={item} style={styles.wheelItem}>
            <Text style={[styles.wheelText, item === value ? styles.wheelTextSelected : null]}>
              {String(item).padStart(2, '0')}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  timeGroup: { flex: 1, alignItems: 'center' },
  timeLabel: { marginBottom: theme.spacing.xs, fontSize: 14, color: theme.colors.text.secondary },
  wheelRow: { flexDirection: 'row', alignItems: 'center' },
  wheelColumn: { width: 64, height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ITEMS, overflow: 'hidden' },
  wheelContent: { paddingVertical: WHEEL_ITEM_HEIGHT },
  wheelSelection: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: WHEEL_ITEM_HEIGHT,
    height: WHEEL_ITEM_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.surface.muted,
  },
  wheelItem: { height: WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  wheelText: { fontSize: 18, color: theme.colors.text.tertiary },
  wheelTextSelected: { fontSize: 22, fontWeight: '700', color: theme.colors.text.primary },
  timeSeparator: { marginHorizontal: 2, fontSize: 22, fontWeight: '700', color: theme.colors.text.primary },
});
