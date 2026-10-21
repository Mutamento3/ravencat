/** 通用模型选择展示；选择与可用性由调用方所属业务系统提供。 */
import { showAppDialog } from './appDialogStore';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { useTheme, useThemedStyles, type PresentationTheme } from '@shared/theme';
import ModalSheet from './ModalSheet';
import type { ModelSelectionSettings } from './modelSelectionTypes';

interface Props {
  title: string;
  description: string;
  unconfiguredLabel?: string;
  clearSelectionLabel?: string;
  getSettings(): Promise<ModelSelectionSettings>;
  onSelect(modelConfigId: string | null): Promise<void>;
  subscribeChanged(listener: () => void): () => void;
  onManageModels?: () => void;
}

export default function ConfiguredModelPicker({ title, description, unconfiguredLabel = '未选择模型', clearSelectionLabel = '取消选择', getSettings, onSelect, subscribeChanged, onManageModels }: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [settings, setSettings] = useState<ModelSelectionSettings | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef({ revision: 0 });
  const reload = useCallback(async () => {
    const revision = ++request.current.revision;
    setLoading(true);
    try {
      const next = await getSettings();
      if (revision === request.current.revision) { setSettings(next); setError(null); }
    } catch (failure) {
      if (revision === request.current.revision) setError(failure instanceof Error ? failure.message : '读取模型选择失败');
    } finally {
      if (revision === request.current.revision) setLoading(false);
    }
  }, [getSettings]);
  useEffect(() => {
    void reload();
    const requests = request.current;
    const unsubscribe = subscribeChanged(() => { void reload(); });
    return () => { unsubscribe(); requests.revision++; };
  }, [reload, subscribeChanged]);

  const select = async (modelConfigId: string | null) => {
    setSaving(true);
    try { await onSelect(modelConfigId); await reload(); setVisible(false); }
    catch (failure) { showAppDialog({ title: '选择失败', message: failure instanceof Error ? failure.message : '保存模型选择失败', tone: 'error' }); }
    finally { setSaving(false); }
  };
  const selectionLabel = settings?.status === 'active' ? `${settings.selectedModelName} · 配置可用`
    : settings?.status === 'unavailable' ? `${settings.selectedModelName ?? '所选模型'} · ${settings.unavailableReason}`
      : settings ? unconfiguredLabel : '无法读取当前选择';
  return <>
    <Pressable accessibilityLabel={`选择${title}`} style={styles.card} onPress={() => { setVisible(true); void reload(); }}>
      <View style={styles.row}>
        <View style={styles.grow}><Text style={styles.label}>{title}</Text><Text style={styles.subtitle}>{loading && !settings ? '正在读取…' : selectionLabel}</Text></View>
        <ChevronRight size={20} color={theme.colors.text.tertiary} />
      </View>
      {error && <Text style={styles.danger}>{error}</Text>}
    </Pressable>
    <ModalSheet visible={visible} onClose={() => { if (!saving) setVisible(false); }} title={`选择${title}`}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {!loading && !error && <Text style={styles.hint}>{description}选择后立即保存。</Text>}
        {loading ? <ActivityIndicator color={theme.colors.brand.primary} /> : error ? <>
          <Text style={styles.danger}>{error}</Text><Pressable onPress={() => { void reload(); }}><Text style={styles.action}>重新读取</Text></Pressable>
        </> : settings && <>
          {settings.status === 'unavailable' && <Text style={styles.danger}>{selectionLabel}，请检查配置或重新选择。</Text>}
          {settings.models.map((model) => <Pressable key={model.id} disabled={saving} style={styles.card} onPress={() => { void select(model.id); }}>
            <View style={styles.row}>
              <View style={styles.grow}><Text style={styles.label}>{model.name}</Text><Text style={styles.subtitle}>{model.model}</Text></View>
              {settings.selectedModelId === model.id && <Check size={20} color={theme.colors.brand.primary} />}
            </View>
          </Pressable>)}
          {settings.models.length === 0 && <Text style={styles.subtitle}>暂无配置可用的模型，请先新增或完善模型配置。</Text>}
          <Pressable disabled={saving} style={styles.card} onPress={() => { void select(null); }}>
            <View style={styles.row}><Text style={styles.label}>{clearSelectionLabel}</Text>{settings.selectedModelId === null && <Check size={20} color={theme.colors.brand.primary} />}</View>
          </Pressable>
        </>}
        {saving && <Text style={styles.subtitle}>正在保存选择…</Text>}
        {onManageModels && <Pressable disabled={saving} onPress={() => { setVisible(false); onManageModels(); }}><Text style={styles.action}>管理模型配置</Text></Pressable>}
      </ScrollView>
    </ModalSheet>
  </>;
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  // 内联选择器的表面与列表卡片一致，不再用页面背景色自成一块。
  card: { padding: theme.spacing.md, marginVertical: theme.spacing.sm, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface.default, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  grow: { flex: 1 },
  label: { fontSize: 16, fontWeight: '600', color: theme.colors.text.primary },
  subtitle: { fontSize: 13, lineHeight: 20, marginTop: theme.spacing.xs, color: theme.colors.text.secondary },
  hint: { fontSize: 13, lineHeight: 20, marginBottom: theme.spacing.sm, color: theme.colors.text.secondary },
  danger: { fontSize: 13, color: theme.colors.feedback.error },
  action: { fontSize: 15, color: theme.colors.brand.primary, paddingVertical: theme.spacing.md },
  scroll: { maxHeight: 420 },
  content: { padding: theme.spacing.lg },
});
