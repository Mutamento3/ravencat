import { showAppDialog } from '@shared/ui';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ChevronDown,
  Headphones,
  MessageSquareText,
  Mic,
  MicOff,
  Phone,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react-native';

import { useTheme, useThemedStyles } from '@shared/theme';
import { createCallStyles } from './styles';
import type { CallRuntimeView } from '../application/runtime/CallMediaRuntime';
import type { CallTurnPhase } from '../application';
import type { CallSession } from '../domain/CallSession';
import CallAvatarHeader from './components/CallAvatarHeader';
import CallBackgroundLayer from './components/CallBackgroundLayer';
import CallControls, { type CallControlAction } from './components/CallControls';
import CallTextInputModal from './components/CallTextInputModal';
import CallTranscriptOverlay from './components/CallTranscriptOverlay';
import { getCallRuntimeDependencies } from '../application/runtime/CallRuntimeDependencies';
import { CallPresentationSurface } from '@platform/device';

interface CallActiveScreenProps {
  callId: string;
  onMinimize: () => void;
  runtime: CallRuntimeView;
}

const audioRouteLabels = { earpiece: '听筒', speaker: '免提', headset: '耳机' };
const audioRouteIcons = { earpiece: Phone, speaker: Volume2, headset: Headphones };

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getStateText(call: CallSession, turnPhase: CallTurnPhase, elapsedSeconds: number): string {
  if (call.state === 'dialing') {
    return '正在拨号';
  }
  if (call.state === 'connecting') {
    return '正在接通';
  }
  if (call.state === 'active') {
    if (turnPhase === 'using_tool') {
      return '正在使用工具…';
    }
    if (turnPhase === 'speaking') {
      return '正在说话…';
    }
    if (turnPhase === 'generating') {
      return '正在思考…';
    }
    return formatElapsed(elapsedSeconds);
  }
  if (call.state === 'ending') {
    return '正在挂断';
  }
  return '通话中';
}

