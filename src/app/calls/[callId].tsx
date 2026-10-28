/** 通话全屏路由，只接受可序列化的 callId。 */
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { CallScreen } from '@features/calls';
import { useHostCallActions } from '@host/KimiPhoneHost';

export default function CallRoute() {
  const { closeCallScreen, minimizeCallScreen, activateCallScreen } = useHostCallActions();
  const params = useLocalSearchParams<{ callId?: string | string[] }>();
  const rawCallId = Array.isArray(params.callId) ? params.callId[0] : params.callId;
  const callId = rawCallId?.trim();

  // 外部深链由 Host 按持久通话状态准入；路由卸载只取消本次准入，不释放正在进行的电话。
  useEffect(() => {
    if (callId) return activateCallScreen(callId);
  }, [activateCallScreen, callId]);

  if (!callId) {
    return <Redirect href="/conversations" />;
  }

  return (
    <CallScreen
      callId={callId}
      onClose={() => closeCallScreen(callId)}
      onMinimize={() => minimizeCallScreen(callId)}
    />
  );
}
