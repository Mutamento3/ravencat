/** 提供最大令牌数与上下文消息数量复用的数字输入预设区。 */

import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import { createModelSettingsStyles } from '@features/assistants';

interface NumberInputPresetsSectionProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  presets: string[];
  keyboardType?: 'number-pad' | 'decimal-pad';
  maxLength?: number;
  error?: string;
  onBlur?: () => void;
  onSelectPreset?: (value: string) => void;
}

export default function NumberInputPresetsSection({
  label,
  value,
  onChangeText,
  presets,
  keyboardType = 'number-pad',
  maxLength = 5,
  error, onBlur, onSelectPreset,
}: NumberInputPresetsSectionProps) {
  const styles = useThemedStyles(createModelSettingsStyles);
  const theme = useTheme();

  return (
    <View style={[styles.section, styles.sectionLightBorder]}>
      <View style={styles.modelSectionHeader}>
        <Text style={[styles.sectionLabel, { flex: 1, marginBottom: 0, marginRight: theme.spacing.md }]}>{label}</Text>
        <TextInput
          style={[styles.paramInput, { flexShrink: 0 }, error && { borderColor: theme.colors.feedback.error }]}
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          keyboardType={keyboardType}
          maxLength={maxLength}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
        />
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.feedback.error, fontSize: 13, marginBottom: theme.spacing.sm }}>{error}</Text> : null}
      <View style={styles.presetContainer}>
        {presets.map((preset) => (
          <TouchableOpacity
            key={preset}
            style={styles.presetBtn}
            onPress={() => (onSelectPreset ?? onChangeText)(preset)}
            activeOpacity={0.7}
          >
            <Text style={styles.presetText}>{preset}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
