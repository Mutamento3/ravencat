import React, { memo, useCallback } from 'react';
import { Text, View } from 'react-native';
import { localAudioPlaybackCoordinator } from '@platform/device';
import { resolveMediaAsset } from '@features/media';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import { AudioPlaybackBar, showAppDialog } from '@shared/ui';
import { aiCallRuntimeService } from '../../application/runtime/AICallRuntimeService';
import type { CallHistoryEntry } from '../../domain/CallHistory';
import { createCallHistoryStyles } from '../callHistoryStyles';

function CallHistoryEntryCard({ entry, speakerName, scope }: { entry: CallHistoryEntry; speakerName: string; scope: string }) {
  const theme = useTheme(), styles = useThemedStyles(createCallHistoryStyles);
  const playbackKey = `${scope}:${entry.id}`;
  const toggle = useCallback(() => {
    if (aiCallRuntimeService.getActiveCallSnapshot()) {
      showAppDialog({ title: '暂时无法播放', message: '请先结束当前通话，再播放历史录音' });
      return;
    }
    void localAudioPlaybackCoordinator.toggle({
      key: playbackKey, scope, durationMs: entry.durationMs!,
      resolveUri: async () => (await resolveMediaAsset(entry.mediaAssetId!)).localUri,
    });
  }, [entry.mediaAssetId, entry.durationMs, playbackKey, scope]);
  return <ThemedSurface variant="card" nativeGlass={false} style={styles.card}>
    <Text style={styles.title}>{speakerName}</Text>
    {entry.mediaAssetId ? <>
      <AudioPlaybackBar playbackKey={playbackKey} durationMs={entry.durationMs!} coordinator={localAudioPlaybackCoordinator}
        speakerName={speakerName} onPress={toggle} foregroundColor={theme.colors.text.primary} minHeight={32} />
      <View style={styles.divider} />
    </> : entry.inputKind === 'speech' ? <Text style={styles.meta}>音频未保存</Text> : null}
    <Text selectable style={styles.body}>{entry.speaker === 'user' && entry.inputKind === 'speech' ? `语音识别转写：${entry.text}` : entry.text}</Text>
  </ThemedSurface>;
}

export default memo(CallHistoryEntryCard);
