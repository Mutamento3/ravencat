/** 没有用户壁纸时提供带层次的默认背景，让折射和色散仍然可见。 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../useTheme';

interface DefaultGlassBackdropProps {
  style?: StyleProp<ViewStyle>;
}

export function DefaultGlassBackdrop({ style }: DefaultGlassBackdropProps) {
  const theme = useTheme();
  const isDark = theme.mode === 'dark';

  return (
    <View style={[styles.container, style]}>
      <LinearGradient
        colors={isDark
          ? ['#111827', '#1E293B', '#312E81']
          : ['#E8F3FF', '#F3EEFF', '#FFF1E8']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={isDark
          ? ['rgba(56,189,248,0.5)', 'rgba(56,189,248,0)']
          : ['rgba(74,171,255,0.62)', 'rgba(74,171,255,0)']}
        style={[styles.orb, styles.orbTop]}
      />
      <LinearGradient
        colors={isDark
          ? ['rgba(168,85,247,0.45)', 'rgba(168,85,247,0)']
          : ['rgba(177,125,255,0.5)', 'rgba(177,125,255,0)']}
        style={[styles.orb, styles.orbMiddle]}
      />
      <LinearGradient
        colors={isDark
          ? ['rgba(244,114,182,0.34)', 'rgba(244,114,182,0)']
          : ['rgba(255,164,128,0.46)', 'rgba(255,164,128,0)']}
        style={[styles.orb, styles.orbBottom]}
      />
      <View style={[styles.veil, isDark ? styles.veilDark : styles.veilLight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#E8F3FF',
  },
  orb: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  orbTop: {
    top: -120,
    right: -100,
  },
  orbMiddle: {
    top: '32%',
    left: -150,
  },
  orbBottom: {
    right: -140,
    bottom: -90,
  },
  veil: {
    ...StyleSheet.absoluteFillObject,
  },
  veilLight: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  veilDark: {
    backgroundColor: 'rgba(5,10,24,0.12)',
  },
});
