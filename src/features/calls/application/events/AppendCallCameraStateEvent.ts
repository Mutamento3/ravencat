import type { CameraType } from 'expo-camera';

import type { CallEvent } from '../../domain/CallEvent';
import { getCallRuntimeDependencies } from '../runtime/CallRuntimeDependencies';

export type CallCameraStateReason = 'enabled' | 'disabled' | 'facingChanged';

export async function appendCallCameraStateEvent(params: {
  callId: string;
  enabled: boolean;
  facing: CameraType;
  reason: CallCameraStateReason;
}): Promise<CallEvent> {
  const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(params.callId);
  if (!call) {
    throw new Error(`Call ${params.callId} not found`);
  }

  return getCallRuntimeDependencies().repositories.calls.appendEvent({
    callId: call.id,
    chatSessionId: call.chatSessionId,
    kind: 'systemNotice',
    actorType: 'system',
    text: buildCameraStateText(params.enabled, params.facing, params.reason),
    visibleInChat: false,
    includeInAIContext: true,
    payloadJson: JSON.stringify({
      type: 'cameraState',
      enabled: params.enabled,
      facing: params.facing,
      reason: params.reason,
    }),
  });
}

function buildCameraStateText(
  enabled: boolean,
  facing: CameraType,
  reason: CallCameraStateReason
): string {
  const facingText = facing === 'back' ? '后置摄像头' : '前置摄像头';
  if (!enabled) {
    return '用户已关闭摄像头，AI 不能继续看到用户当前画面。';
  }
  if (reason === 'facingChanged') {
    return `用户已切换到${facingText}，此前看到的画面已过时，需要时可以重新请求查看当前画面。`;
  }
  return `用户已开启${facingText}，AI 可以在需要时主动请求查看当前画面。`;
}
