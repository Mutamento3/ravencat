/** 摘要编辑拥有独立路由草稿，保存后返回原摘要列表。 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { KeyboardAvoidingContainer, NavigationHeader, useBusyBackHandler, showAppDialog } from '@shared/ui';
import { createChatSummary, deleteChatSummary, editChatSummary, getChatSummaryContext } from '../application/ChatSummary';
import { createChatSummaryStyles } from './chatSummaryStyles';
import type { ChatSummaryTask } from '../domain/ChatSummaryRepository';
import ChatSummaryDiagnostics from './ChatSummaryDiagnostics';
import ChatSecondarySummaryScreen from './ChatSecondarySummaryScreen';

export default function ChatSummaryEditorScreen({ conversationId, segmentId, onBack, onEditSource }: {
  conversationId: string; segmentId?: string; onBack(): void; onEditSource(id: string): void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createChatSummaryStyles);
  const editing = segmentId !== undefined;
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(editing);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<'primary' | 'secondary'>('primary');
  const [task, setTask] = useState<ChatSummaryTask | null>(null);
  useBusyBackHandler(busy);
  useEffect(() => {
    if (segmentId === undefined) return;
    let active = true;
    void getChatSummaryContext(conversationId).then((snapshot) => {
      if (!active) return;
      const segment = snapshot.segments.find((value) => value.id === segmentId);
      if (!segment) { setError('这段摘要已不存在'); return; }
      setContent(segment.content);
      setLevel(segment.level);
      setTask(snapshot.tasks.find((value) => value.segmentIds.includes(segment.id)) ?? null);
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : '读取摘要失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversationId, segmentId]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); onBack(); }
    catch (failure) { showAppDialog({ title: '操作失败', message: failure instanceof Error ? failure.message : '请稍后再试', tone: 'error' }); }
    finally { setBusy(false); }
  };
  if (level === 'secondary' && !loading && !error) return <ChatSecondarySummaryScreen conversationId={conversationId} onBack={onBack} onEditSource={onEditSource} />;
  return <SafeAreaView style={styles.screen}><KeyboardAvoidingContainer style={styles.screen}>
    <NavigationHeader title={editing ? '编辑摘要' : '新增摘要'} onGoBack={() => { if (!busy) onBack(); }} rightButton={<Pressable disabled={loading || !!error || busy || !content.trim()} onPress={() => { void run(() => editing ? editChatSummary(conversationId, segmentId!, content) : createChatSummary(conversationId, content)); }}><Text style={styles.action}>{busy ? '保存中' : '保存'}</Text></Pressable>} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {loading ? <ActivityIndicator color={theme.colors.brand.primary} /> : error ? <Text style={styles.danger}>{error}</Text> : <>
        <ThemedSurface variant="card" nativeGlass={false} style={styles.card}>
          <TextInput multiline style={styles.editor} value={content} onChangeText={setContent} editable={!busy} placeholder="写下希望长期保留的聊天摘要…" placeholderTextColor={theme.colors.text.secondary} />
          <Text style={styles.meta}>修改这条一级摘要不会自动更新二级正文，需要同步时请分别修改。</Text>
        </ThemedSurface>
          {editing && <Pressable disabled={busy} onPress={() => showAppDialog({ title: '删除这段摘要？', message: 'AI 不会自动补回这段已处理的摘要。', buttons: [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { void run(() => deleteChatSummary(conversationId, segmentId!)); } }] })}><Text style={styles.danger}>删除这段摘要</Text></Pressable>}
          {task && <ChatSummaryDiagnostics task={task} />}
          {!task && editing && <Text style={styles.meta}>这条摘要没有调用用量记录（手动记录或旧版本生成）。</Text>}
      </>}
    </ScrollView>
  </KeyboardAvoidingContainer></SafeAreaView>;
}
