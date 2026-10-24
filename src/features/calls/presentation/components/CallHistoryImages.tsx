import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { resolveMediaAsset, type ResolvedMediaAsset } from '@features/media';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { showAppDialog } from '@shared/ui';
import type { CallHistoryImage } from '../../domain/CallHistory';
import { deleteCallHistoryImage } from '../../application/CallHistory';
import { createCallHistoryStyles } from '../callHistoryStyles';

function HistoryImage({ image, assistantName, onDelete }: { image: CallHistoryImage; assistantName: string; onDelete(): void }) {
  const theme = useTheme(), styles = useThemedStyles(createCallHistoryStyles);
  const [resolved, setResolved] = useState<ResolvedMediaAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void resolveMediaAsset(image.mediaAssetId).then(asset => { if (active) setResolved(asset); })
      .catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [image.mediaAssetId]);
  return <ThemedSurface variant="card" nativeGlass={false} style={styles.card}>
    <View style={styles.row}><Text style={styles.title}>{assistantName}获取的截图</Text>
      <Pressable style={styles.action} accessibilityLabel="删除截图" onPress={onDelete}><Trash2 size={19} color={theme.colors.feedback.error} /></Pressable>
    </View>
    <Text style={styles.meta}>{new Date(image.createdAt).toLocaleString()}</Text>
    {error ? <Text style={styles.error}>{error}</Text> : resolved ? <Image source={{ uri: resolved.localUri }}
      accessibilityLabel={`${assistantName}在通话中获取的画面`} resizeMode="contain" style={styles.snapshot}
      onError={event => setError(event.nativeEvent.error)} /> : <ActivityIndicator color={theme.colors.brand.primary} />}
  </ThemedSurface>;
}

export default function CallHistoryImages({ images, callId, assistantId, assistantName, onDeleted }: {
  images: CallHistoryImage[]; callId: string; assistantId: string; assistantName: string; onDeleted(imageId: string): void;
}) {
  const styles = useThemedStyles(createCallHistoryStyles);
  const [deleting, setDeleting] = useState(false);
  const remove = (image: CallHistoryImage) => {
    if (deleting) return;
    showAppDialog({ title: '删除这张截图？', message: '删除后无法从通话记录恢复。对话文字和其他录音会继续保留。', buttons: [
      { text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: async () => {
        setDeleting(true);
        try { await deleteCallHistoryImage(image.id, callId, assistantId); onDeleted(image.id); }
        catch (failure) { showAppDialog({ title: '删除失败', message: failure instanceof Error ? failure.message : '请稍后再试', tone: 'error' }); }
        finally { setDeleting(false); }
      } },
    ] });
  };
  return <View style={styles.images}>{images.map(image => <HistoryImage key={image.id} image={image} assistantName={assistantName} onDelete={() => remove(image)} />)}</View>;
}
