/** Calls 拥有背景选择 SQL；资产与选择由调用方在同一事务提交。 */
import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import type { CallBackgroundRepository, CallBackgroundSelection } from '../domain/CallBackgroundRepository';

export class SQLiteCallBackgroundRepository implements CallBackgroundRepository {
  get(assistantId: string): Promise<CallBackgroundSelection | null> {
    return databaseCoordinator.read({ name: 'calls.background.get', feature: 'calls', priority: 'interactive' }, (db) =>
      db.getFirstAsync<CallBackgroundSelection>('SELECT media_asset_id AS mediaAssetId, revision FROM call_background_selection WHERE id = ?', [assistantId]));
  }

  async commit(transaction: DatabaseTransactionExecutor, assistantId: string, expectedRevision: number | null, mediaAssetId: string | null): Promise<CallBackgroundSelection> {
    const result = expectedRevision === null
      ? await transaction.runAsync('INSERT OR IGNORE INTO call_background_selection (id, media_asset_id, revision) VALUES (?, ?, 0)', [assistantId, mediaAssetId])
      : await transaction.runAsync('UPDATE call_background_selection SET media_asset_id = ?, revision = revision + 1 WHERE id = ? AND revision = ?', [mediaAssetId, assistantId, expectedRevision]);
    if (result.changes !== 1) throw new Error('通话背景已被其他操作更改，请重试本次选择');
    return { mediaAssetId, revision: expectedRevision === null ? 0 : expectedRevision + 1 };
  }

  getLegacyMigration(): Promise<{ hasUnassignedRoles: boolean } | null> {
    return databaseCoordinator.read({ name: 'calls.background.legacy-migration', feature: 'calls', priority: 'interactive' }, async (db) => {
      const pending = await db.getFirstAsync("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'call_background_legacy_migration'");
      if (!pending) return null;
      const unassigned = await db.getFirstAsync(`
        SELECT 1 FROM call_background_legacy_migration
        WHERE assistant_id NOT IN (SELECT id FROM call_background_selection) LIMIT 1
      `);
      return { hasUnassignedRoles: unassigned !== null };
    });
  }

  async completeLegacyMigration(transaction: DatabaseTransactionExecutor, mediaAssetId: string | null): Promise<void> {
    const pending = await transaction.getFirstAsync("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'call_background_legacy_migration'");
    if (!pending) throw new Error('旧通话背景已被其他操作迁移');
    // 文件准备期间用户可以独立更换/清除角色背景；只补尚未选择的角色。
    await transaction.runAsync(`
      INSERT INTO call_background_selection (id, media_asset_id, revision)
      SELECT assistant_id, ?, 0 FROM call_background_legacy_migration
      WHERE assistant_id NOT IN (SELECT id FROM call_background_selection)
    `, [mediaAssetId]);
    await transaction.execAsync('DROP TABLE call_background_legacy_migration');
  }
}

export const callBackgroundRepository = new SQLiteCallBackgroundRepository();
