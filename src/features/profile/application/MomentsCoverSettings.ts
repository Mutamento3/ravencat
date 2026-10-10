/** Profile 负责封面准备、资产提交与本机旧 URI 迁移，展示端不再修改媒体文件。 */
import { databaseCoordinator } from '@platform/persistence';
import { copyPickedImageToAppStorage, deleteManagedPersistentImageIfExists, isAppCacheFileUri, PERSISTENT_IMAGE_CATEGORY } from '@platform/device/DeviceMediaService';
import { createMediaAssetWithReference, MEDIA_ASSET_STORAGE_BACKEND, releaseMediaAssetCandidates } from '@features/media';
import type { IUserProfileRepository, MomentsCoverSelection } from '../domain/UserProfileRepository';

type Repository = Pick<IUserProfileRepository, 'getMomentsCoverSelection' | 'commitMomentsCoverInTransaction'>;
async function commitImage(repository: Repository, sourceUri: string, expected: MomentsCoverSelection, sourceWidth?: number): Promise<void> {
  const draft = await copyPickedImageToAppStorage({ sourceUri, category: PERSISTENT_IMAGE_CATEGORY.momentsCover, entityId: 'draft', compression: { maxWidth: 1600, quality: 0.78, sourceWidth } });
  try {
    await createMediaAssetWithReference({ storageBackend: MEDIA_ASSET_STORAGE_BACKEND.persistentImage, sourceUri: draft,
      fileName: 'moments-cover.jpg', mimeType: 'image/jpeg', width: null, height: null, durationMs: null,
    }, ({ transaction, asset }) => repository.commitMomentsCoverInTransaction(transaction, expected.revision, asset.id));
    await releaseMediaAssetCandidates([expected.mediaAssetId]);
  } finally {
    try { await deleteManagedPersistentImageIfExists(draft); }
    catch (error) { console.warn('[Profile] 封面准备副本清理失败：', error); }
  }
}

let migration: Promise<void> | null = null;
export async function clearLegacyCachedMomentsCover(repository: Repository): Promise<boolean> {
  const selected = await repository.getMomentsCoverSelection();
  if (selected.legacyUri === null || !isAppCacheFileUri(selected.legacyUri)) return false;
  await databaseCoordinator.transaction({ name: 'profile.cover.clear-legacy-cache', feature: 'profile', priority: 'interactive' },
    (tx) => repository.commitMomentsCoverInTransaction(tx, selected.revision, null));
  return true;
}

export function ensureMomentsCoverSelection(repository: Repository): Promise<void> {
  if (migration) return migration;
  migration = (async () => {
    const selected = await repository.getMomentsCoverSelection();
    if (selected.legacyUri !== null) await commitImage(repository, selected.legacyUri, selected);
  })().finally(() => { migration = null; });
  return migration;
}

export async function setMomentsCover(repository: Repository, sourceUri: string | null, sourceWidth?: number): Promise<void> {
  const selected = await repository.getMomentsCoverSelection();
  if (sourceUri !== null) return commitImage(repository, sourceUri, selected, sourceWidth);
  // 明确清除也能修复旧文件已丢失的选择，不要求先读取那个文件。
  await databaseCoordinator.transaction({ name: 'profile.cover.clear', feature: 'profile', priority: 'interactive' },
    (tx) => repository.commitMomentsCoverInTransaction(tx, selected.revision, null));
  await releaseMediaAssetCandidates([selected.mediaAssetId]);
}
