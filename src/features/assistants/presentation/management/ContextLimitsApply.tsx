/** 快捷操作复制当前四项数值；之后各AI仍独立编辑。 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { ModalSheet, showAppDialog } from '@shared/ui';
import { useThemedStyles, type PresentationTheme } from '@shared/theme';
import { applyAssistantContextLimits, listAIAssistantSummaries } from '../../AIAssistantManagement';
import { getAssistantDisplayName } from '../../AssistantNickname';
import type { AssistantContextLimits, AIAssistantSummary } from '../../domain/AssistantRepository';

export default function ContextLimitsApply({ readSettings }: { readSettings(): Promise<AssistantContextLimits | null> }) {
  const styles = useThemedStyles(createStyles);
  const [models, setModels] = useState<AIAssistantSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState<AssistantContextLimits | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const values = await readSettings();
      if (!values) return;
      setModels(await listAIAssistantSummaries()); setSelected([]); setSettings(values);
    } catch (error) { showAppDialog({ title: '读取失败', message: error instanceof Error ? error.message : '读取AI列表失败', tone: 'error' }); }
    finally { setBusy(false); }
  };
  const apply = async (ids: string[]) => {
    setBusy(true);
    try { await applyAssistantContextLimits(ids, settings!); setSettings(null); }
    catch (error) { showAppDialog({ title: '应用失败', message: error instanceof Error ? error.message : '保存失败', tone: 'error' }); }
    finally { setBusy(false); }
  };
  return <>
    <Pressable disabled={busy} onPress={() => { void open(); }} style={styles.button}><Text style={styles.action}>将四项上下文设置应用到其他AI</Text></Pressable>
    <ModalSheet visible={settings !== null} title="一次性应用上下文设置" onClose={() => { if (!busy) setSettings(null); }}>
      <Text style={styles.note}>只复制这四项条数，不复制摘要设置。应用后各AI独立修改。</Text>
      <ScrollView style={styles.list}>{models.map((ai) => <Pressable key={ai.id} disabled={busy} style={styles.button}
        onPress={() => setSelected((ids) => ids.includes(ai.id) ? ids.filter((id) => id !== ai.id) : [...ids, ai.id])}>
        <View style={styles.row}>{selected.includes(ai.id) && <Check size={16} color={styles.action.color} />}<Text style={styles.label}>{getAssistantDisplayName(ai)}</Text></View>
      </Pressable>)}</ScrollView>
      <Pressable disabled={busy || selected.length === 0} style={styles.button} onPress={() => { void apply(selected); }}><Text style={styles.action}>应用到所选（{selected.length}）</Text></Pressable>
      <Pressable disabled={busy || models.length === 0} style={styles.button} onPress={() => { void apply(models.map((ai) => ai.id)); }}><Text style={styles.action}>应用到全部AI</Text></Pressable>
    </ModalSheet>
  </>;
}
const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  button: { padding: theme.spacing.md }, action: { color: theme.colors.brand.primary }, label: { color: theme.colors.text.primary },
  note: { color: theme.colors.text.secondary, padding: theme.spacing.md }, list: { maxHeight: 360 },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
});
