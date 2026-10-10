import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

const createDynamicStyles = (theme: PresentationTheme) => ({
  addIconLine: {
    backgroundColor: theme.colors.text.primary,
  },
});

const staticStyles = StyleSheet.create({
  addIcon: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addIconLine: {
    position: 'absolute',
    width: 18,
    height: 2,
    borderRadius: 1,
  },
  addIconLineVertical: {
    transform: [{ rotate: '90deg' }],
  },
});

export function AddIcon() {
  const dynamicStyles = useThemedStyles(createDynamicStyles);

  return (
    <View style={staticStyles.addIcon}>
      <View style={[staticStyles.addIconLine, dynamicStyles.addIconLine]} />
      <View style={[staticStyles.addIconLine, dynamicStyles.addIconLine, staticStyles.addIconLineVertical]} />
    </View>
  );
}
