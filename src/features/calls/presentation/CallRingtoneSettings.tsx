import React, { useCallback, useId, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ThemedSurface, useThemedStyles, type PresentationTheme } from '@shared/theme';
import { Button, showAppDialog } from '@shared/ui';
import { previewCallRingtone, stopCallRingtonePreview } from '@platform/device/CallRingtone';
import { clearCallRingtone, getCallRingtoneSelection, loadCallRingtoneUri, setCustomCallRingtone } from '../application/CallRingtoneSettings';
import type { CallDirection } from '../domain/CallSession';
import type { CallRingtoneSelection } from '../domain/CallRingtoneRepository';

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  card: { padding: theme.spacing.lg, gap: theme.spacing.md, borderRadius: theme.radius.lg },
  title: { fontSize: 16, fontWeight: '600', color: theme.colors.text.primary },
  description: { fontSize: 13, lineHeight: 21, color: theme.colors.text.secondary },
  row: { gap: theme.spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  error: { color: theme.colors.feedback.error, fontSize: 13 },
});

function RingtoneRow({ assistantId, direction }: { assistantId: string; direction: CallDirection }) {
  const styles = useThemedStyles(createStyles);
  const previewOwner = `call-ringtone-preview-${useId()}`;
  const mounted = useRef(false), previewRevision = useRef(0);
  const [selection, setSelection] = useState<CallRingtoneSelection | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const title = direction === 'incoming' ? '来电铃声' : '拨出等待音';
  const stopPreview = useCallback(() => {
    previewRevision.current++;
    void stopCallRingtonePreview(previewOwner).catch(failure => console.warn('[Calls] 停止铃声试听失败', failure));
  }, [previewOwner]);
  useFocusEffect(useCallback(() => {
    let active = true;
    mounted.current = true;
    setBusy(true); setError(null);
    void getCallRingtoneSelection(assistantId, direction)
      .then(value => { if (active) setSelection(value); })
      .catch(failure => { if (active) setError(failure.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; mounted.current = false; stopPreview(); };
  }, [assistantId, direction, stopPreview]));

  const change = async (pick: boolean) => {
    setBusy(true); stopPreview();
    try {
      if (pick) {
        const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
        if (result.canceled) return;
        const asset = result.assets[0];
        try {
          if (!mounted.current) return;
          await setCustomCallRingtone({ assistantId, direction, sourceUri: asset.uri,
            fileName: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream' });
        } finally {
          // 这里只删除选择器交付的缓存副本，长期文件已经交给 MediaAsset。
          await FileSystem.deleteAsync(asset.uri, { idempotent: true })
            .catch(failure => console.warn('[Calls] 清理铃声选择缓存失败', failure));
        }
      } else {
        await clearCallRingtone(assistantId, direction);
      }
      const value = await getCallRingtoneSelection(assistantId, direction);
      if (mounted.current) { setSelection(value); setError(null); }
    } catch (failure) {
      if (mounted.current) showAppDialog({ title: `${title}设置失败`,
        message: failure instanceof Error ? failure.message : '无法保存铃声', tone: 'error' });
    } finally { if (mounted.current) setBusy(false); }
  };
  const preview = async () => {
    const revision = ++previewRevision.current;
    try {
      const uri = await loadCallRingtoneUri(assistantId, direction);
      if (!mounted.current || revision !== previewRevision.current) return;
      await previewCallRingtone(previewOwner, uri, direction);
    } catch (failure) {
      if (mounted.current && revision === previewRevision.current) showAppDialog({ title: '试听失败',
        message: failure instanceof Error ? failure.message : '无法播放铃声', tone: 'error' });
    }
  };
  return <View style={styles.row}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.description}>{selection?.fileName ?? (direction === 'incoming' ? '系统默认来电铃声' : '默认回铃音')}</Text>
    {error && <Text style={styles.error}>{error}</Text>}
    <View style={styles.actions}>
      <Button title="选择音频" variant="secondary" disabled={busy} onPress={() => void change(true)} />
      <Button title="试听 10 秒" variant="text" disabled={busy || error !== null} onPress={() => void preview()} />
      <Button title="停止" variant="text" onPress={stopPreview} />
      <Button title="恢复默认" variant="text" disabled={busy || !selection?.mediaAssetId} onPress={() => void change(false)} />
    </View>
  </View>;
}

export default function CallRingtoneSettings({ assistantId }: { assistantId: string }) {
  const styles = useThemedStyles(createStyles);
  return <ThemedSurface variant="card" style={styles.card}>
    <Text style={styles.description}>仅对这位 AI 生效。来电铃声遵守系统静音、振动和勿扰；拨出等待音在对方接听前播放。试听使用媒体音量。</Text>
    <RingtoneRow key={`${assistantId}:incoming`} assistantId={assistantId} direction="incoming" />
    <RingtoneRow key={`${assistantId}:outgoing`} assistantId={assistantId} direction="outgoing" />
  </ThemedSurface>;
}
