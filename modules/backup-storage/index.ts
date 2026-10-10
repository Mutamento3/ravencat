export {
  deletePublishedBackup,
  activatePreparedRestoreAndExit,
  collectRestoreGarbage,
  commitActivatedRestore,
  completeRolledBackRestore,
  consumeRestoreFailure,
  discardPreparedRestore,
  listPublishedBackups,
  prepareRestore,
  readPendingRestoreAction,
  rollbackActivatedRestore,
  prepareBackup,
  publishBackupToDownloads,
} from './src/BackupStorageModule';

export type {
  PreparedBackupArtifact,
  PendingRestoreAction,
  PublishedBackupArtifact,
  PreparedRestore,
} from './src/BackupStorageModule';
