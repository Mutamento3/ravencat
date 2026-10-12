/** 重试按钮只提交意图，执行属于会话队列，用户可立即离开详情页。 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationHeader } from '@shared/ui';
import { useTheme, useThemedStyles } from '@shared/theme';
import { retryChatSummaryTask } from '../application/ChatSummary';
import { useChatSummarySnapshot } from './useChatSummarySnapshot';
import { createChatSummaryStyles } from './chatSummaryStyles';
import ChatSummaryDiagnostics from './ChatSummaryDiagnostics';

export default function ChatSummaryTaskScreen({ conversationId, taskId, onBack, onSettings, onEditSummary, onEditSecondary }: {
  conversationId: string; taskId: string; onBack(): void; onSettings(): void; onEditSummary(segmentId: string): void; onEditSecondary(): void;
}) {
  const theme = useTheme(), styles = useThemedStyles(createChatSummaryStyles);
  const { snapshot, error } = useChatSummarySnapshot(conversationId);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const task = snapshot?.tasks.find((value) => value.id === taskId);
  const retry = async () => {
    setRetrying(true); setRetryError(null);
    try { await retryChatSummaryTask(conversationId, taskId); }
    catch (failure) { setRetryError(failure instanceof Error ? failure.message : '重试未能提交'); }
    finally { setRetrying(false); }
  };
  return <SafeAreaView style={styles.screen}>
    <NavigationHeader title={task?.level === 'secondary' ? '二级摘要任务' : '一级摘要任务'} onGoBack={onBack} />
    <ScrollView contentContainerStyle={styles.content}>
      {(error || retryError) && <Text style={styles.danger}>{error || retryError}</Text>}
      {!snapshot && !error && <ActivityIndicator color={theme.colors.brand.primary} />}
      {snapshot && !task && <Text style={styles.danger}>这个摘要任务已不存在。</Text>}
      {task && <>
        <Text style={styles.body}>{task.status === 'running' ? '生成中' : task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败，等待处理' : '等待处理'}</Text>
        <ChatSummaryDiagnostics task={task} />
        {['waiting', 'failed'].includes(task.status) && <Pressable accessibilityLabel="重试摘要任务" disabled={retrying} onPress={() => { void retry(); }}><Text style={styles.action}>重试</Text></Pressable>}
        <Pressable accessibilityLabel="打开摘要设置" onPress={onSettings}><Text style={styles.action}>摘要设置</Text></Pressable>
        {task.level === 'secondary' && task.status === 'completed' ? <Pressable onPress={onEditSecondary}><Text style={styles.action}>查看二级摘要</Text></Pressable>
          : task.segmentIds.filter((id) => snapshot!.segments.some((segment) => segment.id === id)).map((id) => <Pressable key={id} onPress={() => onEditSummary(id)}><Text style={styles.action}>查看生成的摘要</Text></Pressable>)}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
