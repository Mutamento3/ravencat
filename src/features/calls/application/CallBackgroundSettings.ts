/** Calls 按角色持有背景资产身份，只有显示时解析当前设备 URI。 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import { PERSISTENT_IMAGE_CATEGORY, copyPickedImageToAppStorage, deleteManagedPersistentImageIfExists, isAppCacheFileUri } from '@platform/device/DeviceMediaService';
import { commitCroppedImageSelection, createMediaAssetWithReference, MEDIA_ASSET_STORAGE_BACKEND, releaseMediaAssetCandidates, resolveMediaAsset, type CroppedImageSelectionInput } from '@features/media';
import type { CallBackgroundRepository } from '../domain/CallBackgroundRepository';

const LEGACY_BACKGROUND_KEY = 'kimi_phone.call.background_uri';
const backgroundRuntime = createRuntimeSlot<{ repository: CallBackgroundRepository }>('Calls background');
export function configureCallBackgroundRuntime(repository: CallBackgroundRepository): void {
  backgroundRuntime.configure({ repository });
}

const backgroundListeners = new Set<(assistantId: string) => void>();
export function subscribeCallBackgroundChanged(listener: (assistantId: string) => void): () => void {
  backgroundListeners.add(listener);
  return () => { backgroundListeners.delete(listener); };
}
function publishBackgroundChanged(assistantId: string): void {
  for (const listener of backgroundListeners) listener(assistantId);
}

export async function getCallBackgroundImageSelection(assistantId: string) {
  let selection = await backgroundRuntime.get().repository.get(assistantId);
  if (!selection) {
    await ensureCallBackgroundMigration();
    selection = await backgroundRuntime.get().repository.get(assistantId);
  }
  return { mediaAssetId: selection?.mediaAssetId ?? null, legacyUri: null };
}

export async function changeCallBackgroundFromMediaAsset(assistantId: string, input: CroppedImageSelectionInput,
  guard: (transaction: DatabaseTransactionExecutor) => Promise<void>) {
  const repository = backgroundRuntime.get().repository;
  const expected = await repository.get(assistantId);
  const result = await commitCroppedImageSelection(input, async (tx, assetId) => {
    await guard(tx);
    await repository.commit(tx, assistantId, expected?.revision ?? null, assetId);
  });
  await releaseMediaAssetCandidates([expected?.mediaAssetId]);
  publishBackgroundChanged(assistantId);
  return result;
}

export interface SetCustomCallBackgroundInput {
  assistantId: string;
  sourceUri: string;
  sourceWidth?: number | null;
}

/** 清除旧设置是 commit 后清理，失败不能把已保存的新选择报告成失败。 */
async function retireLegacySetting(): Promise<void> {
  try { await AsyncStorage.removeItem(LEGACY_BACKGROUND_KEY); }
  catch (error) { console.warn('[Calls] 已保存背景，但旧设置清理失败：', error); }
}

async function commitBackgroundImage(
  input: { sourceUri: string; sourceWidth?: number | null },
  commit: (transaction: DatabaseTransactionExecutor, assetId: string) => Promise<unknown>,
): Promise<{ assetId: string; uri: string }> {
  const draftUri = await copyPickedImageToAppStorage({
    sourceUri: input.sourceUri, category: PERSISTENT_IMAGE_CATEGORY.callBackground, entityId: 'draft',
    compression: { maxWidth: 1800, quality: 0.88, sourceWidth: input.sourceWidth },
  });
  try {
    const result = await createMediaAssetWithReference({
      storageBackend: MEDIA_ASSET_STORAGE_BACKEND.persistentImage, sourceUri: draftUri,
      fileName: 'call-background.jpg', mimeType: 'image/jpeg', width: null, height: null, durationMs: null,
    }, ({ transaction, asset }) => commit(transaction, asset.id));
    return { assetId: result.asset.id, uri: (await resolveMediaAsset(result.asset.id)).localUri };
  } finally {
    await deleteManagedPersistentImageIfExists(draftUri);
  }
}

/** 本机旧设置只迁给升级时已有的角色；提交后删除迁移表，不保留全局读取路径。 */
async function migrateLegacyCallBackground(): Promise<void> {
  const repository = backgroundRuntime.get().repository;
  const migration = await repository.getLegacyMigration();
  if (!migration) return;
  // 已删除或明确改选的角色不再消费旧文件，迁移收尾也不应依赖它可读。
  const uri = migration.hasUnassignedRoles ? await AsyncStorage.getItem(LEGACY_BACKGROUND_KEY) : null;
  if (uri !== null) {
    const prepared = await commitBackgroundImage({ sourceUri: uri }, (tx, assetId) => repository.completeLegacyMigration(tx, assetId));
    // 若准备期间所有旧角色都被删除/改选，刚迁入的资产也需要按真实引用释放。
    await releaseMediaAssetCandidates([prepared.assetId]);
  } else {
    await databaseCoordinator.transaction({ name: 'calls.background.migrate-legacy', feature: 'calls', priority: 'interactive' }, (tx) => repository.completeLegacyMigration(tx, null));
  }
  await retireLegacySetting();
}

let initialization: Promise<void> | null = null;
/** 合并并发读取的文件准备；真正的 winner 仍由 Repository CAS 决定。 */
export function ensureCallBackgroundMigration(): Promise<void> {
  if (initialization) return initialization;
  initialization = migrateLegacyCallBackground().finally(() => { initialization = null; });
  return initialization;
}

/** 用户明确清除旧缓存选择；只收尾待迁移角色，不覆盖已经独立改选的背景。 */
export async function clearLegacyCachedCallBackground(): Promise<boolean> {
  const repository = backgroundRuntime.get().repository;
  const migration = await repository.getLegacyMigration();
  if (!migration) return false;
  const uri = await AsyncStorage.getItem(LEGACY_BACKGROUND_KEY);
  if (uri === null || !isAppCacheFileUri(uri)) return false;
  await databaseCoordinator.transaction({ name: 'calls.background.clear-legacy-cache', feature: 'calls', priority: 'interactive' },
    (tx) => repository.completeLegacyMigration(tx, null));
  await retireLegacySetting();
  return true;
}

export async function loadCallBackgroundUri(assistantId: string): Promise<string | null> {
  const repository = backgroundRuntime.get().repository;
  let selection = await repository.get(assistantId);
  if (!selection) {
    await ensureCallBackgroundMigration();
    selection = await repository.get(assistantId);
  }
  return selection?.mediaAssetId ? (await resolveMediaAsset(selection.mediaAssetId)).localUri : null;
}

export async function setCustomCallBackground(input: SetCustomCallBackgroundInput): Promise<string> {
  const repository = backgroundRuntime.get().repository;
  const previous = await repository.get(input.assistantId);
  const prepared = await commitBackgroundImage(input, (tx, assetId) => repository.commit(tx, input.assistantId, previous?.revision ?? null, assetId));
  await releaseMediaAssetCandidates([previous?.mediaAssetId]);
  publishBackgroundChanged(input.assistantId);
  return prepared.uri;
}

export async function clearCallBackground(assistantId: string): Promise<void> {
  const repository = backgroundRuntime.get().repository;
  const previous = await repository.get(assistantId);
  await databaseCoordinator.transaction({ name: 'calls.background.clear', feature: 'calls', priority: 'interactive' }, (tx) =>
    repository.commit(tx, assistantId, previous?.revision ?? null, null));
  await releaseMediaAssetCandidates([previous?.mediaAssetId]);
  publishBackgroundChanged(assistantId);
}
