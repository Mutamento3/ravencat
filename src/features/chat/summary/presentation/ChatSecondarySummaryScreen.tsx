/** 二级正文合成一个草稿；来源按时间排列，编辑来源不改写二级正文。 */
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { NavigationHeader, showAppDialog, useBusyBackHandler } from '@shared/ui';
import { deleteCombinedSecondarySummary, editCombinedSecondarySummary } from '../application/ChatSummary';
import type { ChatSummarySnapshot } from '../domain/ChatSummaryRepository';
import ChatSummaryDiagnostics from './ChatSummaryDiagnostics';
import { createChatSummaryStyles } from './chatSummaryStyles';
import { useChatSummarySnapshot } from './useChatSummarySnapshot';

interface Props { conversationId: string; onBack(): void; onEditSource(id: string): void }
function SecondarySummaryEditor({ conversationId, onBack, onEditSource, snapshot, readError }: Props & { snapshot: ChatSummarySnapshot; readError: string | null }) {
  const theme = useTheme(), styles = useThemedStyles(createChatSummaryStyles);
  // 页面事件只刷新来源和调用事实，不能用模型的新结果覆盖尚未保存的正文草稿。
  const [originals] = useState(() => snapshot.segments.filter((value) => value.level === 'secondary').sort((a, b) => a.contextSequence - b.contextSequence));
  const [content, setContent] = useState(() => originals.map((value) => value.content).join('\n\n'));
  const sources = snapshot.segments.filter((value) => value.level === 'primary' && value.compactionId !== null)
    .sort((a, b) => (a.sourceStartAt ?? a.createdAt).localeCompare(b.sourceStartAt ?? b.createdAt) || a.sequence - b.sequence);
  const tasks = snapshot.tasks.filter((value) => value.level === 'secondary' && value.status === 'completed');
  const [busy, setBusy] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showCalls, setShowCalls] = useState(false);
  useBusyBackHandler(busy);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); onBack(); }
    catch (failure) { showAppDialog({ title: '操作失败', message: failure instanceof Error ? failure.message : '请稍后再试', tone: 'error' }); }
    finally { setBusy(false); }
  };
  const deleteAll = () => showAppDialog({ title: '删除二级摘要正文？', message: '删除全部二级正文，保留已归纳的一级记录和调用信息；不会恢复原摘要的自动注入。', buttons: [
    { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { void run(() => deleteCombinedSecondarySummary(conversationId, originals)); } },
  ] });
  return <SafeAreaView style={styles.screen}><KeyboardAvoidingView style={styles.screen} behavior="height">
    <NavigationHeader title="二级摘要" onGoBack={() => { if (!busy) onBack(); }} rightButton={<Pressable style={styles.textButton}
      accessibilityLabel="保存二级摘要" disabled={busy || !originals.length || !content.trim()}
      onPress={() => { void run(() => editCombinedSecondarySummary(conversationId, originals, content)); }}><Text style={styles.action}>{busy ? '保存中' : '保存'}</Text></Pressable>} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {readError && <Text style={styles.danger}>{readError}</Text>}
        {originals.length > 0 ? <ThemedSurface variant="card" style={styles.card}>
          <TextInput accessibilityLabel="二级摘要正文" multiline style={styles.editor} value={content} onChangeText={setContent} editable={!busy} />
          <Text style={styles.meta}>所有归纳内容在这里一起编辑，修改不会自动更新下方的原摘要。</Text>
        </ThemedSurface> : <Text style={styles.meta}>暂无二级正文，已归纳的原摘要仍保留在下方。</Text>}
        {sources.length > 0 && <ThemedSurface variant="card" style={styles.card}>
          <Pressable accessibilityLabel="展开已归纳原摘要" accessibilityState={{ expanded: showSources }} style={[styles.textButton, styles.row]} onPress={() => setShowSources(!showSources)}>
            <Text style={styles.cardTitle}>原摘要 · {sources.length} 条</Text>{showSources ? <ChevronDown size={18} color={theme.colors.text.secondary} /> : <ChevronRight size={18} color={theme.colors.text.secondary} />}
          </Pressable>
          {showSources && sources.map((source) => <Pressable key={source.id} accessibilityLabel={`编辑原摘要：${source.content.slice(0, 30)}`} disabled={busy} style={styles.sourceRow} onPress={() => onEditSource(source.id)}>
            <View style={styles.row}><Text style={styles.meta}>保存于 {new Date(source.createdAt).toLocaleString()}</Text><ChevronRight size={16} color={theme.colors.text.secondary} /></View>
            <Text numberOfLines={3} style={styles.body}>{source.content}</Text>
          </Pressable>)}
        </ThemedSurface>}
        {tasks.length > 0 && <>
          <Pressable accessibilityLabel="展开二级摘要调用记录" accessibilityState={{ expanded: showCalls }} style={[styles.textButton, styles.row]} onPress={() => setShowCalls(!showCalls)}>
            <Text style={styles.sectionLabel}>调用记录 · {tasks.length} 次归纳</Text>{showCalls ? <ChevronDown size={18} color={theme.colors.text.secondary} /> : <ChevronRight size={18} color={theme.colors.text.secondary} />}
          </Pressable>
          {showCalls && tasks.map((task) => <ChatSummaryDiagnostics key={task.id} task={task} />)}
        </>}
        {originals.length > 0 && <Pressable style={styles.textButton} disabled={busy} onPress={deleteAll}><Text style={styles.danger}>删除二级摘要正文</Text></Pressable>}
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
export default function ChatSecondarySummaryScreen(props: Props) {
  const theme = useTheme(), styles = useThemedStyles(createChatSummaryStyles);
  const { snapshot, error } = useChatSummarySnapshot(props.conversationId);
  if (snapshot) return <SecondarySummaryEditor key={props.conversationId} {...props} snapshot={snapshot} readError={error} />;
  return <SafeAreaView style={styles.screen}>
    <NavigationHeader title="二级摘要" onGoBack={props.onBack} />
    {error ? <Text style={styles.danger}>{error}</Text> : <ActivityIndicator color={theme.colors.brand.primary} />}
  </SafeAreaView>;
}
