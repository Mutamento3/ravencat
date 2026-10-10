/** 召回设置与全局向量模型选择集中在记忆设置入口。 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ACTIVE_RECALL_PAGE_SIZE_OPTIONS, PASSIVE_RECALL_LIMIT_OPTIONS } from '../domain/Memory';
import { setMemoryRecallSettings } from '../application/MemoryCommands';
import MemoryEmbeddingModelPicker from './MemoryEmbeddingModelPicker';
import { useTheme, useThemedStyles } from '@shared/theme';
import { NavigationHeader, useBusyBackHandler, showAppDialog } from '@shared/ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createMemoryScreenStyles } from './memoryScreenStyles';
import useMemoryManagementSnapshot from './useMemoryManagementSnapshot';
export default function MemorySettingsScreen({ assistantId, onBack, onManageModels }: {
  assistantId?: string; onBack(): void; onManageModels(): void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createMemoryScreenStyles);
  const { snapshot, error } = useMemoryManagementSnapshot(assistantId);
  const selected = snapshot?.selectedSpace;
  const [busy, setBusy] = useState(false);
  useBusyBackHandler(busy);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try { await operation(); }
    catch (failure) { showAppDialog({ title: '操作失败', message: failure instanceof Error ? failure.message : '请稍后重试', tone: 'error' }); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.screen}>
    <NavigationHeader title="记忆设置" onGoBack={() => { if (!busy) onBack(); }} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {error && <Text style={styles.danger}>{error}</Text>}
      {!snapshot && !error && <ActivityIndicator color={theme.colors.brand.primary} />}
      {selected && snapshot?.settings && <>

            <Text style={styles.label}>自动带入数量</Text><Text style={styles.subtitle}>只由本次输入命中的触发词决定。选择 0 可关闭自动带入。</Text>
            <View style={styles.wrap}>{PASSIVE_RECALL_LIMIT_OPTIONS.map((value) => <Pressable key={value} disabled={busy} style={[styles.chip, snapshot.settings!.passiveLimit === value && styles.selectedChip]} onPress={() => { void run(() => setMemoryRecallSettings(selected.assistantId, { ...snapshot.settings!, passiveLimit: value })); }}><Text style={styles.body}>{value}</Text></Pressable>)}</View>
            <Text style={styles.label}>AI 主动查询每页数量</Text><Text style={styles.subtitle}>AI 可以继续翻页，完整读取召回结果。</Text>
            <View style={styles.wrap}>{ACTIVE_RECALL_PAGE_SIZE_OPTIONS.map((value) => <Pressable key={value} disabled={busy} style={[styles.chip, snapshot.settings!.activePageSize === value && styles.selectedChip]} onPress={() => { void run(() => setMemoryRecallSettings(selected.assistantId, { ...snapshot.settings!, activePageSize: value })); }}><Text style={styles.body}>{value}</Text></Pressable>)}</View>

      </>}
      <View style={styles.divider} /><MemoryEmbeddingModelPicker onManageModels={onManageModels} />
    </ScrollView>
  </SafeAreaView>;
}
