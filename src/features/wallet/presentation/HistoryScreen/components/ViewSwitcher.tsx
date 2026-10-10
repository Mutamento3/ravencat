/**
 * @fileoverview 视图切换器组件
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useHistoryStyles } from '../styles';
import type { ViewType } from '../types';

interface ViewSwitcherProps {
  currentView: ViewType;
  onChange: (view: ViewType) => void;
}

const VIEW_OPTIONS: { value: ViewType; label: string }[] = [
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
];

export function ViewSwitcher({ currentView, onChange }: ViewSwitcherProps) {
  const styles = useHistoryStyles();

  return (
    <View style={styles.switcherContainer}>
      {VIEW_OPTIONS.map((option) => (
        <TouchableOpacity
          key={option.value}
          style={[
            styles.switcherButton,
            currentView === option.value && styles.switcherButtonActive,
          ]}
          onPress={() => onChange(option.value)}
        >
          <Text
            style={[
              styles.switcherText,
              currentView === option.value && styles.switcherTextActive,
            ]}
          >
            {option.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
