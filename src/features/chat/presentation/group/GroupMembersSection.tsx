/** 成员网格只表达用户操作，资格与并发裁决统一交给成员命令。 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { AIAvatar, Button, ModalSheet, showAppDialog } from '@shared/ui';
import { useTheme, useThemedStyles, type PresentationTheme } from '@shared/theme';
import type { AIProfile } from '@features/assistants';
import type { GroupChatMember } from '../../group/domain/GroupChat';
import { changeGroupMembers, listGroupInviteCandidates } from '../../group/application/GroupMembership';

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  section: { marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.lg },
  title: { color: theme.colors.text.primary, fontSize: 16, fontWeight: '600', marginBottom: theme.spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  member: { width: 64, alignItems: 'center', gap: theme.spacing.xs },
  name: { color: theme.colors.text.primary, fontSize: 12 },
  muted: { color: theme.colors.text.secondary, fontSize: 11 },
  add: { width: 48, height: 48, borderRadius: theme.radius.md, borderWidth: 1, borderStyle: 'dashed',
    borderColor: theme.colors.text.tertiary, justifyContent: 'center', alignItems: 'center' },
  picker: { padding: theme.spacing.lg, gap: theme.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
  selected: { color: theme.colors.brand.primary, fontWeight: '600' },
  message: { color: theme.colors.text.secondary, paddingVertical: theme.spacing.md },
});
export default function GroupMembersSection({ groupId, members }: {
  groupId: string; members: GroupChatMember[];
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [visible, setVisible] = useState(false);
  const [candidates, setCandidates] = useState<AIProfile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const report = (error: unknown) => showAppDialog({ title: '操作失败', message: error instanceof Error ? error.message : '请稍后重试', tone: 'error' });
  const open = async () => {
    setVisible(true); setSelected(new Set()); setLoading(true); setLoadError(null);
    try { setCandidates(await listGroupInviteCandidates(groupId)); }
    catch (error) { setLoadError(error instanceof Error ? error.message : '无法读取候选成员'); }
    finally { setLoading(false); }
  };
  const change = async (action: 'add' | 'remove' | 'mute' | 'unmute', ids: string[]) => {
    setBusy(true);
    try { await changeGroupMembers(groupId, action, ids); setVisible(false); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  };
  const manage = (member: GroupChatMember) => showAppDialog({ title: member.nickname ?? member.name ?? '群成员', buttons: [
    { text: member.muted ? '解除禁言' : '禁言', onPress: () => { void change(member.muted ? 'unmute' : 'mute', [member.aiAssistantId]); } },
    { text: '移出群聊', style: 'destructive', onPress: () => { void change('remove', [member.aiAssistantId]); } },
    { text: '取消', style: 'cancel' },
  ] });
  return <View style={styles.section}>
    <Text style={styles.title}>群成员</Text>
    <View style={styles.grid}>
      {members.filter(member => member.enabled).map(member => <Pressable key={member.aiAssistantId} style={styles.member}
        disabled={busy} accessibilityRole="button" accessibilityLabel={`管理${member.nickname ?? member.name ?? '群成员'}`} onPress={() => manage(member)}>
        <AIAvatar name={member.nickname ?? member.name ?? 'AI'} avatarUrl={member.avatar} size="medium" />
        <Text style={styles.name} numberOfLines={1}>{member.nickname ?? member.name ?? 'AI'}</Text>
        {member.muted && <Text style={styles.muted}>已禁言</Text>}
      </Pressable>)}
      <Pressable style={styles.member} accessibilityRole="button" accessibilityLabel="添加群成员" disabled={busy} onPress={() => { void open(); }}>
        <View style={styles.add}><Plus size={24} color={theme.colors.text.secondary} /></View><Text style={styles.name}>添加</Text>
      </Pressable>
    </View>
    <ModalSheet visible={visible} onClose={() => { if (!busy) setVisible(false); }} title="添加群成员">
      <ScrollView contentContainerStyle={styles.picker} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator color={theme.colors.brand.primary} /> : loadError ? <Text style={styles.message}>{loadError}</Text>
          : candidates.length === 0 ? <Text style={styles.message}>没有可加入的 AI，已退出的成员可在这里重新邀请。</Text>
          : candidates.map(ai => <Pressable key={ai.id} style={styles.row} disabled={busy} accessibilityRole="checkbox"
            accessibilityState={{ checked: selected.has(ai.id) }} onPress={() => setSelected(current => {
              const next = new Set(current); if (next.has(ai.id)) next.delete(ai.id); else next.add(ai.id); return next;
            })}>
            <AIAvatar name={ai.nickname ?? ai.name} avatarUrl={ai.avatar} size="medium" />
            <Text style={[styles.name, selected.has(ai.id) && styles.selected]}>{selected.has(ai.id) ? '✓ ' : ''}{ai.nickname ?? ai.name}</Text>
          </Pressable>)}
        <Button title={busy ? '正在添加…' : `添加所选成员（${selected.size}）`} disabled={busy || loading || selected.size === 0}
          onPress={() => { void change('add', [...selected]); }} />
      </ScrollView>
    </ModalSheet>
  </View>;
}
