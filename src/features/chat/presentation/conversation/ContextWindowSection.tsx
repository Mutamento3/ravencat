// 上下文可见条数（主客动态装载）配置区块
// 设计见 docs/prompt/context-window-primary-secondary-design.md 第 7 节：
// 群聊两个字段可编辑、可保存、暂不生效，故只标注"暂未生效"而不禁用。

import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import { createStyles } from './chatSettingsStyles';
import type { ContextLimitsDraft } from './chatSettingsDraft';

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
  fixed?: boolean;
}

/**
 * 上下文可见条数区块
 * @param values - 四个字段的当前输入值
 * @param onChange - 单字段变化回调
 */
export default function ContextWindowSection({ values, onChange, onBlur, errors = {}, fixed = false }: ContextWindowSectionProps) {
  const styles = useThemedStyles(createStyles);
  const theme = useTheme();

  return (
    <View style={styles.settingsSection}>
      <Text style={styles.sectionLabel}>上下文可见条数</Text>
      <Text style={styles.paramDescription}>
        {fixed ? '已固定消息起点，「单聊·主」暂不生效，原参数保留。' : '自动生成摘要时，「单聊·主」是聊天与通话累计多少条后总结的门槛，未总结原文继续保留；暂停生成时，它决定注入多少条最近对话。'}「客」用于把来源作为其他场景背景的配置；请填写正整数。
      </Text>
      {CONTEXT_WINDOW_FIELDS.map(({ field, label, pending }) => (
        <View key={field} style={styles.contextLimitField}>
          <View style={styles.contextLimitRow}>
            <Text style={styles.contextLimitLabel}>
              {pending ? `${label}（暂未生效）` : label}
            </Text>
            <TextInput
              style={[styles.contextLimitInput, errors[field] && { borderColor: theme.colors.feedback.error }]}
              accessibilityLabel={label}
              editable={field !== 'privatePrimary' || !fixed}
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
