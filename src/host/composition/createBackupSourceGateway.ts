/** Backup 只消费 snapshot 媒体清单；具体查询与本机迁移在 Host 组装。 */
import { ApplicationBackupSourceGateway } from '@features/backup/composition';
import { SQLiteMediaAssetRepository } from '@features/media/composition';
import { CALL_SNAPSHOT_BACKUP_EXCLUSIONS, callRepository } from '@features/calls/composition';
import { databaseCoordinator } from '@platform/persistence';

export function createBackupSourceGateway(): ApplicationBackupSourceGateway {
  const repository = new SQLiteMediaAssetRepository(databaseCoordinator.openTaskExecutor({ name: 'backup.media', feature: 'media', priority: 'maintenance' }));
  return new ApplicationBackupSourceGateway({
    prepareDatabaseSnapshot: (executor) => callRepository.clearSnapshotReferencesInTransaction(executor),
    excludedMediaStoragePrefixes: CALL_SNAPSHOT_BACKUP_EXCLUSIONS,
    readMediaInventory: (uri) => databaseCoordinator.readSnapshotAsync({ name: 'backup.read-snapshot-media', feature: 'backup', priority: 'maintenance' }, uri, async (executor) => { await callRepository.assertBackupSnapshotHasNoFiles(executor); return repository.listBackupAssets(executor); }),
  });
}
