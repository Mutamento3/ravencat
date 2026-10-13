/** 主客关系取决于来源与当前会话；条数保存于各AI，没有全局继承。 */

import React from 'react';
import { View, Text } from 'react-native';
import { AppTextInput } from '@shared/ui';
import { useTheme, useThemedStyles } from '@shared/theme';
import { createStyles } from './chatSettingsStyles';
import type { ContextLimitsDraft } from './chatSettingsDraft';

interface ContextWindowFieldMeta {
  field: keyof ContextLimitsDraft;
  label: string;
}

const CONTEXT_WINDOW_FIELDS: ContextWindowFieldMeta[] = [
  { field: 'privatePrimary', label: '单聊·主' },
  { field: 'privateSecondary', label: '单聊·客' },
  { field: 'groupPrimary', label: '群聊·主' },
  { field: 'groupSecondary', label: '群聊·客' },
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
        {fixed ? '已固定消息起点，「单聊·主」暂不生效，原参数保留。' : '「主」用于当前来源会话，「客」用于其他会话中的背景。单聊带入自己的主·单聊与全部已参加群的客·群聊；群聊带入自己的客·单聊、当前群的主·群聊及其他已参加群的客·群聊。'}
      </Text>
      <Text style={styles.paramDescription}>群额度按每群独立计算，退出或删除后不带入。主条数为正整数；客条数允许0，也可大于主条数。0关闭该类来源整块原文与摘要，不停止来源生成；正数限制近期原文，摘要另按来源注入开关。单聊按主·单聊触发摘要，群聊按群摘要设置触发。自动摘要成功前保留主视角未处理原文，关闭生成后按主窗口读取。</Text>
      {CONTEXT_WINDOW_FIELDS.map(({ field, label }) => (
        <View key={field} style={styles.contextLimitField}>
          <View style={styles.contextLimitRow}>
            <Text style={styles.contextLimitLabel}>
              {label}
            </Text>
            <AppTextInput
              style={[styles.contextLimitInput, errors[field] && { borderColor: theme.colors.feedback.error }]}
              accessibilityLabel={label}
              editable={field !== 'privatePrimary' || !fixed}
              value={values[field]}
              onChangeText={(text) => onChange(field, text)}
              onBlur={onBlur}
              keyboardType="number-pad"
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
            />
          </View>
          {errors[field] ? <Text accessibilityRole="alert" style={styles.contextLimitError}>{errors[field]}</Text> : null}
        </View>
      ))}
    </View>
  );
}
