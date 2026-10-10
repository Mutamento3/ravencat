// Max Tokens 输入 + 预设区块

import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import { createModelSettingsStyles } from './styles';

const TOKEN_PRESETS = ['2000', '4000', '8000', '无限制'];

interface MaxTokensSectionProps {
  value: string;
  onChangeText: (text: string) => void;
  description?: string;
  onBlur?: () => void;
  onSelectPreset?: (text: string) => void;
  error?: string;
}

/**
 * Max Tokens 区块
 * @param value - 当前值
 * @param onChangeText - 变化回调
 */
export default function MaxTokensSection({ value, onChangeText, description, onBlur, onSelectPreset, error }: MaxTokensSectionProps) {
  const styles = useThemedStyles(createModelSettingsStyles);
  const theme = useTheme();

  return (
    <View style={[styles.section, styles.sectionLightBorder]}>
      <View style={styles.modelSectionHeader}>
        <Text style={styles.sectionLabel}>Max Tokens</Text>
        <TextInput
          style={[styles.paramInput, error && { borderColor: theme.colors.feedback.error }]}
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          keyboardType="number-pad"
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          maxLength={5}
        />
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.feedback.error, fontSize: 13, marginBottom: theme.spacing.sm }}>{error}</Text> : null}
      {description ? <Text style={styles.paramDescription}>{description}</Text> : null}
      <View style={styles.presetContainer}>
        {TOKEN_PRESETS.map((tokens) => (
          <TouchableOpacity
            key={tokens}
            style={styles.presetBtn}
            onPress={() => (onSelectPreset || onChangeText)(tokens)}
            activeOpacity={0.7}
          >
            <Text style={styles.presetText}>{tokens}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
