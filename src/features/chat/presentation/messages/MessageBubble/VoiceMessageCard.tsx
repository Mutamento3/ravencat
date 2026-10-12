import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Pause, Play } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import type { ChatVoiceMessageMetadata } from '@features/chat/messages/domain';
import {
  voiceMessagePlaybackCoordinator,
  getVoicePlaybackKey,
  type VoicePlaybackTarget,
  type VoiceMessagePlaybackViewState,
} from '@features/chat/messages/application/VoiceMessagePlaybackCoordinator';
import { useTheme } from '@shared/theme';

interface VoiceMessageCardProps {
  playbackTarget: VoicePlaybackTarget;
  voice: ChatVoiceMessageMetadata['voice'];
  transcript: string;
  isTranscriptExpanded: boolean;
  isMe: boolean;
  foregroundColor?: string;
  voicePlayedAt?: string | null;
  /** 是否允许长按打开消息 action menu（“转文字 / 收起文字”）。 */
  canLongPress?: boolean;
  onLongPress?: (position: { x: number; y: number }) => void;
}

/**
 * 语音消息气泡。
 *
 * 长按为什么由本组件自己处理，而不是继续依赖外层 `TouchableWithoutFeedback`：
 * 语音气泡内部有一个用于播放/暂停的 `Pressable`。Android 上嵌套 responder 不会把
 * 长按可靠地冒泡给外层 Touchable——内层 Pressable 一旦抢到 responder，外层就永远
 * 收不到 long press。结果是普通文本能长按、语音条长按毫无反应（本功能真机失效的
 * 直接原因）。
 *
 * 因此这里显式在同一个 `Pressable` 上同时声明 press 与 longPress，二者互斥：
 * - 短按：只 toggle 播放；
 * - 长按：只打开 action menu，并且长按触发后必须吞掉随之而来的 release，
 *   否则会出现“长按菜单 + 顺手播放一次”的叠加。
 */
export default function VoiceMessageCard(props: VoiceMessageCardProps) {
  const theme = useTheme();
  const { canLongPress = false, onLongPress, playbackTarget } = props;
  const playbackKey = getVoicePlaybackKey(playbackTarget);
  const [playback, setPlayback] = useState<VoiceMessagePlaybackViewState>({
    state: 'idle', positionMs: 0, durationMs: props.voice.durationMs,
  });
  useEffect(() => voiceMessagePlaybackCoordinator.subscribe(
    playbackKey,
    props.voice.durationMs,
    setPlayback,
  ), [playbackKey, props.voice.durationMs]);

  // 长按已触发时，随后的 press/onPress 必须被丢弃，避免长按后又播放一次。
  const longPressHandledRef = useRef(false);
  // 与外层 TouchableMessageBubble 相同的坐标契约：action menu 依赖 pageX/pageY 定位。
  const longPressPositionRef = useRef({ x: 0, y: 0 });

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    longPressHandledRef.current = false;
    if (!canLongPress || !onLongPress) {
      return;
    }
    longPressPositionRef.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    };
  }, [canLongPress, onLongPress]);

  const handleLongPress = useCallback(() => {
    if (!canLongPress || !onLongPress) {
      return;
    }
    longPressHandledRef.current = true;
    onLongPress(longPressPositionRef.current);
  }, [canLongPress, onLongPress]);

  const handlePress = useCallback(() => {
    if (longPressHandledRef.current) {
      return;
    }
    void voiceMessagePlaybackCoordinator.toggle(
      playbackTarget,
      props.voice.mediaAssetId,
      props.voice.durationMs,
    );
  }, [playbackTarget, props.voice.durationMs, props.voice.mediaAssetId]);

  const progress = playback.durationMs > 0
    ? Math.min(1, playback.positionMs / playback.durationMs)
    : 0;
  const isPlaying = playback.state === 'playing' || playback.state === 'loading';
  // 语音卡的前景色是"聊天气泡内消息内容"的前景色，必须用聊天语义 token。
  // 不能用 brand.onPrimary：它的语义是"品牌主色之上的前景色"，前提是内容坐在
  // brand.primary 底上。Paper Note 用户气泡是 transparent（直接坐在 background.app
  // 上），而该主题 brand.onPrimary 恰好等于 background.app，会把播放控件画成背景色。
  const foregroundColor = props.foregroundColor ?? (props.isMe ? theme.colors.chat.userText : theme.colors.chat.aiText);
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? '暂停语音' : '播放语音'}
        onPressIn={handlePressIn}
        onPress={handlePress}
        onLongPress={canLongPress ? handleLongPress : undefined}
        delayLongPress={350}
        style={styles.player}
      >
        {playback.state === 'error' ? (
          <AlertCircle color={theme.colors.feedback.error} size={22} />
        ) : isPlaying ? (
          <Pause color={foregroundColor} size={22} fill={foregroundColor} />
        ) : (
          <Play color={foregroundColor} size={22} fill={foregroundColor} />
        )}
        <View style={styles.track}>
          <View style={[styles.trackBase, { backgroundColor: theme.colors.border.default }]}>
            <View style={[
              styles.trackProgress,
              { width: `${progress * 100}%`, backgroundColor: foregroundColor },
            ]} />
          </View>
          <Text style={[styles.duration, { color: foregroundColor }]}>
            {formatDuration(playback.durationMs || props.voice.durationMs)}
          </Text>
        </View>
        {playbackTarget.kind === 'message' && !props.isMe && !props.voicePlayedAt ? (
          <View style={[styles.unplayedDot, { backgroundColor: theme.colors.feedback.error }]} />
        ) : null}
      </Pressable>
      {playback.state === 'error' ? (
        <Text style={[styles.error, { color: theme.colors.feedback.error }]}>语音文件不可用</Text>
      ) : null}
      {props.isTranscriptExpanded ? (
        <Text style={[styles.transcript, { color: foregroundColor }]}>{props.transcript}</Text>
      ) : null}
    </View>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1_000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { minWidth: 170, gap: 8 },
  player: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, gap: 4 },
  trackBase: { height: 3, borderRadius: 2, overflow: 'hidden' },
  trackProgress: { height: 3, borderRadius: 2 },
  duration: { fontSize: 12 },
  unplayedDot: { width: 8, height: 8, borderRadius: 4 },
  transcript: { fontSize: 14, lineHeight: 20 },
  error: { fontSize: 12 },
});
