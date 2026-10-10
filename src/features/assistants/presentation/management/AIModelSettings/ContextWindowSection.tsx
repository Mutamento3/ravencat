// 上下文可见条数（主客动态装载）配置区块
// 设计见 docs/prompt/context-window-primary-secondary-design.md 第 7 节：
// 群聊两个字段可编辑、可保存、暂不生效，故只标注"暂未生效"而不禁用。

import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import { createModelSettingsStyles } from './styles';
import type { ContextLimitsDraft } from './modelSettingsHelpers';

interface ContextWindowFieldMeta {
  field: keyof ContextLimitsDraft;
  label: string;
  pending?: boolean;
}

const CONTEXT_WINDOW_FIELDS: ContextWindowFieldMeta[] = [
  { field: 'privatePrimary', label: '单聊·主' },
  { field: 'privateSecondary', label: '单聊·客' },
  { field: 'groupPrimary', label: '群聊·主', pending: true },
  { field: 'groupSecondary', label: '群聊·客', pending: true },
];

interface ContextWindowSectionProps {
  values: ContextLimitsDraft;
  onChange: (field: keyof ContextLimitsDraft, value: string) => void;
  onBlur?: () => void;
  errors?: Partial<Record<keyof ContextLimitsDraft, string>>;
}

/**
 * 上下文可见条数区块
 * @param values - 四个字段的当前输入值
 * @param onChange - 单字段变化回调
 */
export default function ContextWindowSection({ values, onChange, onBlur, errors = {} }: ContextWindowSectionProps) {
  const styles = useThemedStyles(createModelSettingsStyles);
  const theme = useTheme();

  return (
    <View style={[styles.section, styles.sectionLightBorder]}>
      <Text style={styles.sectionLabel}>上下文可见条数</Text>
      <Text style={styles.paramDescription}>
        AI 回复时能看到多少条最近对话。「主」用于当前正在进行的场景，「客」用于把对话作为背景注入其他场景；请填写正整数。
      </Text>
      {CONTEXT_WINDOW_FIELDS.map(({ field, label, pending }) => (
        <View key={field} style={styles.contextLimitField}>
          <View style={styles.contextLimitRow}>
            <Text style={styles.contextLimitLabel}>
              {pending ? `${label}（暂未生效）` : label}
            </Text>
            <TextInput
              style={[styles.paramInput, styles.contextLimitInput, errors[field] && { borderColor: theme.colors.feedback.error }]}
              accessibilityLabel={label}
              value={values[field]}
              onChangeText={(text) => onChange(field, text)}
              onBlur={onBlur}
              keyboardType="number-pad"
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              maxLength={3}
            />
          </View>
          {errors[field] ? <Text accessibilityRole="alert" style={styles.contextLimitError}>{errors[field]}</Text> : null}
        </View>
      ))}
    </View>
  );
}
