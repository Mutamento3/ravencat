/** 面板复用 Memory 的查询和命令，星空不拥有记忆事实或路由。 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, Plus, Search, X } from 'lucide-react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import { normalizeMemoryText, memorySearchText } from '../domain/Memory';
import { addMemoryTrigger } from '../application/MemoryCommands';
import type { MemoryManagementSnapshot } from '../application/MemoryQueries';
import { createMemoryGalaxyStyles } from './memoryGalaxyStyles';

export default function MemorySpacePanel({ visible, snapshot, error, busy, refreshing, refresh, onClose, onCreateMemory, onEditMemory, onOpenTrigger, run }: {
  visible: boolean; snapshot: MemoryManagementSnapshot | null; error: string | null; busy: boolean; refreshing: boolean;
  refresh(): void; onClose(): void; onCreateMemory(assistantId: string): void;
  onEditMemory(assistantId: string, memoryId: string): void;
  onOpenTrigger(assistantId: string, triggerId: string): void;
  run(operation: () => Promise<unknown>): Promise<void>;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createMemoryGalaxyStyles);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'entries' | 'triggers'>('entries');
  const [triggerInput, setTriggerInput] = useState('');
  const selected = snapshot?.selectedSpace;
  const filtered = useMemo(() => {
    const normalized = normalizeMemoryText(query);
    return snapshot?.entries.filter(entry => normalizeMemoryText(memorySearchText(entry)).includes(normalized)) ?? [];
  }, [snapshot, query]);

  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView style={styles.modal} behavior="height">
      <Pressable style={styles.scrim} accessibilityRole="button" accessibilityLabel="收起记忆面板" onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetName}>{selected ? selected.assistantName : '记忆空间'}</Text>
            {snapshot && <Text style={styles.sheetMeta}>{snapshot.entries.length} 段记忆 · {snapshot.triggers.length} 个触发词{selected?.isHost ? ' · 主理' : ''}</Text>}
          </View>
          {selected && tab === 'entries' && <Pressable accessibilityRole="button" accessibilityLabel="新建记忆" style={styles.sheetButton} disabled={busy} onPress={() => onCreateMemory(selected.assistantId)}><Plus size={24} color={theme.colors.brand.primary} /></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="收起记忆面板" style={styles.sheetButton} onPress={onClose}><X size={20} color={theme.colors.text.secondary} /></Pressable>
        </View>
        {error && <><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="重新读取记忆" onPress={refresh}><Text style={[styles.activeTabText, { textAlign: 'center' }]}>重新读取</Text></Pressable></>}
        {!snapshot && !error && <ActivityIndicator color={theme.colors.brand.primary} />}
        {snapshot && selected && <>
          <View style={styles.tabs}>
            {(['entries', 'triggers'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} style={[styles.tab, tab === value && styles.selectedTab]} onPress={() => setTab(value)}><Text style={tab === value ? styles.activeTabText : styles.tabText}>{value === 'entries' ? '记忆' : '触发词'}</Text></Pressable>)}
          </View>
          {tab === 'entries' ? <>
            <View style={styles.search}><Search size={17} color={theme.colors.text.secondary} /><TextInput accessibilityLabel="查找记忆里的文字" style={styles.input} value={query} onChangeText={setQuery} placeholder="查找记忆里的文字" placeholderTextColor={theme.colors.text.secondary} /></View>
            <FlatList key="entries" data={filtered} keyExtractor={entry => entry.id} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" refreshing={refreshing} onRefresh={refresh} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
              renderItem={({ item: entry }) => <Pressable accessibilityRole="button" style={styles.card} disabled={busy} onPress={() => onEditMemory(selected.assistantId, entry.id)}>
                {entry.summary && <Text style={styles.meta} numberOfLines={2}>{entry.summary}</Text>}
                <Text style={styles.body} numberOfLines={4}>{entry.content}</Text>
                <View style={styles.row}><Text style={styles.meta}>{new Date(entry.rememberedAt).toLocaleDateString()}{entry.embeddingStatus === 'failed' ? ' · 向量更新失败' : ''}</Text><ChevronRight size={16} color={theme.colors.text.secondary} /></View>
              </Pressable>}
              ListEmptyComponent={<Text style={styles.meta}>{query ? '没有包含这些文字的记忆。' : '这里还没有记忆。点右上角加号，留下第一件重要的事。'}</Text>} />
          </> : <>
            <Text style={styles.description}>本次输入命中任一触发词时，自动带入关联记忆。正文或摘要包含它时自动关联，也可进入触发词手动选择其他记忆。多个词用逗号、顿号、分号或换行分隔。</Text>
            <View style={styles.search}><TextInput accessibilityLabel="添加多个触发词" style={styles.input} value={triggerInput} onChangeText={setTriggerInput} placeholder="触发词，触发词…" placeholderTextColor={theme.colors.text.secondary} /><Pressable accessibilityRole="button" accessibilityLabel="保存触发词" style={styles.sheetButton} disabled={busy || !triggerInput.trim()} onPress={() => { void run(async () => { await addMemoryTrigger(selected.assistantId, triggerInput); setTriggerInput(''); }); }}><Plus size={22} color={theme.colors.brand.primary} /></Pressable></View>
            <FlatList key="triggers" data={snapshot.triggers} keyExtractor={trigger => trigger.id} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" refreshing={refreshing} onRefresh={refresh} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
              renderItem={({ item: trigger }) => <Pressable accessibilityRole="button" disabled={busy} style={styles.card} onPress={() => onOpenTrigger(selected.assistantId, trigger.id)}><View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.body}>{trigger.keyword}</Text><Text style={styles.meta}>{trigger.associatedCount} 条关联 · {trigger.enabledCount} 条自动带入</Text></View><ChevronRight size={18} color={theme.colors.text.secondary} /></View></Pressable>}
              ListEmptyComponent={<Text style={styles.meta}>添加一个触发词，让有关的记忆在聊天时浮现。</Text>} />
          </>}
        </>}
      </SafeAreaView>
    </KeyboardAvoidingView>
  </Modal>;
}
