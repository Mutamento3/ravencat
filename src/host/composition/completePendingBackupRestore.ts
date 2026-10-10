import {
  collectRestoreGarbage,
  commitActivatedRestore,
  completeRolledBackRestore,
  consumeRestoreFailure,
  readPendingRestoreAction,
  rollbackActivatedRestore,
} from '../../../modules/backup-storage';

import { createBackupSourceGateway } from './createBackupSourceGateway';
import {
  closeDatabaseForRestoreRollback,
  initDatabase,
} from '@platform/persistence';
import { runPendingBackupRestoreCompletion } from './runPendingBackupRestoreCompletion';
import { rebaseRestoredLegacyMedia } from '../media/RebaseRestoredLegacyMedia';

let completionPromise: Promise<void> | null = null;

/** 在任何 Feature 子树挂载前完成恢复 generation 的 bootstrap、设置与最终提交。 */
export function completePendingBackupRestore(): Promise<void> {
  if (completionPromise) {
    return completionPromise;
  }

  const sourceGateway = createBackupSourceGateway();
  completionPromise = runPendingBackupRestoreCompletion({
    consumeRestoreFailure,
    readPendingRestoreAction,
    initializeDatabase: initDatabase,
    closeDatabaseForRollback: closeDatabaseForRestoreRollback,
    restoreStableSettings: async (json) => {
      await rebaseRestoredLegacyMedia(json);
      await sourceGateway.restoreStableSettingsJson(json);
    },
    commitActivatedRestore,
    rollbackActivatedRestore,
    completeRolledBackRestore,
    collectRestoreGarbage,
    reportCleanupFailure: (error) => {
      console.warn('[BackupRestore] 恢复事务 GC 未完成，将在下次冷启动重试：', error);
    },
  });
  return completionPromise;
}
