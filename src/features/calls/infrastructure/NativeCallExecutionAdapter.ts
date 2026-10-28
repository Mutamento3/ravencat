/** 原生资源桥；页面地址由 Host 提供，Calls 不持有 App 路由。 */
import { nativeCallRuntime } from '../../../../modules/call-runtime';
import type { CallRuntimeDependencies } from '../application/runtime/CallRuntimeDependencies';
import { loadCallRingtoneUri } from '../application/CallRingtoneSettings';

export function createCallExecutionAdapter(
  returnUri: (callId: string) => string,
  resolveCaller: (assistantId: string) => Promise<{ name: string; avatar: string | null }>,
): CallRuntimeDependencies['native']['execution'] {
  return {
    start: async (call) => {
      const caller = await resolveCaller(call.aiAssistantId);
      await nativeCallRuntime.start({
        callId: call.id, name: caller.name, avatarUri: caller.avatar, direction: call.direction,
        returnUri: returnUri(call.id),
        ringtoneUri: call.state === 'dialing' ? await loadCallRingtoneUri(call.aiAssistantId, 'outgoing') : null,
        ringing: call.state === 'dialing',
      });
    },
    isAlive: (id) => nativeCallRuntime.isAlive(id),
    setCamera: (id, enabled, facing) => nativeCallRuntime.setCamera(id, enabled, facing),
    capture: (id) => nativeCallRuntime.capture(id),
    deleteSnapshot: (uri) => nativeCallRuntime.deleteSnapshot(uri),
    setMicrophone: (id, enabled) => nativeCallRuntime.setMicrophone(id, enabled),
    setPresentation: (id, fullScreen) => nativeCallRuntime.setPresentation(id, fullScreen),
    hasOverlayPermission: () => nativeCallRuntime.hasOverlayPermission(),
    requestOverlayPermission: () => nativeCallRuntime.requestOverlayPermission(),
  };
}
