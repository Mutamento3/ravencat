import type { CallAttachment, CallEvent } from '../../domain/CallEvent';
import { PERSISTENT_MEDIA_CATEGORY, persistentMediaStore } from '@platform/device';
import { getCallRuntimeDependencies } from '../runtime/CallRuntimeDependencies';
import { CALL_SNAPSHOT_PROCESS_PREFIX } from './CallSnapshotLifetime';
import { saveCallHistorySnapshot } from '../CallHistory';

export interface AttachCallSnapshotInput {
  callId: string;
  sourceUri: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  cameraFacing?: 'front' | 'back';
  reason?: 'look_at_user';
}

export interface AttachCallSnapshotResult {
  attachment: CallAttachment;
  event: CallEvent;
}

export async function attachCallSnapshot(
  input: AttachCallSnapshotInput
): Promise<AttachCallSnapshotResult> {
  const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(input.callId);
  if (!call) {
    throw new Error(`Call ${input.callId} not found`);
  }
  if (call.state !== 'active') {
    throw new Error('当前通话不在接通状态，无法截取画面');
  }

  const eventId = createCallSnapshotId('call_event');
  const attachmentId = createCallSnapshotId('call_attachment');

  const persistedUri = await persistentMediaStore.persistMedia({
    sourceUri: input.sourceUri,
    category: PERSISTENT_MEDIA_CATEGORY.callSnapshot,
    entityId: eventId,
    originalFileName: `${CALL_SNAPSHOT_PROCESS_PREFIX}${eventId}.jpg`,
    mimeType: input.mimeType || 'image/jpeg',
  });

  let result: AttachCallSnapshotResult;
  try {
    const info = await persistentMediaStore.getInfo(persistedUri);
    result = await getCallRuntimeDependencies().repositories.calls.appendSnapshot({
      callId: call.id,
      chatSessionId: call.chatSessionId,
      event: {
        id: eventId,
        kind: 'snapshotAttached',
        actorType: 'system',
        text: buildSnapshotEventText(input.cameraFacing, input.reason),
        visibleInChat: false,
        includeInAIContext: true,
        payloadJson: JSON.stringify({
          cameraFacing: input.cameraFacing || null,
          reason: input.reason || null,
          width: input.width ?? null,
          height: input.height ?? null,
        }),
      },
      attachment: {
        id: attachmentId,
        kind: 'snapshot',
        localUri: persistedUri,
        mimeType: input.mimeType || 'image/jpeg',
        width: input.width ?? null,
        height: input.height ?? null,
        sizeBytes: info.size,
      },
    });
  } catch (error) {
    try {
      await persistentMediaStore.deleteIfExists(persistedUri);
    } catch (cleanupError) {
      console.warn('[AttachCallSnapshot] 快照文件补偿删除失败:', cleanupError);
    }
    throw error;
  }
  await saveCallHistorySnapshot(call.aiAssistantId, input.sourceUri, result.attachment);
  return result;
}

function createCallSnapshotId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildSnapshotEventText(
  cameraFacing?: 'front' | 'back',
  reason?: AttachCallSnapshotInput['reason']
): string {
  const facingText = cameraFacing === 'back' ? '后置摄像头' : '前置摄像头';
  return `AI 请求查看用户画面，系统已从${facingText}截取当前帧。`;
}
