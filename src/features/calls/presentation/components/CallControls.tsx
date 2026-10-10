import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { useTheme, useThemedStyles } from '@shared/theme';
import { createCallControlsStyles } from './CallControls.styles';

export interface CallControlAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}

interface CallControlsProps {
  actions: CallControlAction[];
}

/** 输出设备与麦克风分开表达；输出图标只呈现系统已经生效的路由。 */
export default function CallControls({ actions }: CallControlsProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createCallControlsStyles);

  return (
    <View style={styles.controls}>
      {actions.map((action) => {
        const Icon = action.icon;
        const color = action.active ? theme.colors.brand.primary : theme.colors.icon.inverse;
        const opacity = action.disabled ? 0.28 : 1;

        return (
          <View key={action.id} style={styles.controlItem}>
            <TouchableOpacity
              style={styles.controlTouch}
              onPress={action.onPress}
              activeOpacity={0.65}
              disabled={action.disabled}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ disabled: action.disabled, selected: action.active }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon size={22} color={color} strokeWidth={1.6} style={{ opacity }} />
            </TouchableOpacity>
            <Text style={[styles.controlLabel, { color, opacity }]} numberOfLines={1}>
              {action.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
