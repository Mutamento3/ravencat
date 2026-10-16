import { File } from 'expo-file-system';
import { cropImageToAspect } from '@platform/device';
import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { createMediaAssetWithReference, resolveMediaAsset } from './MediaAssetRuntime';
import { MEDIA_ASSET_STORAGE_BACKEND } from './MediaAssetBacking';

export interface CroppedImageSelectionInput {
  mediaAssetId: string | null;
  aspect: readonly [number, number];
  signal: AbortSignal;
}

/** 图片准备在事务外；业务 owner 在回调内同时提交资格检查、CAS 与真实引用。 */
export async function commitCroppedImageSelection(
  input: CroppedImageSelectionInput,
  commit: (transaction: DatabaseTransactionExecutor, mediaAssetId: string | null) => Promise<void>,
) {
  throwIfAbortSignalAborted(input.signal);
  if (input.mediaAssetId === null) {
    await databaseCoordinator.transaction({ name: 'media.reset-image-selection', feature: 'media', priority: 'interactive' }, async tx => {
      throwIfAbortSignalAborted(input.signal);
      await commit(tx, null);
    });
    return { mediaAssetId: null, width: null, height: null, sourceWasAnimated: false };
  }
  const source = await resolveMediaAsset(input.mediaAssetId);
  const cropped = await cropImageToAspect({ sourceUri: source.localUri, aspect: input.aspect });
  try {
    throwIfAbortSignalAborted(input.signal);
    const result = await createMediaAssetWithReference({
      sourceUri: cropped.uri, storageBackend: MEDIA_ASSET_STORAGE_BACKEND.persistentMedia,
      fileName: `appearance.${cropped.mimeType === 'image/jpeg' ? 'jpg' : cropped.mimeType === 'image/webp' ? 'webp' : 'png'}`, mimeType: cropped.mimeType,
      width: cropped.width, height: cropped.height, durationMs: null,
    }, async ({ transaction, asset }) => {
      throwIfAbortSignalAborted(input.signal);
      await commit(transaction, asset.id);
    });
    return { mediaAssetId: result.asset.id, width: cropped.width, height: cropped.height,
      sourceWasAnimated: cropped.sourceWasAnimated };
  } finally {
    // 成功产物已由媒体 backing 接管；清理暂存失败不改变已提交结果。
    try { new File(cropped.uri).delete(); }
    catch (error) { console.warn('[Media] 自动裁剪暂存文件清理失败：', error); }
  }
}