export default function CallActiveScreen({ callId, onMinimize, runtime }: CallActiveScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createCallStyles);
  const insets = useSafeAreaInsets();
  const [textInputVisible, setTextInputVisible] = useState(false);
  const [loadedBackground, setLoadedBackground] = useState<string | null>(null);
  const resumeSpeechAfterTextRef = useRef(false);

  const {
    errorMessage,
    cameraEnabled,
    isEnding,
    isListening,
    audioRoute,
    availableAudioRoutes,
    isAudioRouteSwitching,
    startRealtimeSpeech,
    stopRealtimeSpeech,
    toggleCamera,
    switchCameraFacing,
    toggleRealtimeSpeech,
    cycleAudioRoute,
  } = runtime;

  const openTextInput = useCallback(() => {
    // B17：文字输入聚焦期间暂停实时语音识别，关闭输入后恢复。
    resumeSpeechAfterTextRef.current = isListening;
    if (isListening) {
      void stopRealtimeSpeech();
    }
    setTextInputVisible(true);
  }, [isListening, stopRealtimeSpeech]);

  const closeTextInput = useCallback(() => {
    setTextInputVisible(false);
    if (resumeSpeechAfterTextRef.current) {
      resumeSpeechAfterTextRef.current = false;
      void startRealtimeSpeech();
    }
  }, [startRealtimeSpeech]);

  const callState = runtime.call?.state;
  const handleToggleCamera = useCallback(async () => {
    const execution = getCallRuntimeDependencies().native.execution;
    if (cameraEnabled || await execution.hasOverlayPermission()) {
      await toggleCamera();
      return;
    }
    showAppDialog({ title: '显示摄像头小窗', message: '摄像头使用同一个悬浮小窗显示。开启悬浮窗权限后，再点击摄像头即可接入。', buttons: [
      { text: '取消', style: 'cancel' },
      { text: '前往设置', onPress: () => {
        void execution.requestOverlayPermission()
          .catch(error => console.warn('[Calls] 打开摄像头小窗权限设置失败', error));
      } },
    ] });
  }, [cameraEnabled, toggleCamera]);
  const actions = useMemo<CallControlAction[]>(() => [
    {
      id: 'voice',
      label: '麦克风',
      icon: isListening ? Mic : MicOff,
      active: isListening,
      disabled: isEnding || callState !== 'active',
      onPress: () => void toggleRealtimeSpeech(),
    },
    {
      id: 'audioRoute',
      label: isAudioRouteSwitching ? '切换中' : audioRoute ? audioRouteLabels[audioRoute] : '未就绪',
      icon: audioRoute ? audioRouteIcons[audioRoute] : Phone,
      active: audioRoute === 'speaker' || audioRoute === 'headset',
      disabled: isEnding || callState !== 'active' || isAudioRouteSwitching || availableAudioRoutes.length < 2,
      onPress: () => void cycleAudioRoute(),
    },
    {
      id: 'camera',
      label: '摄像头',
      icon: cameraEnabled ? Video : VideoOff,
      active: cameraEnabled,
      disabled: isEnding,
      onPress: () => void handleToggleCamera(),
    },
    ...(cameraEnabled ? [{
      id: 'cameraFacing', label: '翻转', icon: SwitchCamera, disabled: isEnding || !runtime.isCameraReady,
      onPress: () => void switchCameraFacing(),
    }] : []),
    {
      id: 'textInput',
      label: '文字',
      icon: MessageSquareText,
      active: textInputVisible,
      disabled: isEnding || callState !== 'active',
      onPress: openTextInput,
    },
  ], [
    callState,
    cameraEnabled,
    isEnding,
    isListening,
    openTextInput,
    audioRoute,
    availableAudioRoutes,
    isAudioRouteSwitching,
    textInputVisible,
    handleToggleCamera,
    switchCameraFacing,
    runtime.isCameraReady,
    toggleRealtimeSpeech,
    cycleAudioRoute,
  ]);

  const handleHangUp = async () => {
    await runtime.hangUp();
  };

  const handleMinimize = async () => {
    const execution = getCallRuntimeDependencies().native.execution;
    if (await execution.hasOverlayPermission()) {
      onMinimize();
      return;
    }
    showAppDialog({ title: '显示通话小窗', message: '开启悬浮权限后，小窗可以显示在其他应用上。也可以继续通话，通过通知返回。', buttons: [
      { text: '通过通知继续', onPress: onMinimize },
      { text: '前往设置', onPress: () => {
        void execution.requestOverlayPermission().then(onMinimize)
          .catch(error => console.warn('[Calls] 打开悬浮权限设置失败', error));
      } },
    ] });
  };

  if (runtime.isLoading || !runtime.call) {
    return (
      <View style={styles.screen}>
        <StatusBar style="light" />
        <CallBackgroundLayer backgroundUri={runtime.backgroundUri}>
          <View style={[styles.content, { paddingTop: insets.top }]}>
            <ActivityIndicator size="large" color={theme.colors.icon.inverse} />
            <Text style={styles.loadingText}>正在加载通话</Text>
          </View>
        </CallBackgroundLayer>
      </View>
    );
  }

  return (
    <CallPresentationSurface
      style={styles.screen}
      callId={callId}
      ready={!runtime.backgroundUri || loadedBackground === runtime.backgroundUri}
    >
      <StatusBar style="light" />
      <CallBackgroundLayer backgroundUri={runtime.backgroundUri} onImageReady={setLoadedBackground}>
        <SafeAreaView style={styles.content} edges={['bottom', 'left', 'right']}>
          <View style={[styles.topBar, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={styles.topBarButton}
              onPress={() => { void handleMinimize(); }}
              activeOpacity={0.6}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <ChevronDown size={22} color={theme.colors.icon.inverse} strokeWidth={1.6} />
            </TouchableOpacity>
          </View>

          <CallAvatarHeader
            aiProfile={runtime.aiProfile}
            stateText={getStateText(runtime.call, runtime.turnPhase, runtime.elapsedSeconds)}
          />

          <View style={styles.transcriptArea}>
            <CallTranscriptOverlay
              events={runtime.events}
              interimText={runtime.interimSpeechText || runtime.pendingUserSpeechText}
            />
          </View>

          {errorMessage ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="查看通话错误详情"
              accessibilityHint="展开完整错误，可选择复制"
              onPress={() => showAppDialog({ title: '通话错误详情', message: errorMessage, tone: 'error' })}
            >
              <Text style={styles.errorText} numberOfLines={2}>{errorMessage}</Text>
            </TouchableOpacity>
          ) : null}

          <CallControls actions={actions} />
          <View style={styles.hangupRow}>
            <TouchableOpacity
              style={styles.hangupButton}
              onPress={handleHangUp}
              disabled={runtime.isEnding}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {/* 挂断用无斜杠的话筒图标，旋转 135° 呈经典挂断朝向；PhoneOff 带斜杠不用于挂断。 */}
              <Phone
                size={26}
                color={theme.colors.feedback.error}
                strokeWidth={1.6}
                style={{ transform: [{ rotate: '135deg' }] }}
              />
            </TouchableOpacity>
            <Text style={styles.hangupLabel}>{runtime.isEnding ? '正在挂断' : '挂断'}</Text>
          </View>
        </SafeAreaView>

        <CallTextInputModal
          visible={textInputVisible}
          text={runtime.textDraft}
          onChangeText={runtime.changeTextDraft}
          onClose={closeTextInput}
          onSend={runtime.sendCallText}
          // 输入可用性由通话状态决定；任何回合相位都可提交，
          // 统一输入入口会按相位打断（idle/generating/speaking），B17。
          disabled={runtime.isEnding || runtime.call.state !== 'active'}
        />
      </CallBackgroundLayer>

    </CallPresentationSurface>
  );
}
