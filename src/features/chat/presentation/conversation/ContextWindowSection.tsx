/** 主客关系取决于来源与当前会话；条数保存于各AI，没有全局继承。 */

import React from 'react';
import { View, Text } from 'react-native';
import { AppTextInput } from '@shared/ui';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { createStyles } from './chatSettingsStyles';
import type { ContextLimitsDraft } from './chatSettingsDraft';

interface ContextWindowFieldMeta {
  field: keyof ContextLimitsDraft;
  label: string;
  description: string;
}

const CONTEXT_WINDOW_FIELDS: ContextWindowFieldMeta[] = [
  { field: 'privatePrimary', label: '当前单聊', description: '和这位 AI 单聊时使用' },
  { field: 'privateSecondary', label: '单聊背景', description: '在群聊中带入 · 0 为不带入' },
  { field: 'groupPrimary', label: '当前群聊', description: '在当前群聊天时使用' },
  { field: 'groupSecondary', label: '其他群聊背景', description: '在其他对话中带入 · 每群独立 · 0 为不带入' },
];

interface ContextWindowSectionProps {
  values: ContextLimitsDraft;
  onChange: (field: keyof ContextLimitsDraft, value: string) => void;
  onBlur?: () => void;
  errors?: Partial<Record<keyof ContextLimitsDraft, string>>;
  fixed?: boolean;
  children?: React.ReactNode;
}

/**
 * 上下文可见条数区块
 * @param values - 四个字段的当前输入值
 * @param onChange - 单字段变化回调
 */
export default function ContextWindowSection({ values, onChange, onBlur, errors = {}, fixed = false, children }: ContextWindowSectionProps) {
  const styles = useThemedStyles(createStyles);
  const theme = useTheme();

  return (
    <ThemedSurface variant="card" style={styles.settingsSection}>
      <Text style={styles.cardTitle}>近期聊天条数</Text>
      {CONTEXT_WINDOW_FIELDS.map(({ field, label, description }) => (
        <View key={field} style={styles.contextLimitField}>
          <View style={styles.contextLimitRow}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{label}</Text>
              <Text style={styles.rowDescription}>{field === 'privatePrimary' && fixed ? '已固定消息起点，此项暂不生效' : description}</Text>
            </View>
            <AppTextInput
              style={[styles.contextLimitInput, field === 'privatePrimary' && fixed && styles.disabled, errors[field] && { borderColor: theme.colors.feedback.error }]}
              accessibilityLabel={label}
              editable={field !== 'privatePrimary' || !fixed}
              value={values[field]}
              onChangeText={(text) => onChange(field, text)}
              onBlur={onBlur}
              keyboardType="number-pad"
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
            />
            <Text style={styles.unit}>条</Text>
          </View>
          {errors[field] ? <Text accessibilityRole="alert" style={styles.contextLimitError}>{errors[field]}</Text> : null}
        </View>
      ))}
      {children}
    </ThemedSurface>
  );
}
