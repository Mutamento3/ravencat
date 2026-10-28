/** 关联组拥有词集合、文本关联规则和记忆开关；路由只传空间与组 ID。 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { memorySearchText, normalizeMemoryText, type PassiveTriggerMemory } from '../domain/Memory';
import { listMemoryTriggerEntries } from '../application/MemoryQueries';
import { deleteMemoryTrigger, editMemoryTrigger, setMemoryAutoRecall } from '../application/MemoryCommands';
import { useTheme, useThemedStyles } from '@shared/theme';
import { NavigationHeader, ToggleField, useBusyBackHandler, showAppDialog } from '@shared/ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react-native';
import { createMemoryScreenStyles } from './memoryScreenStyles';
import useMemoryManagementSnapshot from './useMemoryManagementSnapshot';

const TRIGGER_HELP = { sections: [
  { title: '触发与开关', body: '命中本组任一触发词，带入本组开启的记忆。关闭只影响本组，其他组仍可带入同一条记忆。' },
  { title: '按文本自动关联', body: '正文或摘要包含本组任一词时自动关联，并随文本变化更新。手动添加的关联始终保留。' },
] };

function TriggerMemoryCard({ relation, adding, busy, onAssociate, onToggle }: {
  relation: PassiveTriggerMemory; adding: boolean; busy: boolean;
  onAssociate(): void; onToggle(value: boolean): void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createMemoryScreenStyles);
  const [expanded, setExpanded] = useState(false);
  // 长正文先展示预览，开关始终位于卡片顶部，避免被正文推到屏幕之外。
  const longContent = Array.from(relation.memory.content).length > 120;
  return <View style={styles.card}>
    {adding ? <View style={styles.row}>
      {relation.memory.summary ? <Text style={[styles.label, styles.grow]}>{relation.memory.summary}</Text> : <View style={styles.grow} />}
      <Pressable accessibilityRole="button" accessibilityLabel="关联这条记忆" disabled={busy} style={styles.triggerAction} onPress={onAssociate}>
        <Plus size={16} color={theme.colors.brand.primary} /><Text style={styles.action}>关联</Text>
      </Pressable>
    </View> : <ToggleField layout="inline" rowStyle={styles.row} label="自动带入关联记忆" disabled={busy} value={relation.autoRecall} onValueChange={onToggle}>
      <Text style={[styles.label, styles.grow]}>{relation.memory.summary ?? '自动带入'}</Text>
    </ToggleField>}
    <Text style={styles.body} numberOfLines={longContent && !expanded ? 4 : undefined}>{relation.memory.content}</Text>
    {longContent && <Pressable accessibilityRole="button" accessibilityState={{ expanded }} style={styles.triggerAction} onPress={() => setExpanded(!expanded)}>
      <Text style={styles.action}>{expanded ? '收起' : '展开全文'}</Text>
      {expanded ? <ChevronUp size={16} color={theme.colors.brand.primary} /> : <ChevronDown size={16} color={theme.colors.brand.primary} />}
    </Pressable>}
  </View>;
}

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
  const [editingGroup, setEditingGroup] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const [autoAssociate, setAutoAssociate] = useState(false);
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
  const beginEditing = () => {
    setKeywordInput(trigger!.keywords.map(word => word.keyword).join('、'));
    setAutoAssociate(trigger!.autoAssociate); setEditingGroup(true); setAdding(false); setQuery('');
  };
  const saveGroup = () => { void run(async () => {
    await editMemoryTrigger(assistantId, triggerId, keywordInput, autoAssociate); setEditingGroup(false);
  }); };
  return <SafeAreaView style={styles.screen}>
    <NavigationHeader title="关联组" help={TRIGGER_HELP} onGoBack={() => { if (!busy) onBack(); }}
      rightButton={trigger && <Pressable accessibilityRole="button" accessibilityLabel={editingGroup ? '保存关联组' : '编辑关联组'}
        disabled={busy || (editingGroup && !keywordInput.trim())} style={[styles.triggerAction, (busy || (editingGroup && !keywordInput.trim())) && styles.disabled]}
        onPress={editingGroup ? saveGroup : beginEditing}><Text style={styles.action}>{busy && editingGroup ? '保存中' : editingGroup ? '保存' : '编辑'}</Text></Pressable>} />
    <FlatList data={trigger && !relationsLoading && !relationsError ? rows : []} keyExtractor={(relation) => relation.memory.id}
      keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
      ListHeaderComponent={<View style={styles.triggerHeader}>
      {error && <Text style={styles.danger}>{error}</Text>}
      {!snapshot && !error && <ActivityIndicator color={theme.colors.brand.primary} />}
      {snapshot && !trigger && <Text style={styles.subtitle}>这个关联组已不存在。</Text>}
      {trigger && <>
        {editingGroup ? <View style={styles.card}>
          <View style={styles.row}><Text style={styles.label}>触发词</Text><Pressable accessibilityRole="button" disabled={busy} style={styles.triggerAction} onPress={() => setEditingGroup(false)}><Text style={styles.action}>取消</Text></Pressable></View>
          <TextInput multiline accessibilityLabel="编辑关联组的触发词" style={styles.input} value={keywordInput} onChangeText={setKeywordInput} editable={!busy} placeholder="多个词用逗号、顿号、分号或换行分隔" placeholderTextColor={theme.colors.text.tertiary} />
          <ToggleField layout="inline" rowStyle={styles.row} label="按文本自动关联" accessibilityLabel="自动关联包含触发词的记忆" disabled={busy} value={autoAssociate} onValueChange={setAutoAssociate}>
            <Text style={[styles.body, styles.grow]}>按文本自动关联</Text>
          </ToggleField>
        </View> : <View style={styles.card}>
          <Text style={styles.triggerTitle}>{trigger.keywords.map(word => word.keyword).join('、')}</Text>
          <Text style={styles.meta}>{trigger.autoAssociate ? '按正文或摘要自动关联' : '手动关联'}</Text>
        </View>}
        <View style={styles.row}>
          <Text style={styles.label}>{adding ? '选择记忆' : `关联记忆 · ${trigger.associatedCount}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={adding ? '完成添加关联记忆' : '添加关联记忆'}
            disabled={busy || editingGroup || relationsLoading || !!relationsError}
            style={[styles.triggerAction, (busy || editingGroup || relationsLoading || !!relationsError) && styles.disabled]}
            onPress={() => { setAdding(!adding); setQuery(''); }}>{!adding && <Plus size={16} color={theme.colors.brand.primary} />}<Text style={styles.action}>{adding ? '完成' : '添加'}</Text></Pressable>
        </View>
        {adding && <TextInput accessibilityLabel="查找要关联的记忆" style={styles.input} value={query} onChangeText={setQuery} placeholder="查找要关联的记忆" placeholderTextColor={theme.colors.text.tertiary} />}
        {relationsLoading ? <ActivityIndicator color={theme.colors.brand.primary} /> : relationsError ? <Text style={styles.danger}>{relationsError}</Text> : rows.length === 0 && <Text style={styles.subtitle}>{adding ? '没有可添加的记忆。' : '目前没有关联记忆，可以手动添加。'}</Text>}
      </>}
      </View>}
      renderItem={({ item: relation }) => <TriggerMemoryCard relation={relation} adding={adding} busy={busy}
        onAssociate={() => { void run(() => setMemoryAutoRecall(assistantId, triggerId, relation.memory.id, true)); }}
        onToggle={(value) => { void run(() => setMemoryAutoRecall(assistantId, triggerId, relation.memory.id, value)); }} />}
      ListFooterComponent={trigger ? <Pressable accessibilityRole="button" style={styles.triggerFooter} disabled={busy} onPress={() => showAppDialog({ title: '删除关联组？', message: '删除本组的触发词和关联，记忆正文会保留。', buttons: [
        { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { void run(() => deleteMemoryTrigger(assistantId, trigger.id), true); } },
      ] })}><Text style={styles.danger}>删除关联组</Text></Pressable> : null}
    />
  </SafeAreaView>;
}
