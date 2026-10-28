import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { localAudioPlaybackCoordinator } from '@platform/device';
import { getAIAssistantById, getAssistantDisplayName } from '@features/assistants';
import { getCurrentUserProfile } from '@features/profile';
import { useTheme, useThemedStyles } from '@shared/theme';
import { NavigationHeader, showAppDialog } from '@shared/ui';
import { getCallHistory } from '../application/CallHistory';
import { aiCallRuntimeService } from '../application/runtime/AICallRuntimeService';
import type { CallHistoryEntry, CallHistoryRecord, CallHistoryImage } from '../domain/CallHistory';
import { createCallHistoryStyles } from './callHistoryStyles';
import CallHistoryImages from './components/CallHistoryImages';
import CallHistoryEntryCard from './components/CallHistoryEntryCard';

export default function CallHistoryDetailScreen({ assistantId, callId, onBack }: {
  assistantId: string; callId: string; onBack(): void;
}) {
  const theme = useTheme(), styles = useThemedStyles(createCallHistoryStyles);
  const [record, setRecord] = useState<CallHistoryRecord | null>(null);
  const [entries, setEntries] = useState<CallHistoryEntry[]>([]);
  const [images, setImages] = useState<CallHistoryImage[]>([]);
  const [callErrors, setCallErrors] = useState<Awaited<ReturnType<typeof getCallHistory>>['errors']>([]);
  const [names, setNames] = useState<{ user: string; ai: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scope = `call-history:${callId}`;
  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null); setRecord(null); setEntries([]); setImages([]); setCallErrors([]); setNames(null);
    void Promise.all([getCallHistory(callId, assistantId), getAIAssistantById(assistantId), getCurrentUserProfile()])
      .then(([history, assistant, user]) => {
        if (!active) return;
        if (!assistant) throw new Error('这个 AI 已被删除');
        setRecord(history.record); setEntries(history.entries); setImages(history.images);
        setCallErrors(history.errors);
        setNames({ user: user.name, ai: getAssistantDisplayName(assistant) });
      })
      .catch(failure => { if (active) setError(failure.message); });
    const unsubscribe = aiCallRuntimeService.subscribeActiveCall(() => {
      if (aiCallRuntimeService.getActiveCallSnapshot()) void localAudioPlaybackCoordinator.stop(scope);
    });
    return () => { active = false; unsubscribe(); void localAudioPlaybackCoordinator.stop(scope); };
  }, [assistantId, callId, scope]));
  const onImageDeleted = useCallback((imageId: string) => setImages(current => current.filter(image => image.id !== imageId)), []);
  const renderEntry = useCallback(({ item }: { item: CallHistoryEntry }) =>
    <CallHistoryEntryCard entry={item} speakerName={names![item.speaker]} scope={scope} />, [names, scope]);
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
    <NavigationHeader title={record?.title ?? '通话记录'} onGoBack={onBack} />
    {error ? <Text style={[styles.error, styles.content]}>{error}</Text> : !record || !names ? <ActivityIndicator color={theme.colors.brand.primary} /> :
      <FlatList data={entries} keyExtractor={entry => entry.id} contentContainerStyle={styles.content}
        ListHeaderComponent={callErrors.length > 0 ? <View>
          <Text style={styles.body}>最近通话异常</Text>
          <Text style={styles.meta}>点击查看详情，可长按详情文字复制。</Text>
          {callErrors.map(callError => <Pressable key={callError.id} style={styles.action}
            accessibilityRole="button" accessibilityLabel="查看通话异常详情"
            onPress={() => showAppDialog({ title: '通话异常详情', tone: 'error',
              message: `通话：${record.title}\n通话 ID：${callId}\n时间：${callError.createdAt}\n\n${callError.text}` })}>
            <Text style={styles.error} numberOfLines={2}>{callError.text}</Text>
          </Pressable>)}
        </View> : null}
        ListFooterComponent={<CallHistoryImages images={images} callId={callId} assistantId={assistantId} assistantName={names.ai} onDeleted={onImageDeleted} />}
        ListEmptyComponent={<Text style={styles.meta}>这通电话没有留下对话内容</Text>}
        renderItem={renderEntry} />}
  </SafeAreaView>;
}
