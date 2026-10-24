import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Pause, Play } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import type { AudioPlaybackKey, AudioPlaybackSubscription, AudioPlaybackViewState } from '@shared/audio/AudioPlaybackState';
import { useTheme } from '@shared/theme';

export interface AudioPlaybackBarProps {
  playbackKey: AudioPlaybackKey;
  durationMs: number;
  coordinator: AudioPlaybackSubscription;
  onPress(): void;
  foregroundColor?: string;
  speakerName?: string;
  showUnplayedDot?: boolean;
  minHeight?: number;
  onLongPress?: (position: { x: number; y: number }) => void;
}

/** 只有语音条，进度订阅留在条内，不让列表随着播放进度重绘。 */
export default function AudioPlaybackBar({ playbackKey, durationMs, coordinator, onPress, foregroundColor: color, speakerName, showUnplayedDot = false, minHeight, onLongPress }: AudioPlaybackBarProps) {
  const theme = useTheme();
  const foregroundColor = color ?? theme.colors.text.primary;
  const [playback, setPlayback] = useState<AudioPlaybackViewState>({ state: 'idle', positionMs: 0, durationMs });
  useEffect(() => coordinator.subscribe(playbackKey, durationMs, setPlayback), [coordinator, playbackKey, durationMs]);
  const longPressHandled = useRef(false);
  const pressPosition = useRef({ x: 0, y: 0 });
  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    longPressHandled.current = false;
    if (onLongPress) pressPosition.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  }, [onLongPress]);
  const handleLongPress = useCallback(() => {
    longPressHandled.current = true;
    onLongPress!(pressPosition.current);
  }, [onLongPress]);
  const handlePress = useCallback(() => {
    // Android 长按的释放不能同时触发播放，长短按由同一个 responder 拥有。
    if (!longPressHandled.current) onPress();
  }, [onPress]);
  const isPlaying = playback.state === 'playing' || playback.state === 'loading';
  const progress = playback.durationMs > 0 ? Math.min(1, playback.positionMs / playback.durationMs) : 0;
  const seconds = Math.max(0, Math.ceil((playback.durationMs || durationMs) / 1000));
  return <View style={styles.container}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${isPlaying ? '暂停' : '播放'}${speakerName ? `${speakerName}的` : ''}语音`}
      onPressIn={handlePressIn} onPress={handlePress} onLongPress={onLongPress ? handleLongPress : undefined} delayLongPress={350}
      style={[styles.player, minHeight != null ? { minHeight } : null]}>
      {playback.state === 'error' ? <AlertCircle color={theme.colors.feedback.error} size={22} />
        : isPlaying ? <Pause color={foregroundColor} size={22} fill={foregroundColor} /> : <Play color={foregroundColor} size={22} fill={foregroundColor} />}
      <View style={styles.track}>
        <View style={[styles.trackBase, { backgroundColor: theme.colors.border.default }]}>
          <View style={[styles.trackProgress, { width: `${progress * 100}%`, backgroundColor: foregroundColor }]} />
        </View>
        <Text style={[styles.duration, { color: foregroundColor }]}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</Text>
      </View>
      {showUnplayedDot ? <View style={[styles.unplayedDot, { backgroundColor: theme.colors.feedback.error }]} /> : null}
    </Pressable>
    {playback.state === 'error' ? <Text style={[styles.error, { color: theme.colors.feedback.error }]}>语音文件不可用</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { minWidth: 170, gap: 8 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, gap: 4 },
  trackBase: { height: 3, borderRadius: 2, overflow: 'hidden' },
  trackProgress: { height: 3, borderRadius: 2 },
  duration: { fontSize: 12 },
  unplayedDot: { width: 8, height: 8, borderRadius: 4 },
  error: { fontSize: 12 },
});
