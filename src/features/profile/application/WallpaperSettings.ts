/** 壁纸选择的唯一写入链路；资产与选择同事务提交，旧文件仅在本机迁移时读取。 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { StoredWallpaperState } from '@shared/theme';
import { loadStoredWallpaperStateStrict } from './legacyWallpaperSettings';
import type { WallpaperSelection, WallpaperSlot } from '@shared/theme/wallpaper/types';
import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import { copyPickedImageToAppStorage, deleteManagedPersistentImageIfExists, isAppCacheFileUri, PERSISTENT_IMAGE_CATEGORY } from '@platform/device/DeviceMediaService';
import { createMediaAssetWithReference, MEDIA_ASSET_STORAGE_BACKEND, releaseMediaAssetCandidates, resolveMediaAsset } from '@features/media';
import type { WallpaperAssetSelection, WallpaperRepository } from '../domain/WallpaperRepository';

const runtime = createRuntimeSlot<{ repository: WallpaperRepository }>('Profile wallpapers');
export function configureWallpaperRuntime(repository: WallpaperRepository): void { runtime.configure({ repository }); }
const DEFAULT_SELECTION: WallpaperSelection = { mode: 'default', uri: null };

async function selections(): Promise<WallpaperAssetSelection[]> {
  const repository = runtime.get().repository;
  let rows = await repository.list();
  if (!rows.some((row) => row.key === 'app')) {
    const old = await loadStoredWallpaperStateStrict();
    Object.keys(old.chatWallpaperOverrides).forEach(validateChatKey);
    await databaseCoordinator.transaction({ name: 'profile.wallpapers.initialize', feature: 'profile', priority: 'interactive' }, (tx) =>
      repository.seed(tx, [
        { key: 'app', uri: old.appWallpaper.uri }, { key: 'chat', uri: old.chatWallpaper.uri },
        ...Object.entries(old.chatWallpaperOverrides).map(([key, value]) => ({ key, uri: value.uri })),
      ]));
    rows = await repository.list();
  }
  return rows;
}

async function commitImage(sourceUri: string, expected: readonly (WallpaperAssetSelection | { key: string; revision: null })[]): Promise<void> {
  const draft = await copyPickedImageToAppStorage({ sourceUri, category: PERSISTENT_IMAGE_CATEGORY.wallpaper, entityId: 'draft', compression: { maxWidth: 1800, quality: 0.88 } });
  try {
    await createMediaAssetWithReference({ storageBackend: MEDIA_ASSET_STORAGE_BACKEND.persistentImage, sourceUri: draft,
      fileName: 'wallpaper.jpg', mimeType: 'image/jpeg', width: null, height: null, durationMs: null,
    }, async ({ transaction, asset }) => {
      for (const selection of expected) await runtime.get().repository.commit(transaction, selection, asset.id);
    });
    await releaseMediaAssetCandidates(expected.map((selection) => 'mediaAssetId' in selection ? selection.mediaAssetId : null));
  } finally {
    try { await deleteManagedPersistentImageIfExists(draft); }
    catch (error) { console.warn('[Profile] 壁纸准备副本清理失败：', error); }
  }
}

function validateChatKey(key: string): void {
  if (!/^(single|group):.+/u.test(key)) throw new Error('当前对话没有有效的背景配置标识');
}

let migration: Promise<void> | null = null;
async function migrateLegacyWallpapers(): Promise<void> {
  const rows = await selections();
  const byUri = new Map<string, WallpaperAssetSelection[]>();
  for (const row of rows) {
    if (row.legacyUri === null) continue;
    const group = byUri.get(row.legacyUri) ?? [];
    group.push(row); byUri.set(row.legacyUri, group);
  }
  for (const [uri, group] of byUri) await commitImage(uri, group);
  // 本机旧选择已全部提交，清理失败不能让 canonical 选择重新降级为旧来源。
  try { await AsyncStorage.removeItem('presentation.wallpaper.v2'); }
  catch (error) { console.warn('[Profile] 壁纸已迁移，但旧设置清理失败：', error); }
}

export function ensureWallpaperSelections(): Promise<void> {
  if (migration) return migration;
  migration = migrateLegacyWallpapers().finally(() => { migration = null; });
  return migration;
}

/** 不读取旧图片；一次事务清除缓存来源，revision 防止覆盖期间的新选择。 */
export async function clearLegacyCachedWallpapers(): Promise<number> {
  const cached = (await selections()).filter((row) => row.legacyUri !== null && isAppCacheFileUri(row.legacyUri));
  if (cached.length === 0) return 0;
  await databaseCoordinator.transaction({ name: 'profile.wallpapers.clear-legacy-cache', feature: 'profile', priority: 'interactive' }, async (tx) => {
    for (const row of cached) await runtime.get().repository.commit(tx, row, null);
  });
  return cached.length;
}

