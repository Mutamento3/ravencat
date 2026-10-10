/** 持久摘要独立维护；清消息与清摘要是两个不同的用户动作。 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import { NavigationHeader, useBusyBackHandler, showAppDialog } from '@shared/ui';
import { createChatSummaryStyles } from './chatSummaryStyles';
import { clearChatSummary, getChatSummaryContext } from '../application/ChatSummary';
import { subscribeChatSummaryChanged } from '../application/ChatSummaryRuntime';
import type { ChatSummarySegment } from '../domain/ChatSummaryRepository';

const SUMMARY_HELP_SECTIONS = [
  { title: '长期保留，由你维护', body: 'AI 只在末尾追加新摘要，已有内容由你维护。删除或清除聊天消息，不会删除这里的摘要。' },
  { title: '聊天与通话一起累计', body: '按“单聊·主”的逻辑消息条数累计，同一消息的多个分段只算一条。通话中达到条数，会等挂断后总结；不足条数则继续累计。' },
  { title: '按时间顺序，分批总结', body: '每次最多处理 5000 字新原文，每段自动摘要最多 500 字。总结完成前，尚未总结的原文仍会进入上下文。' },
];

export default function ChatSummaryScreen({ conversationId, onBack, onCreateSummary, onEditSummary }: {
  conversationId: string; onBack(): void; onCreateSummary(): void; onEditSummary(segmentId: string): void;
}) {
  const theme = useTheme(); const styles = useThemedStyles(createChatSummaryStyles);
  const [segments, setSegments] = useState<ChatSummarySegment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useBusyBackHandler(busy);
  const load = useCallback(async () => {
    try { const snapshot = await getChatSummaryContext(conversationId); setSegments(snapshot.segments); setError(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '读取摘要失败'); }
  }, [conversationId]);
  useEffect(() => { void load(); return subscribeChatSummaryChanged((id) => { if (id === conversationId) void load(); }); }, [conversationId, load]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); }
    catch (failure) { showAppDialog({ title: '操作失败', message: failure instanceof Error ? failure.message : '请稍后再试', tone: 'error' }); }
    finally { setBusy(false); }
  };
  const clear = () => showAppDialog({ title: '清空聊天摘要？', message: '这会删除全部摘要，并从当前聊天边界开始总结新消息。AI 不会重新补回刚清空的旧摘要。', buttons: [
    { text: '取消', style: 'cancel' }, { text: '清空摘要', style: 'destructive', onPress: () => { void run(() => clearChatSummary(conversationId)); } },
  ] });
  return <SafeAreaView style={styles.screen}>
    <NavigationHeader
      title="聊天摘要"
      help={{ sections: SUMMARY_HELP_SECTIONS }}
      onGoBack={() => { if (!busy) onBack(); }}
      rightButton={<Pressable accessibilityLabel="新增摘要" disabled={busy} onPress={onCreateSummary}><Plus size={24} color={theme.colors.brand.primary} /></Pressable>}
    />
    <ScrollView contentContainerStyle={styles.content}>
      {error && <Text style={styles.danger}>{error}</Text>}
      {!segments && !error && <ActivityIndicator color={theme.colors.brand.primary} />}
      {segments?.map((segment) => <Pressable key={segment.id} style={styles.card} disabled={busy} onPress={() => onEditSummary(segment.id)}>
        <Text style={styles.body}>{segment.content}</Text>
        <Text style={styles.meta}>{segment.sourceStartAt && segment.sourceEndAt ? '讨论时间 ' + new Date(segment.sourceStartAt).toLocaleString('zh-CN', { timeZone: segment.timeZone }) + ' — ' + new Date(segment.sourceEndAt).toLocaleString('zh-CN', { timeZone: segment.timeZone }) + ' · ' + segment.timeZone : '手动记录'}</Text>
        <Text style={styles.meta}>保存于 {new Date(segment.createdAt).toLocaleString()} · 点击编辑</Text>
      </Pressable>)}
      {segments?.length === 0 && <Text style={styles.subtitle}>还没有摘要。你可以手动添加，或继续聊天，AI 会在满足批次条件后追加。</Text>}
      {!!segments?.length && <Pressable disabled={busy} onPress={clear}><Text style={styles.danger}>清空全部摘要</Text></Pressable>}
    </ScrollView>
  </SafeAreaView>;
}
