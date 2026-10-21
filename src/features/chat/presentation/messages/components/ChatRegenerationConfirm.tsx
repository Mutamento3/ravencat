/** 重写说明只拥有本机提示偏好，确认后仍委派既有重写用例。 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, Square } from 'lucide-react-native';
import { Button, ModalSheet } from '@shared/ui';
import { useTheme } from '@shared/theme';

const SKIP_CONFIRM_KEY = 'chat.regeneration.skip-confirm';
export const shouldConfirmChatRegeneration = async () => await AsyncStorage.getItem(SKIP_CONFIRM_KEY) !== 'true';

export default function ChatRegenerationConfirm({ onClose, onConfirm }: { onClose(): void; onConfirm(): void }) {
  const theme = useTheme();
  const [skip, setSkip] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const confirm = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      if (skip) await AsyncStorage.setItem(SKIP_CONFIRM_KEY, 'true');
      if (mounted.current) onConfirm();
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : '无法保存提示偏好');
        setSaving(false);
      }
      busy.current = false;
    }
  };
  return <ModalSheet visible title="重写回复" onClose={() => { if (!saving) onClose(); }}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.text, { color: theme.colors.text.primary }]}>将根据本轮输入重新生成回复，原回复会保存到「历史版本」。继续对话前，可选择这一轮采用的版本；继续后，历史版本仅供查看和复制。{ '\n\n' }对话始终沿一条时间线继续，不产生剧情分支。手动改写只修改当前版本。{ '\n\n' }已有摘要、记忆和关系状态不会随重写或版本切换回滚；已执行的操作不会撤销，重写可能再次执行工具。</Text>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="不再提示" accessibilityState={{ checked: skip, disabled: saving }} disabled={saving} onPress={() => setSkip(!skip)} style={styles.checkbox}>
        {skip ? <Check size={22} color={theme.colors.brand.primary} /> : <Square size={22} color={theme.colors.text.secondary} />}
        <Text style={{ color: theme.colors.text.primary }}>不再提示</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.feedback.error }}>{error}</Text> : null}
      <View style={styles.buttons}>
        <Button title="取消" variant="secondary" disabled={saving} onPress={onClose} />
        <Button title="确认重写" disabled={saving} onPress={() => { void confirm(); }} />
      </View>
    </ScrollView>
  </ModalSheet>;
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 18 }, text: { fontSize: 14, lineHeight: 23 },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
});
