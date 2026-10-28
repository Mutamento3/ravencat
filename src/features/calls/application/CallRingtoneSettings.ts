/** Calls 持有铃声选择；文件沿 MediaAsset 的备份、共享引用与回收契约管理。 */
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import { databaseCoordinator } from '@platform/persistence';
import { inspectCallRingtone } from '@platform/device/CallRingtone';
import { createMediaAssetWithReference, MEDIA_ASSET_STORAGE_BACKEND, releaseMediaAssetCandidates, resolveMediaAsset } from '@features/media';
import type { CallDirection } from '../domain/CallSession';
import type { CallRingtoneRepository } from '../domain/CallRingtoneRepository';

const runtime = createRuntimeSlot<{ repository: CallRingtoneRepository }>('Calls ringtone');
export function configureCallRingtoneRuntime(repository: CallRingtoneRepository): void {
  runtime.configure({ repository });
}

export async function getCallRingtoneSelection(assistantId: string, direction: CallDirection) {
  return runtime.get().repository.get(assistantId, direction);
}

export async function loadCallRingtoneUri(assistantId: string, direction: CallDirection): Promise<string | null> {
  const selection = await getCallRingtoneSelection(assistantId, direction);
  return selection?.mediaAssetId ? (await resolveMediaAsset(selection.mediaAssetId)).localUri : null;
}

export async function setCustomCallRingtone(input: {
  assistantId: string; direction: CallDirection; sourceUri: string; fileName: string; mimeType: string;
}): Promise<void> {
  const repository = runtime.get().repository;
  const previous = await repository.get(input.assistantId, input.direction);
  // 文件内容在原生媒体边界确认可解码，不信任文件选择器提供的扩展名或 MIME。
  const metadata = await inspectCallRingtone(input.sourceUri);
  await createMediaAssetWithReference({
    storageBackend: MEDIA_ASSET_STORAGE_BACKEND.persistentMedia, sourceUri: input.sourceUri,
    fileName: input.fileName, mimeType: input.mimeType, width: null, height: null, durationMs: metadata.durationMs,
  }, ({ transaction, asset }) => repository.commit(transaction, input.assistantId, input.direction,
    previous?.revision ?? null, asset.id, input.fileName));
  await releaseMediaAssetCandidates([previous?.mediaAssetId]);
}

export async function clearCallRingtone(assistantId: string, direction: CallDirection): Promise<void> {
  const repository = runtime.get().repository;
  const previous = await repository.get(assistantId, direction);
  await databaseCoordinator.transaction({ name: 'calls.ringtone.clear', feature: 'calls', priority: 'interactive' }, tx =>
    repository.commit(tx, assistantId, direction, previous?.revision ?? null, null, null));
  await releaseMediaAssetCandidates([previous?.mediaAssetId]);
}
