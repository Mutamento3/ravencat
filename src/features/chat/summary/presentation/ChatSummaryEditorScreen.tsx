/** 摘要编辑拥有独立路由草稿，保存后返回原摘要列表。 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemedStyles } from '@shared/theme';
import { NavigationHeader, useBusyBackHandler, showAppDialog } from '@shared/ui';
import { createChatSummary, deleteChatSummary, editChatSummary, getChatSummaryContext } from '../application/ChatSummary';
import { createChatSummaryStyles } from './chatSummaryStyles';

export default function ChatSummaryEditorScreen({ conversationId, segmentId, onBack }: {
  conversationId: string; segmentId?: string; onBack(): void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createChatSummaryStyles);
  const editing = segmentId !== undefined;
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(editing);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useBusyBackHandler(busy);
  useEffect(() => {
    if (segmentId === undefined) return;
    let active = true;
    void getChatSummaryContext(conversationId).then((snapshot) => {
      if (!active) return;
      const segment = snapshot.segments.find((value) => value.id === segmentId);
      if (!segment) { setError('这段摘要已不存在'); return; }
      setContent(segment.content);
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
  return <SafeAreaView style={styles.screen}><KeyboardAvoidingView style={styles.screen} behavior="height">
    <NavigationHeader title={editing ? '编辑摘要' : '新增摘要'} onGoBack={() => { if (!busy) onBack(); }} rightButton={<Pressable disabled={loading || !!error || busy || !content.trim()} onPress={() => { void run(() => editing ? editChatSummary(conversationId, segmentId!, content) : createChatSummary(conversationId, content)); }}><Text style={styles.action}>{busy ? '保存中' : '保存'}</Text></Pressable>} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {loading ? <ActivityIndicator color={theme.colors.brand.primary} /> : error ? <Text style={styles.danger}>{error}</Text> : <>
        <TextInput multiline style={styles.editor} value={content} onChangeText={setContent} editable={!busy} placeholder="写下希望长期保留的聊天摘要…" placeholderTextColor={theme.colors.text.tertiary} /><Text style={styles.meta}>修改旧段会改变后续上下文里的对应内容。</Text>
          {editing && <Pressable disabled={busy} onPress={() => showAppDialog({ title: '删除这段摘要？', message: 'AI 不会自动补回这段已处理的摘要。', buttons: [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { void run(() => deleteChatSummary(conversationId, segmentId!)); } }] })}><Text style={styles.danger}>删除这段摘要</Text></Pressable>}
      </>}
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
