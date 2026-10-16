/** Profile 拥有壁纸 SQL，shared/theme 仅展示解析后的状态。 */
import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import type { WallpaperAssetSelection, WallpaperRepository } from '../domain/WallpaperRepository';
import { SettingChangeConflictError } from '@shared/errors/SettingChangeConflictError';

export class SQLiteWallpaperRepository implements WallpaperRepository {
  list(): Promise<WallpaperAssetSelection[]> {
    return databaseCoordinator.read({ name: 'profile.wallpapers.list', feature: 'profile', priority: 'interactive' }, (db) =>
      db.getAllAsync<WallpaperAssetSelection>('SELECT selection_key AS key, media_asset_id AS mediaAssetId, legacy_uri AS legacyUri, revision FROM profile_wallpaper_selections ORDER BY selection_key'));
  }

  async seed(transaction: DatabaseTransactionExecutor, selections: readonly { key: string; uri: string | null }[]): Promise<void> {
    const initialized = await transaction.getFirstAsync('SELECT 1 FROM profile_wallpaper_selections WHERE selection_key = ?', ['app']);
    if (initialized) return;
    for (const selection of selections) {
      if (selection.key !== 'app' && selection.key !== 'chat' && !await this.conversationExists(transaction, selection.key)) continue;
      await transaction.runAsync('INSERT INTO profile_wallpaper_selections (selection_key, media_asset_id, legacy_uri, revision) VALUES (?, NULL, ?, 0)', [selection.key, selection.uri]);
    }
  }

  async commit(transaction: DatabaseTransactionExecutor, expected: WallpaperAssetSelection | { key: string; revision: null }, assetId: string | null): Promise<void> {
    if (expected.key !== 'app' && expected.key !== 'chat' && !await this.conversationExists(transaction, expected.key)) {
      throw new SettingChangeConflictError('对话已删除，无法保存聊天背景。');
    }
    const result = expected.revision === null
      ? await transaction.runAsync('INSERT OR IGNORE INTO profile_wallpaper_selections (selection_key, media_asset_id, legacy_uri, revision) VALUES (?, ?, NULL, 0)', [expected.key, assetId])
      : await transaction.runAsync('UPDATE profile_wallpaper_selections SET media_asset_id = ?, legacy_uri = NULL, revision = revision + 1 WHERE selection_key = ? AND revision = ?', [assetId, expected.key, expected.revision]);
    if (result.changes !== 1) throw new SettingChangeConflictError('背景选择已被其他操作更改，本次选择未保存。');
  }

  private async conversationExists(transaction: DatabaseTransactionExecutor, key: string): Promise<boolean> {
    const separator = key.indexOf(':');
    const kind = key.slice(0, separator) === 'single' ? 'direct' : 'group';
    return await transaction.getFirstAsync('SELECT 1 FROM chat_conversations WHERE id = ? AND kind = ?', [key.slice(separator + 1), kind]) !== null;
  }

  async removeConversation(transaction: DatabaseTransactionExecutor, key: string): Promise<string | null> {
    const row = await transaction.getFirstAsync<{ media_asset_id: string | null }>('SELECT media_asset_id FROM profile_wallpaper_selections WHERE selection_key = ?', [key]);
    await transaction.runAsync('DELETE FROM profile_wallpaper_selections WHERE selection_key = ?', [key]);
    return row?.media_asset_id ?? null;
  }
}

export const wallpaperRepository = new SQLiteWallpaperRepository();
