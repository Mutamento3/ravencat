/** 触发词关系页按路由指定的空间与触发词维护独立开关。 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { memorySearchText, normalizeMemoryText, type PassiveTriggerMemory } from '../domain/Memory';
import { listMemoryTriggerEntries } from '../application/MemoryQueries';
import { deleteMemoryTrigger, setMemoryAutoRecall } from '../application/MemoryCommands';
import { useTheme, useThemedStyles } from '@shared/theme';
import { NavigationHeader, Toggle, useBusyBackHandler, showAppDialog } from '@shared/ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createMemoryScreenStyles } from './memoryScreenStyles';
import useMemoryManagementSnapshot from './useMemoryManagementSnapshot';
export default function MemoryTriggerScreen({ assistantId, triggerId, onBack }: {
  assistantId: string; triggerId: string; onBack(): void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createMemoryScreenStyles);
  const { snapshot, error } = useMemoryManagementSnapshot(assistantId);
  const trigger = snapshot?.triggers.find((value) => value.id === triggerId);
  const [relations, setRelations] = useState<PassiveTriggerMemory[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(true);
  const [relationsError, setRelationsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  useBusyBackHandler(busy);
  useEffect(() => {
    if (!trigger) return;
    let active = true;
    setRelationsLoading(true);
    void listMemoryTriggerEntries(assistantId, trigger.id).then((values) => {
      if (active) { setRelations(values); setRelationsError(null); }
    }).catch((failure) => {
      if (active) setRelationsError(failure instanceof Error ? failure.message : '读取关联记忆失败');
    }).finally(() => { if (active) setRelationsLoading(false); });
    return () => { active = false; };
  }, [assistantId, trigger]);
  const run = async (operation: () => Promise<unknown>, close = false) => {
    setBusy(true);
    try { await operation(); if (close) onBack(); }
    catch (failure) { showAppDialog({ title: '操作失败', message: failure instanceof Error ? failure.message : '请稍后重试', tone: 'error' }); }
    finally { setBusy(false); }
  };
  const associatedIds = new Set(relations.map((relation) => relation.memory.id));
  const candidates = (snapshot?.entries ?? []).filter((entry) => !associatedIds.has(entry.id)
    && normalizeMemoryText(memorySearchText(entry)).includes(normalizeMemoryText(query)));
  const rows: PassiveTriggerMemory[] = adding ? candidates.map((memory) => ({ memory, autoRecall: false })) : relations;
  return <SafeAreaView style={styles.screen}>
    <NavigationHeader title={trigger?.keyword ?? '触发词'} onGoBack={() => { if (!busy) onBack(); }} />
    <FlatList data={trigger && !relationsLoading && !relationsError ? rows : []} keyExtractor={(relation) => relation.memory.id}
      keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
      ListHeaderComponent={<>
      {error && <Text style={styles.danger}>{error}</Text>}
      {!snapshot && !error && <ActivityIndicator color={theme.colors.brand.primary} />}
      {snapshot && !trigger && <Text style={styles.subtitle}>这个触发词已不存在。</Text>}
      {trigger && <>
        <Text style={styles.subtitle}>可以关联任意记忆，正文和摘要不必包含“{trigger.keyword}”。关闭一条记忆只影响这个词，其他触发词仍可自动带入它。</Text>
        <Pressable disabled={busy || relationsLoading || !!relationsError} onPress={() => { setAdding(!adding); setQuery(''); }}><Text style={styles.action}>{adding ? '返回关联列表' : '添加关联记忆'}</Text></Pressable>
        {adding && <TextInput accessibilityLabel="查找要关联的记忆" style={styles.input} value={query} onChangeText={setQuery} placeholder="查找要关联的记忆" placeholderTextColor={theme.colors.text.tertiary} />}
        {relationsLoading ? <ActivityIndicator color={theme.colors.brand.primary} /> : relationsError ? <Text style={styles.danger}>{relationsError}</Text> : rows.length === 0 && <Text style={styles.subtitle}>{adding ? '没有可添加的记忆。' : '目前没有关联记忆，可以手动添加。'}</Text>}
      </>}
      </>}
      renderItem={({ item: relation }) => <View style={styles.card}>
        {relation.memory.summary && <Text style={styles.meta}>{relation.memory.summary}</Text>}
        <Text style={styles.body}>{relation.memory.content}</Text>
        {adding ? <Pressable disabled={busy} onPress={() => { void run(() => setMemoryAutoRecall(assistantId, triggerId, relation.memory.id, true)); }}><Text style={styles.action}>关联并开启自动带入</Text></Pressable>
          : <View style={styles.row}><Text style={styles.meta}>自动带入</Text><Toggle accessibilityLabel="自动带入关联记忆" disabled={busy} value={relation.autoRecall} onValueChange={(value) => { void run(() => setMemoryAutoRecall(assistantId, triggerId, relation.memory.id, value)); }} /></View>}
      </View>}
      ListFooterComponent={trigger ? <Pressable disabled={busy} onPress={() => { void run(() => deleteMemoryTrigger(assistantId, trigger.id), true); }}><Text style={styles.danger}>删除触发词</Text></Pressable> : null}
    />
  </SafeAreaView>;
}
