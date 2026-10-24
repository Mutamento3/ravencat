import React from 'react';
import { Text, View } from 'react-native';
import Button from './Button';
import { useTheme } from '@shared/theme';

/** 仅错误时出现，不把正常自动保存变成持续占位的产品状态。 */
export function AutoSaveErrors({ error, blocked, retry, restore }: {
  error: string | null;
  blocked: boolean;
  retry(): void;
  restore?: () => void;
}) {
  const theme = useTheme();
  if (!error && !blocked) return null;
  return <View style={{ padding: theme.spacing.lg }}>
    <Text accessibilityRole="alert" style={{ color: theme.colors.feedback.error, fontSize: 13 }}>
      {error || (restore
        ? '还有修改未保存，请修正下方标红的输入，或恢复已保存值。'
        : '还有修改未保存，请修正下方标红的输入。')}
    </Text>
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
      {error ? <Button title="重试" variant="text" onPress={retry} /> : null}
      {restore ? <Button title="恢复已保存值" variant="text" onPress={restore} /> : null}
    </View>
  </View>;
}
