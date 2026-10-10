/** 选择模式替换聊天顶栏与输入区，删除和分享消费相同选择单位。 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Share2, Trash2 } from 'lucide-react-native';
import { ThemedSurface, useTheme, useThemedStyles, type PresentationTheme } from '@shared/theme';
import { MAX_CHAT_SELECTION_UNITS } from '../../../messages/domain/ChatMessageSelection';

export function ChatSelectionHeader({ count, paddingTop, disabled, onCancel }: {
  count: number; paddingTop: number; disabled: boolean; onCancel: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <ThemedSurface nativeGlass variant="navigation" style={[styles.header, { paddingTop }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="退出多选" disabled={disabled} onPress={onCancel} style={styles.cancel}>
        <Text style={{ color: theme.colors.brand.primary }}>取消</Text>
      </TouchableOpacity>
      <Text style={styles.title}>已选 {count} / {MAX_CHAT_SELECTION_UNITS} 条</Text>
      <View style={styles.cancel} />
    </ThemedSurface>
  );
}

export function ChatSelectionFooter({ count, paddingBottom, isDeleting, onDelete, onShare }: {
  count: number; paddingBottom: number; isDeleting: boolean; onDelete: () => void; onShare: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const disabled = count === 0 || isDeleting;
  return (
    <View style={[styles.footer, { paddingBottom }]}>
      <Text style={styles.hint}>用户消息逐条选择，AI 回复按整轮选择</Text>
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onDelete} style={[styles.action, disabled && styles.disabled]}>
          <Trash2 size={22} color={theme.colors.feedback.error} />
          <Text style={{ color: theme.colors.feedback.error }}>{isDeleting ? '删除中…' : '删除'}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="分享所选消息" accessibilityState={{ disabled }} disabled={disabled} onPress={onShare} style={[styles.action, disabled && styles.disabled]}>
          <Share2 size={22} color={theme.colors.brand.primary} />
          <Text style={{ color: theme.colors.brand.primary }}>分享</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, minHeight: 52 },
  cancel: { width: 64, minHeight: 36, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: theme.components.navigation.titleColor },
  footer: { paddingTop: 10, backgroundColor: theme.colors.surface.default, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
  hint: { color: theme.colors.text.secondary, fontSize: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', paddingTop: 4 },
  action: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  disabled: { opacity: 0.4 },
});
