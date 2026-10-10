import * as FileSystem from 'expo-file-system/legacy';

import { databaseCoordinator, type DatabaseWriteExecutor } from '../runtime';

const SNAPSHOT_DIRECTORY_NAME = 'backup-snapshots';
export const DATABASE_BACKUP_CONTRACT_VERSION = 1;
let snapshotSequence = 0;

function requireCacheDirectory(): string {
  if (!FileSystem.cacheDirectory) {
    throw new Error('缓存目录不可用，无法生成数据库备份快照');
  }
  return `${FileSystem.cacheDirectory}${SNAPSHOT_DIRECTORY_NAME}/`;
}

/** 创建由调用方负责删除的、一致的 SQLite 单文件快照。 */
export async function createDatabaseBackupSnapshot(prepareSnapshot?: (executor: DatabaseWriteExecutor) => Promise<void>): Promise<string> {
  const directory = requireCacheDirectory();
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

  const fileName = `raven-backup-${Date.now()}-${snapshotSequence++}.db`;
  const uri = `${directory}${fileName}`;
  try {
    await databaseCoordinator.backupToAsync(
      {
        name: 'backup.create-database-snapshot',
        feature: 'backup',
        priority: 'maintenance',
        retry: { mode: 'none' },
      },
      fileName,
      directory,
      prepareSnapshot,
    );
    return uri;
  } catch (error) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw error;
  }
}

export async function deleteDatabaseBackupSnapshot(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}
