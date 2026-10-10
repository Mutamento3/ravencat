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

  // 外部深链也由 Host 建立媒体会话；路由卸载不释放正在进行的电话。
  useEffect(() => {
    if (callId) activateCallScreen(callId);
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
