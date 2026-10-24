/** 用户管理退出历史的注入选择；记忆转换由 AI 的记忆工具负责。 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { ModalSheet, ToggleField } from '@shared/ui';
import { useTheme, useThemedStyles, type PresentationTheme } from '@shared/theme';
import { listHistoricalGroups, setHistoricalGroupInjection, subscribeGroupChanged } from '../../group/application/GroupMembership';
import type { GroupHistory } from '../../group/domain/GroupMembership';

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  entry: { padding: theme.spacing.lg },
  title: { color: theme.colors.text.primary, fontSize: 16, fontWeight: '600' },
  description: { color: theme.colors.text.secondary, fontSize: 13, lineHeight: 20, marginTop: theme.spacing.sm },
  body: { padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { paddingVertical: theme.spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light },
  text: { color: theme.colors.text.primary, fontSize: 14, lineHeight: 22 },
  action: { color: theme.colors.brand.primary, fontSize: 14 },
  error: { color: theme.colors.feedback.error, lineHeight: 20 },
});
function historyText(history: GroupHistory): string {
  return [...history.context.contextSegments.map(segment => segment.content),
    ...history.context.timeline.map(item => `${item.timestamp} ${item.actor?.name ?? (item.speaker === 'user' ? '用户' : item.speaker === 'application' ? '系统' : 'AI')}：${item.content}`)].join('\n\n');
}
export default function HistoricalGroupsSection({ assistantId }: { assistantId: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [visible, setVisible] = useState(false);
  const [histories, setHistories] = useState<GroupHistory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = histories.find(item => item.id === selectedId);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try { const records = await listHistoricalGroups(assistantId); if (active) { setHistories(records); setError(null); } }
      catch (failure) { if (active) setError(failure instanceof Error ? failure.message : '历史群聊读取失败'); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const unsubscribe = subscribeGroupChanged(() => { void load(); });
    return () => { active = false; unsubscribe(); };
  }, [assistantId, visible]);
  const toggle = async (record: GroupHistory, enabled: boolean) => {
    setBusy(true);
    try {
      await setHistoricalGroupInjection(assistantId, record.id, enabled);
      setHistories(current => current.map(item => item.id === record.id ? { ...item, injectEnabled: enabled } : item));
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败'); }
    finally { setBusy(false); }
  };
  return <>
    <Pressable style={styles.entry} accessibilityRole="button" onPress={() => { setSelectedId(null); setVisible(true); }}>
      <Text style={styles.title}>历史群聊 ›</Text>
      <Text style={styles.description}>查看退出前保留的信息、管理历史注入。可以让 AI 使用记忆工具转换为长期记忆。不会接收退出后的群消息。</Text>
    </Pressable>
    <ModalSheet visible={visible} onClose={() => { if (!busy) setVisible(false); }} title={selected ? selected.groupName : '历史群聊'}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {loading && <ActivityIndicator color={theme.colors.brand.primary} />}
        {selected ? <>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setSelectedId(null); }}><Text style={styles.action}>‹ 历史群聊列表</Text></Pressable>
          <Text style={styles.description}>{selected.reason === 'removed' ? '已被移出该群聊' : '已退出该群聊'} · {new Date(selected.exitedAt).toLocaleString()}</Text>
          <ToggleField label="历史信息注入" value={selected.injectEnabled} onValueChange={enabled => { if (!busy) void toggle(selected, enabled); }}
            hint="关闭后不再自动带入这份历史，已转存的记忆单独管理；群聊·客为 0 时也不注入。" />
          <Text selectable style={styles.text}>{historyText(selected) || '退出时没有可保留的摘要或聊天内容。'}</Text>
        </> : !loading && (histories.length === 0 ? <Text style={styles.description}>还没有已退出的群聊记录。重新加入的群使用正常群上下文，不在这里重复注入。</Text>
          : histories.map(record => <Pressable key={record.id} style={styles.row} accessibilityRole="button" onPress={() => { setSelectedId(record.id); setError(null); }}>
            <Text style={styles.title}>{record.groupName} ›</Text>
            <Text style={styles.description}>已退出 · {record.injectEnabled ? '历史注入开启' : '历史注入关闭'} · {new Date(record.exitedAt).toLocaleDateString()}</Text>
          </Pressable>))}
      </ScrollView>
    </ModalSheet>
  </>;
}
