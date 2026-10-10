import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { X } from 'lucide-react-native';

import { useTheme, useThemedStyles } from '@shared/theme';
import { createCallStyles } from './styles';
import type { CallRuntimeView } from '../application/runtime/CallMediaRuntime';
import CallAvatarHeader from './components/CallAvatarHeader';
import CallBackgroundLayer from './components/CallBackgroundLayer';
import CallTranscriptOverlay from './components/CallTranscriptOverlay';

interface CallEndedScreenProps {
  callId: string;
  onClose: () => void;
  runtime: CallRuntimeView;
}

function getEndedStateText(state?: string, endReason?: string | null): string {
  if (state === 'rejected') {
    return endReason === 'aiRejected' ? '对方拒绝接听' : '已拒绝';
  }
  if (state === 'missed') {
    return endReason === 'missedByUser' ? '未接听' : '对方未接听';
  }
  if (state === 'failed') {
    return '通话失败';
  }
  return '通话已结束';
}

export default function CallEndedScreen({ onClose, runtime }: CallEndedScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createCallStyles);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <CallBackgroundLayer backgroundUri={runtime.backgroundUri}>
        <SafeAreaView style={styles.content} edges={['bottom', 'left', 'right']}>
          <View style={[styles.topBar, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={styles.topBarButton}
              onPress={onClose}
              activeOpacity={0.6}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <X size={22} color={theme.colors.icon.inverse} strokeWidth={1.6} />
            </TouchableOpacity>
          </View>

          <CallAvatarHeader
            aiProfile={runtime.aiProfile}
            stateText={getEndedStateText(runtime.call?.state, runtime.call?.endReason)}
          />

          <View style={styles.transcriptArea}>
            <CallTranscriptOverlay
              events={runtime.events}
              showFullTextFallback
              collapsible={false}
            />
          </View>

          {runtime.errorMessage ? (
            <Text style={styles.errorText} numberOfLines={2}>{runtime.errorMessage}</Text>
          ) : null}

          <View style={styles.endedActions}>
            <TouchableOpacity style={styles.primaryButton} onPress={onClose} activeOpacity={0.78}>
              <Text style={styles.primaryButtonText}>返回聊天</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </CallBackgroundLayer>
    </View>
  );
}
