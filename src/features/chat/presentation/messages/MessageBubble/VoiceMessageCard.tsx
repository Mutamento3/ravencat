import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChatVoiceMessageMetadata } from '@features/chat/messages/domain';
import { voiceMessagePlaybackCoordinator, getVoicePlaybackKey, type VoicePlaybackTarget } from '@features/chat/messages/application/VoiceMessagePlaybackCoordinator';
import { useTheme } from '@shared/theme';
import { AudioPlaybackBar } from '@shared/ui';

interface VoiceMessageCardProps {
  playbackTarget: VoicePlaybackTarget;
  voice: ChatVoiceMessageMetadata['voice'];
  transcript: string;
  isTranscriptExpanded: boolean;
  isMe: boolean;
  foregroundColor?: string;
  voicePlayedAt?: string | null;
  canLongPress?: boolean;
  onLongPress?: (position: { x: number; y: number }) => void;
}

export default function VoiceMessageCard(props: VoiceMessageCardProps) {
  const theme = useTheme();
  const { playbackTarget, voice } = props;
  const toggle = useCallback(() => {
    void voiceMessagePlaybackCoordinator.toggle(playbackTarget, voice.mediaAssetId, voice.durationMs);
  }, [playbackTarget, voice.mediaAssetId, voice.durationMs]);
  // 前景仍归聊天气泡语义所有；公共语音条不持有聊天主题或消息类型。
  const foregroundColor = props.foregroundColor ?? (props.isMe ? theme.colors.chat.userText : theme.colors.chat.aiText);
  return <View style={styles.container}>
    <AudioPlaybackBar playbackKey={getVoicePlaybackKey(playbackTarget)} durationMs={voice.durationMs}
      coordinator={voiceMessagePlaybackCoordinator} onPress={toggle} foregroundColor={foregroundColor}
      showUnplayedDot={playbackTarget.kind === 'message' && !props.isMe && !props.voicePlayedAt}
      onLongPress={props.canLongPress ? props.onLongPress : undefined} />
    {props.isTranscriptExpanded ? <Text style={[styles.transcript, { color: foregroundColor }]}>{props.transcript}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { minWidth: 170, gap: 8 },
  transcript: { fontSize: 14, lineHeight: 20 },
});
