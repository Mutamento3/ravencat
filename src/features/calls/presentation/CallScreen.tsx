import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, BackHandler } from 'react-native';

import { useCallRuntime } from './CallRuntimeProvider';
import CallActiveScreen from './CallActiveScreen';
import CallEndedScreen from './CallEndedScreen';
import { EmptyState } from '@shared/ui';

interface CallScreenProps {
  callId: string;
  onClose: () => void;
  onMinimize: () => void;
}

export default function CallScreen({ callId, onClose, onMinimize }: CallScreenProps) {
  const runtime = useCallRuntime(callId);
  const call = runtime?.call;
  const state = call?.state;
  const exitHandledRef = useRef(false);

  // incoming requested/ringing 的唯一 surface 是原生 CallStyle / IncomingCallActivity，
  // RN 不提供任何 incoming UI；异常路由进入 /calls/:id 时由 route guard 退出该页面，
  // acceptCall() 进入 active 后才由 Host 打开现有 CallActiveScreen。
  const isNativeIncomingSurface = call?.direction === 'incoming'
    && (state === 'requested' || state === 'ringing');

  const isTerminalState = state === 'ended' || state === 'missed' || state === 'rejected' || state === 'failed';

  // 系统返回键与左上角返回对齐：通话进行中最小化为悬浮窗，结束态/找不到通话时直接关闭。
  // 必须返回 true 阻止默认 pop，否则路由退出后 Host 的 restoreActiveCallScreen
  // 因未登记自动恢复抑制会立即重新挂载通话页。
  useEffect(() => {
    const onHardwareBackPress = () => {
      if (!isNativeIncomingSurface && !isTerminalState) {
        onMinimize();
      } else {
        onClose();
      }
      return true;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress);
    return () => subscription.remove();
  }, [call, isNativeIncomingSurface, isTerminalState, onClose, onMinimize]);

  useEffect(() => {
    if (isNativeIncomingSurface && !exitHandledRef.current) {
      exitHandledRef.current = true;
      onClose();
    }
  }, [isNativeIncomingSurface, onClose]);

  useEffect(() => {
    if (runtime?.shouldExit && !exitHandledRef.current) {
      exitHandledRef.current = true;
      onClose();
    }
  }, [onClose, runtime?.shouldExit]);

  if (isNativeIncomingSurface) {
    // guard 退出前不渲染任何通话 UI，避免闪现第二个 incoming surface。
    return null;
  }

  if (!runtime) return <ActivityIndicator />;

  if (!runtime.isLoading && !runtime.call) {
    return (
      <EmptyState
        title="找不到这次通话"
        description="通话记录可能已被删除，或链接已经失效。"
        actionText="返回"
        onAction={onClose}
      />
    );
  }

  if (isTerminalState) {
    return <CallEndedScreen callId={callId} onClose={onClose} runtime={runtime} />;
  }

  return <CallActiveScreen callId={callId} onClose={onClose} onMinimize={onMinimize} runtime={runtime} />;
}
