import { createMediaAssetWithReference, MEDIA_ASSET_STORAGE_BACKEND, releaseMediaAssetCandidates } from '@features/media';
import { readLocalAudioMetadata } from '@platform/device';
import { getCallRuntimeDependencies } from './runtime/CallRuntimeDependencies';
import { appendCallErrorEvent } from './events/AppendCallSystemEvent';
import type { CallAttachment } from '../domain/CallEvent';

const repository = () => getCallRuntimeDependencies().repositories.calls;
export const listCallHistory = (assistantId: string) => repository().listHistory(assistantId);
export async function getCallHistory(callId: string, assistantId: string) {
  const record = await repository().getHistory(callId, assistantId);
  if (!record) throw new Error('通话记录不存在或已删除');
  const [entries, images] = await Promise.all([repository().listHistoryEntries(callId), repository().listHistoryImages(callId)]);
  return { record, entries, images };
}

export async function renameCallHistory(callId: string, assistantId: string, value: string): Promise<void> {
  const title = value.normalize('NFC').trim();
  if (!title) throw new Error('标题不能为空');
  if (title.length > 100) throw new Error('标题最多 100 个字符');
  if (/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(title)) throw new Error('标题不能包含换行或不可见控制字符');
  const result = await repository().renameHistory(callId, assistantId, title);
  if (result === 'duplicate') throw new Error('这个 AI 已有同名通话记录，请换一个标题');
  if (result === 'missing') throw new Error('通话记录已删除');
}

export async function deleteCallHistory(callId: string, assistantId: string): Promise<void> {
  const assets = await repository().deleteHistory(callId, assistantId);
  await releaseMediaAssetCandidates(assets);
}

export const getCallHistorySnapshotSaving = (assistantId: string) => repository().getHistorySnapshotSaving(assistantId);
export const setCallHistorySnapshotSaving = (assistantId: string, enabled: boolean) => repository().setHistorySnapshotSaving(assistantId, enabled);

export async function deleteCallHistoryImage(imageId: string, callId: string, assistantId: string): Promise<void> {
  const assetId = await repository().deleteHistoryImage(imageId, callId, assistantId);
  await releaseMediaAssetCandidates([assetId]);
}

/** 采集源在本函数返回前由拍照 owner 保持存活；永久副本不依赖视觉临时快照 URI。 */
export async function saveCallHistorySnapshot(assistantId: string, sourceUri: string, attachment: CallAttachment): Promise<void> {
  try {
    if (!await repository().getHistorySnapshotSaving(assistantId)) return;
    await createMediaAssetWithReference({
      storageBackend: MEDIA_ASSET_STORAGE_BACKEND.persistentMedia, sourceUri,
      mimeType: attachment.mimeType!, width: attachment.width, height: attachment.height, durationMs: null,
    }, ({ transaction, asset }) => repository().appendHistoryImage(transaction, {
      id: attachment.id, callId: attachment.callId, mediaAssetId: asset.id, createdAt: attachment.createdAt,
    }));
  } catch (error) {
    await appendCallErrorEvent({ callId: attachment.callId,
      text: `通话截图保存失败：${error instanceof Error ? error.message : String(error)}` });
  }
}

/** 在原媒体链中复制长期文件；临时输入仍由各自的采集/合成 owner 清理。 */
export async function saveCallHistoryAudio(params: {
  callId: string; entryId: string; uri: string; mimeType: string; durationMs?: number;
}): Promise<void> {
  try {
    const durationMs = params.durationMs ?? (await readLocalAudioMetadata(params.uri)).durationMs;
    await createMediaAssetWithReference({
      storageBackend: MEDIA_ASSET_STORAGE_BACKEND.persistentMedia,
      sourceUri: params.uri, mimeType: params.mimeType,
      width: null, height: null, durationMs,
    }, ({ transaction, asset }) => repository().attachHistoryAudio(transaction, params.entryId, asset.id, durationMs));
  } catch (error) {
    await appendCallErrorEvent({ callId: params.callId,
      text: `通话录音保存失败：${error instanceof Error ? error.message : String(error)}` });
  }
}
