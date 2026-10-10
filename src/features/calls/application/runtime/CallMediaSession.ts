/** 通话终态先停止采集/ASR/相机，再释放该通电话拥有的通信音频会话。 */
import type { CallSession } from '../../domain/CallSession';
import { getCallRuntimeDependencies } from './CallRuntimeDependencies';

type StopMedia = (call: CallSession) => Promise<void>;
const mediaOwners = new Map<string, StopMedia>();

export function registerCallMediaOwner(callId: string, stopMedia: StopMedia): () => void {
  if (mediaOwners.has(callId)) {
    throw new Error(`通话 ${callId} 已有媒体会话所有者`);
  }
  mediaOwners.set(callId, stopMedia);
  return () => { mediaOwners.delete(callId); };
}

export async function finishCallMediaSession(call: CallSession): Promise<void> {
  // 没有挂载展示宿主的拨号/来电也可以结束，音频释放仍按 callId 隔离。
  try {
    await mediaOwners.get(call.id)?.(call);
  } finally {
    await getCallRuntimeDependencies().native.audioPlayback.endSession(call.id);
  }
}