export async function loadWallpaperState(): Promise<StoredWallpaperState> {
  // 展示投影保留真实选择，迁移失败时仍允许用户清除/重选；备份另走严格 ensure。
  try { await ensureWallpaperSelections(); }
  catch (error) { console.warn('[Profile] 壁纸迁移未完成，保留选择供修复：', error); }
  const state: StoredWallpaperState = { appWallpaper: DEFAULT_SELECTION, chatWallpaper: DEFAULT_SELECTION, chatWallpaperOverrides: {} };
  const assetSelections = new Map<string, WallpaperSelection>();
  for (const row of await runtime.get().repository.list()) {
    let selection: WallpaperSelection = row.legacyUri !== null ? { mode: 'custom', uri: row.legacyUri } : DEFAULT_SELECTION;
    if (row.mediaAssetId !== null) {
      let resolved = assetSelections.get(row.mediaAssetId);
      if (resolved === undefined) {
        try { resolved = { mode: 'custom', uri: (await resolveMediaAsset(row.mediaAssetId)).localUri }; }
        catch (error) {
          console.warn('[Profile] 壁纸资产不可读，保留自定义选择：', { assetId: row.mediaAssetId, error });
          resolved = { mode: 'custom', uri: null };
        }
        assetSelections.set(row.mediaAssetId, resolved);
      }
      selection = resolved;
    }
    if (row.key === 'app') state.appWallpaper = selection;
    else if (row.key === 'chat') state.chatWallpaper = selection;
    else if (selection.mode === 'custom') state.chatWallpaperOverrides[row.key] = selection;
  }
  return state;
}

async function setSelections(keys: readonly string[], uri: string | null): Promise<void> {
  const rows = await selections();
  const expected = [...new Set(keys)].map((key) => rows.find((row) => row.key === key) ?? { key, revision: null });
  if (uri !== null) return commitImage(uri, expected);
  await databaseCoordinator.transaction({ name: 'profile.wallpapers.clear', feature: 'profile', priority: 'interactive' }, async (tx) => {
    for (const row of expected) await runtime.get().repository.commit(tx, row, null);
  });
  await releaseMediaAssetCandidates(expected.map((row) => 'mediaAssetId' in row ? row.mediaAssetId : null));
}

export function setGlobalWallpaper(slot: WallpaperSlot, uri: string | null, chatKeys: readonly string[] = []): Promise<void> {
  chatKeys.forEach(validateChatKey);
  return setSelections(slot === 'app' ? ['app'] : ['chat', ...chatKeys], uri);
}

export function setConversationWallpaper(chatKey: string, uri: string | null): Promise<void> {
  validateChatKey(chatKey);
  return setSelections([chatKey], uri);
}

/** 会话删除事务内清除自己的选择；Host 把该窄 command 接到 Chat 的既有删除链路。 */
export function removeConversationWallpaperInTransaction(transaction: DatabaseTransactionExecutor, chatKey: string): Promise<string | null> {
  return runtime.get().repository.removeConversation(transaction, chatKey);
}
